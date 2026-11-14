import os
import logging
import psycopg2
from psycopg2 import pool
from config import Config

logger = logging.getLogger("IUAC_DB")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

_db_pool = None

def init_db_pool():
    global _db_pool
    if _db_pool is None:
        try:
            # Soporte prioritario para DATABASE_URL (Nube: Render, Neon, Supabase, Railway)
            db_url = os.getenv("DATABASE_URL")
            if db_url:
                if db_url.startswith("postgres://"):
                    db_url = db_url.replace("postgres://", "postgresql://", 1)
                logger.info("Iniciando pool PostgreSQL con DATABASE_URL (Cloud Hosting)...")
                _db_pool = psycopg2.pool.ThreadedConnectionPool(
                    minconn=Config.DB_MIN_CONN,
                    maxconn=Config.DB_MAX_CONN,
                    dsn=db_url,
                    connect_timeout=15
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
                    connect_timeout=10
                )
            logger.info("Pool de conexiones a PostgreSQL inicializado exitosamente.")
            
            # Inicializar esquema automáticamente si es una base de datos nueva en la nube
            init_schema_if_needed()

        except Exception as e:
            logger.error(f"Error fatal al conectar a PostgreSQL: {e}")
            _db_pool = None

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
    Obtiene una conexión del pool y retorna (conn, cur).
    Si el pool no está listo, intenta inicializarlo.
    """
    global _db_pool
    if _db_pool is None:
        init_db_pool()
    if _db_pool is None:
        return None, None
    try:
        conn = _db_pool.getconn()
        conn.autocommit = False
        cur = conn.cursor()
        return conn, cur
    except Exception as e:
        logger.error(f"Error obteniendo cursor del pool: {e}")
        return None, None

def release_db(conn, cur, commit=False):
    """
    Cierra cursor y devuelve la conexión al pool de forma segura.
    """
    global _db_pool
    if cur:
        try:
            cur.close()
        except Exception:
            pass
    if conn and _db_pool:
        try:
            if commit:
                conn.commit()
            else:
                conn.rollback()
        except Exception:
            pass
        finally:
            try:
                _db_pool.putconn(conn)
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

