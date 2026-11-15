import os
import logging
import psycopg2
from psycopg2 import pool
from config import Config

logger = logging.getLogger("IUAC_DB")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

_db_pool = None
_pool_pid = None

def init_db_pool(run_schema_check=False):
    global _db_pool, _pool_pid
    current_pid = os.getpid()
    # Si el pool fue heredado de un proceso padre (fork de Gunicorn), descartarlo para evitar colisión SSL
    if _db_pool is not None and _pool_pid != current_pid:
        logger.info(f"Detectado fork de worker (PID {current_pid} != {_pool_pid}). Reiniciando pool SSL propio...")
        _db_pool = None

    if _db_pool is None:
        try:
            # Soporte prioritario para DATABASE_URL (Nube: Render, Neon, Supabase, Railway)
            db_url = os.getenv("DATABASE_URL")
            if db_url:
                if db_url.startswith("postgres://"):
                    db_url = db_url.replace("postgres://", "postgresql://", 1)
                logger.info(f"Iniciando pool PostgreSQL con DATABASE_URL (PID {current_pid})...")
                _db_pool = psycopg2.pool.ThreadedConnectionPool(
                    minconn=Config.DB_MIN_CONN,
                    maxconn=Config.DB_MAX_CONN,
                    dsn=db_url,
                    connect_timeout=15,
                    keepalives=1,
                    keepalives_idle=30,
                    keepalives_interval=10,
                    keepalives_count=5
                )
            else:
                logger.info(f"Iniciando pool PostgreSQL local en {Config.DB_HOST}:{Config.DB_PORT}/{Config.DB_NAME}...")
                _db_pool = psycopg2.pool.ThreadedConnectionPool(
                    minconn=Config.DB_MIN_CONN,
                    maxconn=Config.DB_MAX_CONN,
                    host=Config.DB_HOST,
                    port=Config.DB_PORT,
                    dbname=Config.DB_NAME,
                    user=Config.DB_USER,
                    password=Config.DB_PASSWORD,
                    connect_timeout=10,
                    keepalives=1,
                    keepalives_idle=30,
                    keepalives_interval=10,
                    keepalives_count=5
                )
            _pool_pid = current_pid
            logger.info(f"Pool de conexiones a PostgreSQL inicializado exitosamente (PID {current_pid}).")
            
            # Inicializar esquema automáticamente si se solicita
            if run_schema_check:
                init_schema_if_needed()

        except Exception as e:
            logger.error(f"Error fatal al conectar a PostgreSQL: {e}")
            _db_pool = None
            _pool_pid = None

def init_schema_if_needed():
    """Crea esquema y tablas si no existen al iniciar en la nube."""
    conn, cur = get_db_cursor()
    if not conn or not cur:
        return
    try:
        cur.execute("SELECT to_regclass('academico.estudiantes');")
        row = cur.fetchone()
        if not row or not row[0]:
            logger.info("La tabla academico.estudiantes no existe. Inicializando DDL...")
            schema_file = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'schema', '001_create_academico_schema.sql'))
            if os.path.exists(schema_file):
                with open(schema_file, 'r', encoding='utf-8') as f:
                    cur.execute(f.read())
                conn.commit()
                logger.info("Esquema academico y tablas creados exitosamente en la nube.")
        else:
            # Asegurar que foto_alum sea tipo TEXT para almacenar la fotografía directamente en la BD
            cur.execute("ALTER TABLE academico.estudiantes ALTER COLUMN foto_alum TYPE TEXT;")
            conn.commit()
    except Exception as e:
        logger.warning(f"Aviso al verificar/crear esquema: {e}")
        try:
            conn.rollback()
        except Exception:
            pass
    finally:
        release_db(conn, cur)

def get_db_cursor():
    """
    Obtiene una conexión saludable del pool y retorna (conn, cur).
    Verifica aislamiento por PID (Gunicorn workers) y realiza pre-ping (SELECT 1)
    para descartar conexiones SSL cerradas por inactividad en Neon/Render.
    """
    global _db_pool, _pool_pid
    for intento in range(3):
        if _db_pool is None or _pool_pid != os.getpid():
            init_db_pool(run_schema_check=(intento == 0))
        if _db_pool is None:
            return None, None
        conn = None
        try:
            conn = _db_pool.getconn()
            if conn.closed != 0:
                _db_pool.putconn(conn, close=True)
                continue
            conn.autocommit = False
            cur = conn.cursor()
            # Pre-ping rápido para validar que la sesión SSL sigue activa
            cur.execute("SELECT 1;")
            cur.fetchone()
            return conn, cur
        except Exception as e:
            logger.warning(f"Conexión SSL inactiva o corrupta detectada en intento {intento + 1}, renovando: {e}")
            if conn and _db_pool:
                try:
                    _db_pool.putconn(conn, close=True)
                except Exception:
                    pass
            # Si fallan todas las del pool, reiniciar el pool completo en el siguiente intento
            if intento == 1:
                try:
                    if _db_pool:
                        _db_pool.closeall()
                except Exception:
                    pass
                _db_pool = None
    return None, None

def release_db(conn, cur, commit=False):
    """
    Cierra cursor y devuelve la conexión al pool de forma segura.
    Si la conexión presentó un fallo de red/SSL o está cerrada, se descarta (close=True).
    """
    global _db_pool
    conn_broken = False
    if cur:
        try:
            cur.close()
        except Exception:
            conn_broken = True
    if conn and _db_pool:
        try:
            if conn.closed != 0:
                conn_broken = True
            elif commit:
                conn.commit()
            else:
                conn.rollback()
        except Exception:
            conn_broken = True
        finally:
            try:
                _db_pool.putconn(conn, close=conn_broken)
            except Exception:
                pass

def check_db_health():
    """Verifica si la base de datos responde rápidamente"""
    conn, cur = get_db_cursor()
    if not conn:
        return False, "No se pudo conectar a la base de datos"
    try:
        cur.execute("SELECT 1;")
        res = cur.fetchone()
        release_db(conn, cur)
        return True, "Conexión a PostgreSQL operativa"
    except Exception as e:
        release_db(conn, cur)
        return False, str(e)

