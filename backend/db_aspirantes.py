import logging
import os
import re
import base64
from database import get_db_cursor, release_db

logger = logging.getLogger("IUAC_DB_OPS")

# Directorio oficial para alojar las fotografías tipo carnet de los aspirantes
FOTOS_ASPIRANTES_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'fotos_aspirantes'))
FOTOS_ASPIRANTES_FRONTEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'frontend', 'fotos_aspirantes'))

def guardar_foto_aspirante(foto_base64, cedula_str, upload_dir=None):
    """
    Valida una imagen en base64, la aloja físicamente en la carpeta 'fotos_aspirantes'
    (ej: fotos_aspirantes/foto_11270783.jpg) y retorna la cadena data:image/jpeg;base64,...
    para almacenarla en el campo foto_alum de academico.estudiantes en PostgreSQL.
    """
    if not foto_base64 or not isinstance(foto_base64, str):
        return None
    try:
        if ',' in foto_base64:
            header, encoded = foto_base64.split(',', 1)
        else:
            header = 'data:image/jpeg;base64'
            encoded = foto_base64

        encoded = encoded.strip()
        img_bytes = base64.b64decode(encoded)
        if len(img_bytes) > 6 * 1024 * 1024:  # Máx 6MB ya comprimida
            logger.warning(f"Foto excede tamaño permitido: {len(img_bytes)} bytes")
            return None

        # Limpiar cédula para el nombre del archivo en fotos_aspirantes
        ced_digits = re.sub(r'\D', '', str(cedula_str)) or str(cedula_str)
        filename = f"foto_{ced_digits}.jpg"

        # Guardar copia física en carpeta fotos_aspirantes (raíz y frontend)
        for target_dir in (FOTOS_ASPIRANTES_DIR, FOTOS_ASPIRANTES_FRONTEND_DIR, upload_dir):
            if not target_dir:
                continue
            try:
                os.makedirs(target_dir, exist_ok=True)
                filepath = os.path.join(target_dir, filename)
                with open(filepath, 'wb') as f:
                    f.write(img_bytes)
            except Exception:
                pass

        data_uri = f"data:image/jpeg;base64,{encoded}"
        logger.info(f"Foto guardada en fotos_aspirantes/{filename} y procesada para BD ({len(img_bytes)} bytes)")
        return data_uri
    except Exception as e:
        logger.warning(f"No se pudo procesar foto del aspirante {cedula_str}: {e}")
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

def obtener_aspirante_por_cedula(cedula):
    """
    Recupera los datos completos de un aspirante ya inscrito por su número de cédula
    para generar y descargar su Planilla Oficial de Preinscripción en PDF.
    Consulta parametrizada estricta (%s) contra inyección SQL.
    """
    conn, cur = get_db_cursor()
    if not conn:
        return None, "No hay conexión disponible con el servidor de base de datos."
    try:
        ced_int = int(cedula)
        query = """
            SELECT
                ced_alum, tipo_cedula, nom_alum, ape_alum, fec_nac_alum, edad_alum,
                sex_alum, est_civil_alum, pais_alum, est_alum, ciu_alum, direc_alum,
                lugar_nac_alum, nacionalidad_alum, foto_alum,
                telemov_alum, telehabi_alum, correo_alum,
                niv_acad_alum, inst_grad_alum, ano_grad_alum, tipo_colegio,
                carrera, created_at
            FROM academico.estudiantes
            WHERE ced_alum = %s
            LIMIT 1;
        """
        cur.execute(query, (ced_int,))
        row = cur.fetchone()
        if not row:
            return None, f"No se encontró ningún aspirante inscrito con la cédula {ced_int}."

        columnas = [desc[0] for desc in cur.description]
        data = dict(zip(columnas, row))

        # Formatear fechas a string ISO/legible
        if data.get('fec_nac_alum') and hasattr(data['fec_nac_alum'], 'isoformat'):
            data['fec_nac_alum'] = data['fec_nac_alum'].isoformat()
        if data.get('created_at') and hasattr(data['created_at'], 'strftime'):
            data['fecha_registro'] = data['created_at'].strftime('%d/%m/%Y, %I:%M %p')
            data['created_at'] = data['created_at'].isoformat()
        else:
            data['fecha_registro'] = ''

        # Cargar foto en base64 desde la columna foto_alum de la BD o desde la carpeta fotos_aspirantes
        foto_base64 = None
        foto_val = data.get('foto_alum')
        if foto_val and isinstance(foto_val, str):
            foto_str = foto_val.strip()
            if foto_str.startswith('data:image/'):
                foto_base64 = foto_str
            elif len(foto_str) > 300 and not foto_str.endswith('.jpg') and not foto_str.endswith('.png'):
                foto_base64 = f"data:image/jpeg;base64,{foto_str}"

        # Si no estaba en Base64 en BD, buscar en carpeta fotos_aspirantes
        if not foto_base64:
            posibles_archivos = [
                os.path.join(FOTOS_ASPIRANTES_DIR, f"foto_{ced_int}.jpg"),
                os.path.join(FOTOS_ASPIRANTES_FRONTEND_DIR, f"foto_{ced_int}.jpg"),
            ]
            if foto_val and isinstance(foto_val, str) and len(foto_val) < 260:
                posibles_archivos.append(os.path.join(FOTOS_ASPIRANTES_DIR, os.path.basename(foto_val)))
            for fpath in posibles_archivos:
                if os.path.exists(fpath):
                    try:
                        with open(fpath, 'rb') as f:
                            encoded = base64.b64encode(f.read()).decode('utf-8')
                            foto_base64 = f"data:image/jpeg;base64,{encoded}"
                        break
                    except Exception:
                        pass

        data['foto_base64'] = foto_base64
        data['ruta_foto_archivo'] = f"fotos_aspirantes/foto_{ced_int}.jpg" if foto_base64 else None
        return data, None
    except Exception as e:
        logger.error(f"Error consultando aspirante por cédula {cedula}: {e}")
        return None, "Error al consultar los datos del aspirante en la base de datos."
    finally:
        release_db(conn, cur)

