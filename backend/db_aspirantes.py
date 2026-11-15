import logging
import os
import re
import base64
from database import get_db_cursor, release_db

logger = logging.getLogger("IUAC_DB_OPS")

def guardar_foto_aspirante(foto_base64, cedula_str, upload_dir):
    """
    Decodifica una imagen en base64 y la guarda en disco de forma segura.
    Retorna el nombre del archivo guardado o None.
    """
    if not foto_base64 or not isinstance(foto_base64, str):
        return None
    try:
        if ',' in foto_base64:
            _, encoded = foto_base64.split(',', 1)
        else:
            encoded = foto_base64

        img_bytes = base64.b64decode(encoded)
        if len(img_bytes) > 6 * 1024 * 1024:  # Máx 6MB
            logger.warning(f"Foto excede tamaño permitido: {len(img_bytes)} bytes")
            return None

        os.makedirs(upload_dir, exist_ok=True)
        filename = f"foto_{cedula_str}.jpg"
        filepath = os.path.join(upload_dir, filename)
        with open(filepath, 'wb') as f:
            f.write(img_bytes)
        logger.info(f"Foto de aspirante guardada: {filename}")
        return filename
    except Exception as e:
        logger.warning(f"No se pudo guardar foto del aspirante {cedula_str}: {e}")
        return None

def check_cedula_exists(cedula):
    """Verifica si la cédula ya se encuentra registrada en academico.estudiantes."""
    conn, cur = get_db_cursor()
    if not conn:
        raise Exception("Error de conexión a la base de datos.")
    try:
        cur.execute("SELECT 1 FROM academico.estudiantes WHERE ced_alum = %s LIMIT 1;", (int(cedula),))
        row = cur.fetchone()
        return row is not None
    finally:
        release_db(conn, cur)

def check_correo_exists(correo):
    """Verifica si el correo ya se encuentra registrado."""
    conn, cur = get_db_cursor()
    if not conn:
        raise Exception("Error de conexión a la base de datos.")
    try:
        cur.execute("SELECT 1 FROM academico.estudiantes WHERE LOWER(correo_alum) = LOWER(%s) LIMIT 1;", (str(correo).strip(),))
        row = cur.fetchone()
        return row is not None
    finally:
        release_db(conn, cur)

def get_active_carreras():
    """Retorna exclusivamente las carreras oficiales activas del IUAC (activo = TRUE)."""
    conn, cur = get_db_cursor()
    if not conn:
        return [
            {"codigo": "CTA", "nombre": "Control de Tránsito Aéreo"},
            {"codigo": "ICA", "nombre": "Información y Comunicaciones Aeronáuticas"},
            {"codigo": "IMA", "nombre": "Mantenimiento Aeronáutico"},
            {"codigo": "SAR", "nombre": "Búsqueda y Salvamento"},
            {"codigo": "ETA", "nombre": "Electrónica Aeronáutica"}
        ]
    try:
        cur.execute("SELECT codigo, nombre, descripcion FROM academico.carreras WHERE activo = TRUE ORDER BY carrera_id ASC, codigo ASC;")
        rows = cur.fetchall()
        if rows:
            return [{"codigo": r[0], "nombre": r[1], "descripcion": r[2]} for r in rows]
        return []
    except Exception as e:
        logger.warning(f"Error consultando carreras en BD: {e}")
        return []
    finally:
        release_db(conn, cur)

def insert_aspirante_web(data, ip_origen='127.0.0.1', user_agent=''):
    """
    Inserta el aspirante en la tabla academico.estudiantes
    utilizando única y exclusivamente las columnas existentes en la BD real.
    Consultas parametrizadas estrictas (%s).
    """
    conn, cur = get_db_cursor()
    if not conn:
        return False, "No hay conexión disponible con el servidor de base de datos."

    try:
        ced_int = int(data['ced_alum'])

        # 1. Verificar duplicidad de cédula antes de insertar
        cur.execute("SELECT 1 FROM academico.estudiantes WHERE ced_alum = %s;", (ced_int,))
        if cur.fetchone():
            return False, f"La cédula V-{ced_int} ya se encuentra registrada en el sistema."

        # 2. Verificar duplicidad de correo
        cur.execute("SELECT 1 FROM academico.estudiantes WHERE LOWER(correo_alum) = LOWER(%s);", (data['correo_alum'],))
        if cur.fetchone():
            return False, f"El correo electrónico '{data['correo_alum']}' ya está asociado a otro aspirante."

        # Procesar fotografía si fue capturada o subida
        foto_nombre = None
        if data.get('foto_base64'):
            upload_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), 'uploads', 'fotos'))
            foto_nombre = guardar_foto_aspirante(data.get('foto_base64'), f"{data.get('tipo_cedula', 'V')}{ced_int}", upload_dir)

        # 3. Columnas exactas que existen en academico.estudiantes
        columnas = [
            'ced_alum', 'tipo_cedula', 'nom_alum', 'ape_alum', 'fec_nac_alum', 'edad_alum',
            'sex_alum', 'est_civil_alum', 'pais_alum', 'est_alum', 'ciu_alum', 'direc_alum',
            'lugar_nac_alum', 'nacionalidad_alum', 'etnia', 'foto_alum',
            'telemov_alum', 'telehabi_alum', 'correo_alum',
            'niv_acad_alum', 'inst_grad_alum', 'ubica_inst_muni_alum', 'ano_grad_alum', 'tipo_colegio',
            'carrera', 'modalidad_ing', 'condicion_resi', 'turno_class',
            'canal_inscripcion', 'status_alum', 'observaciones', 'is_active', 'creado_por', 'actualizado_por'
        ]

        valores = [
            ced_int,
            data.get('tipo_cedula', 'V'),
            data.get('nom_alum'),
            data.get('ape_alum'),
            data.get('fec_nac_alum'),
            data.get('edad_alum'),
            data.get('sex_alum'),
            data.get('est_civil_alum'),
            data.get('pais_alum', 'Venezuela'),
            data.get('est_alum'),
            data.get('ciu_alum'),
            data.get('direc_alum'),
            data.get('lugar_nac_alum'),
            data.get('nacionalidad_alum', 'VENEZOLANA'),
            data.get('etnia', 'Ninguna'),
            foto_nombre,
            data.get('telemov_alum'),
            data.get('telehabi_alum'),
            data.get('correo_alum'),
            data.get('niv_acad_alum', 'Bachiller'),
            data.get('inst_grad_alum'),
            data.get('ubica_inst_muni_alum'),
            data.get('ano_grad_alum'),
            data.get('tipo_colegio', 'Público'),
            data.get('carrera'),
            data.get('modalidad_ing', 'REGULAR'),
            data.get('condicion_resi', 'EXTERNO'),
            data.get('turno_class', 'DIURNO'),
            'WEB',
            'REGISTRADO_WEB',
            data.get('observaciones'),
            True,
            'WEB_PUBLIC_FORM',
            'WEB_PUBLIC_FORM'
        ]

        # Sanitización universal de última milla: limpiar espacios residuales o múltiples de cualquier cadena
        valores = [
            re.sub(r'\s+', ' ', v).strip() if (isinstance(v, str) and c != 'foto_alum') else v
            for c, v in zip(columnas, valores)
        ]

        placeholders = ', '.join(['%s'] * len(columnas))
        query_estudiante = f"""
            INSERT INTO academico.estudiantes ({', '.join(columnas)})
            VALUES ({placeholders});
        """
        cur.execute(query_estudiante, valores)

        # 4. Insertar prioridad en academico.estudiante_especialidades si la tabla existe
        try:
            query_esp = """
                INSERT INTO academico.estudiante_especialidades (ced_alum, prioridad, especialidad)
                VALUES (%s, 1, %s)
                ON CONFLICT (ced_alum) DO UPDATE SET especialidad = EXCLUDED.especialidad;
            """
            cur.execute(query_esp, (ced_int, data['carrera']))
        except Exception as e_esp:
            logger.warning(f"Aviso tabla especialidades: {e_esp}")

        conn.commit()
        release_db(conn, cur, commit=False)
        return True, None

    except Exception as e:
        logger.error(f"Error insertando aspirante web: {e}")
        release_db(conn, cur, commit=False)
        return False, str(e)