def actualizar_foto_aspirante(cedula, foto_base64):
    """
    Aloja la fotografía en la carpeta 'fotos_aspirantes' (fotos_aspirantes/foto_<ced_alum>.jpg)
    y actualiza el campo foto_alum de academico.estudiantes si el aspirante ya está inscrito.
    """
    if not foto_base64:
        return False, "No se recibió ninguna fotografía."
    try:
        ced_int = int(cedula)
    except Exception:
        return False, "Número de cédula inválido."

    foto_data_uri = guardar_foto_aspirante(foto_base64, str(ced_int), FOTOS_ASPIRANTES_DIR)
    if not foto_data_uri:
        return False, "El formato de la fotografía no es válido."

    conn, cur = get_db_cursor()
    if not conn:
        # Aunque la BD no responda, ya quedó guardada en fotos_aspirantes
        return True, None
    try:
        try:
            cur.execute("ALTER TABLE academico.estudiantes ALTER COLUMN foto_alum TYPE TEXT;")
            conn.commit()
        except Exception:
            conn.rollback()

        cur.execute(
            "UPDATE academico.estudiantes SET foto_alum = %s, updated_at = CURRENT_TIMESTAMP WHERE ced_alum = %s;",
            (foto_data_uri, ced_int)
        )
        conn.commit()
        release_db(conn, cur, commit=True)
        return True, None
    except Exception as e:
        logger.error(f"Error actualizando foto de {cedula}: {e}")
        release_db(conn, cur, commit=False)
        return False, str(e)

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

        # Procesar fotografía si fue capturada o subida y asegurar que la columna foto_alum sea TEXT
        foto_nombre = None
        if data.get('foto_base64'):
            try:
                cur.execute("ALTER TABLE academico.estudiantes ALTER COLUMN foto_alum TYPE TEXT;")
                conn.commit()
            except Exception:
                conn.rollback()
            foto_nombre = guardar_foto_aspirante(data.get('foto_base64'), str(ced_int), FOTOS_ASPIRANTES_DIR)

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
        # Confirmar (COMMIT) inmediatamente el registro principal en academico.estudiantes
        # para que ningún fallo posterior en tablas secundarias pueda revertir la transacción
        conn.commit()

        # Verificar persistencia real en la base de datos antes de continuar
        cur.execute("SELECT ced_alum FROM academico.estudiantes WHERE ced_alum = %s;", (ced_int,))
        if not cur.fetchone():
            release_db(conn, cur, commit=False)
            return False, "Error de persistencia: el registro no pudo ser confirmado en la base de datos."
        conn.commit()

        # 4. Insertar prioridad en academico.estudiante_especialidades en transacción independiente
        # Se usa DELETE + INSERT en lugar de ON CONFLICT para ser 100% compatible con cualquier
        # restricción UNIQUE existente en Neon (sea ced_alum o ced_alum + prioridad).
        try:
            cur.execute("DELETE FROM academico.estudiante_especialidades WHERE ced_alum = %s;", (ced_int,))
            cur.execute(
                """
                INSERT INTO academico.estudiante_especialidades (ced_alum, prioridad, especialidad)
                VALUES (%s, 1, %s);
                """,
                (ced_int, data['carrera'])
            )
            conn.commit()
        except Exception as e_esp:
            try:
                conn.rollback()
            except Exception:
                pass
            logger.warning(f"Aviso tabla especialidades: {e_esp}")

        release_db(conn, cur, commit=True)
        return True, None

    except Exception as e:
        logger.error(f"Error insertando aspirante web: {e}")
        release_db(conn, cur, commit=False)
        return False, str(e)
