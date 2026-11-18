import logging
import os
import re
import glob
import base64
import unicodedata
from database import get_db_cursor, release_db

logger = logging.getLogger("IUAC_DB_OPS")

# Directorio oficial para alojar las fotografías tipo carnet de los aspirantes (/fotos_aspirantes)
FOTOS_ASPIRANTES_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'fotos_aspirantes'))
FOTOS_ASPIRANTES_FRONTEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'frontend', 'fotos_aspirantes'))

# Directorio oficial para alojar las fotocopias de cédula de representantes (/cedulas_representantes)
CEDULAS_REPRES_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'cedulas_representantes'))
CEDULAS_REPRES_FRONTEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'frontend', 'cedulas_representantes'))
os.makedirs(CEDULAS_REPRES_DIR, exist_ok=True)
os.makedirs(CEDULAS_REPRES_FRONTEND_DIR, exist_ok=True)

# Directorio oficial para alojar las fotocopias / escaneos de cédula del ASPIRANTE (/cedulas_aspirantes)
CEDULAS_ALUM_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'cedulas_aspirantes'))
CEDULAS_ALUM_FRONTEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'frontend', 'cedulas_aspirantes'))
os.makedirs(CEDULAS_ALUM_DIR, exist_ok=True)
os.makedirs(CEDULAS_ALUM_FRONTEND_DIR, exist_ok=True)

MAX_CEDULA_ALUM_BYTES = 5 * 1024 * 1024  # 5 MB

def detectar_tipo_documento(doc_bytes):
    """Identifica el tipo real del archivo por su firma binaria (magic bytes)."""
    if not doc_bytes:
        return None
    if doc_bytes[:3] == b'\xff\xd8\xff':
        return 'jpg'
    if doc_bytes[:8] == b'\x89PNG\r\n\x1a\n':
        return 'png'
    if doc_bytes[:5] == b'%PDF-':
        return 'pdf'
    return None

def _normalizar_token_nombre(texto, fallback):
    """Extrae la primera palabra sin acentos ni caracteres especiales en minúscula."""
    if not texto or not str(texto).strip():
        return fallback
    primera = str(texto).strip().split()[0]
    sin_acentos = ''.join(
        c for c in unicodedata.normalize('NFKD', primera)
        if not unicodedata.combining(c)
    )
    limpio = re.sub(r'[^a-zA-Z0-9]', '', sin_acentos).lower()
    return limpio or fallback

def construir_nombre_archivo_foto(cedula_str, nom_alum='', ape_alum='', ext='jpg'):
    """
    Construye el nombre personalizado de la fotografía del aspirante:
    primer_nom_primer_ape-ced_aspirante.jpg (o .png)
    Ejemplo: jorge_gonzalez-11270783.jpg
    """
    ced_digits = re.sub(r'\D', '', str(cedula_str)) or str(cedula_str)
    primer_nom = _normalizar_token_nombre(nom_alum, 'aspirante')
    primer_ape = _normalizar_token_nombre(ape_alum, 'iuac')
    ext_clean = 'png' if str(ext).lower().lstrip('.') == 'png' else 'jpg'
    return f"{primer_nom}_{primer_ape}-{ced_digits}.{ext_clean}"

def guardar_foto_aspirante(foto_base64, cedula_str, upload_dir=None, nom_alum='', ape_alum='', ext='jpg'):
    """
    Valida una imagen en base64, la aloja físicamente en la carpeta '/fotos_aspirantes'
    bajo el formato personalizado 'primer_nom_primer_ape-ced_aspirante.jpg' (o .png)
    y retorna una tupla (data_uri, filename).
    """
    if not foto_base64 or not isinstance(foto_base64, str):
        return None, None
    try:
        if ',' in foto_base64:
            header, encoded = foto_base64.split(',', 1)
        else:
            header = 'data:image/jpeg;base64'
            encoded = foto_base64

        encoded = encoded.strip()
        img_bytes = base64.b64decode(encoded)
        if len(img_bytes) > 6 * 1024 * 1024:  # Máx 6MB
            logger.warning(f"Foto excede tamaño permitido: {len(img_bytes)} bytes")
            return None, None

        es_png = ('image/png' in header.lower()) or (str(ext).lower().lstrip('.') == 'png')
        ext_final = 'png' if es_png else 'jpg'
        mime_type = 'image/png' if es_png else 'image/jpeg'

        ced_digits = re.sub(r'\D', '', str(cedula_str)) or str(cedula_str)
        filename = construir_nombre_archivo_foto(ced_digits, nom_alum=nom_alum, ape_alum=ape_alum, ext=ext_final)

        # Guardar copia física en carpeta /fotos_aspirantes (raíz y frontend) limpiando versiones previas de la misma cédula
        for target_dir in (FOTOS_ASPIRANTES_DIR, FOTOS_ASPIRANTES_FRONTEND_DIR, upload_dir):
            if not target_dir:
                continue
            try:
                os.makedirs(target_dir, exist_ok=True)
                for prev in glob.glob(os.path.join(target_dir, f"*-{ced_digits}.*")) + glob.glob(os.path.join(target_dir, f"foto_{ced_digits}.*")):
                    try:
                        if os.path.basename(prev) != filename:
                            os.remove(prev)
                    except Exception:
                        pass
                filepath = os.path.join(target_dir, filename)
                with open(filepath, 'wb') as f:
                    f.write(img_bytes)
            except Exception:
                pass

        data_uri = f"data:{mime_type};base64,{encoded}"
        logger.info(f"Foto guardada en /fotos_aspirantes/{filename} y procesada para BD ({len(img_bytes)} bytes)")
        return data_uri, filename
    except Exception as e:
        logger.warning(f"No se pudo procesar foto del aspirante {cedula_str}: {e}")
        return None, None

def guardar_cedula_representante(doc_base64, cedula_aspirante, nom_repres='', ext='jpg'):
    """
    Guarda la fotocopia de la cédula del representante legal en /cedulas_representantes/
    con nombre cedula_repres_<cedula_aspirante>.<ext>
    Retorna (data_uri, filename)
    """
    if not doc_base64 or not isinstance(doc_base64, str):
        return None, None
    try:
        if ',' in doc_base64:
            header, encoded = doc_base64.split(',', 1)
        else:
            header = 'data:image/jpeg;base64'
            encoded = doc_base64

        encoded = encoded.strip()
        doc_bytes = base64.b64decode(encoded)
        if len(doc_bytes) > 8 * 1024 * 1024:  # Máx 8MB
            logger.warning(f"Cédula representante excede tamaño permitido: {len(doc_bytes)} bytes")
            return None, None

        es_pdf = ('application/pdf' in header.lower()) or (str(ext).lower().lstrip('.') == 'pdf')
        es_png = ('image/png' in header.lower()) or (str(ext).lower().lstrip('.') == 'png')
        if es_pdf:
            ext_final = 'pdf'
            mime_type = 'application/pdf'
        elif es_png:
            ext_final = 'png'
            mime_type = 'image/png'
        else:
            ext_final = 'jpg'
            mime_type = 'image/jpeg'

        ced_digits = re.sub(r'\D', '', str(cedula_aspirante)) or str(cedula_aspirante)
        filename = f"cedula_repres_{ced_digits}.{ext_final}"

        for target_dir in (CEDULAS_REPRES_DIR, CEDULAS_REPRES_FRONTEND_DIR):
            try:
                os.makedirs(target_dir, exist_ok=True)
                for prev in glob.glob(os.path.join(target_dir, f"cedula_repres_{ced_digits}.*")):
                    try:
                        if os.path.basename(prev) != filename:
                            os.remove(prev)
                    except Exception:
                        pass
                filepath = os.path.join(target_dir, filename)
                with open(filepath, 'wb') as f:
                    f.write(doc_bytes)
            except Exception:
                pass

        data_uri = f"data:{mime_type};base64,{encoded}"
        logger.info(f"Cédula representante guardada en /cedulas_representantes/{filename} ({len(doc_bytes)} bytes)")
        return data_uri, filename
    except Exception as e:
        logger.warning(f"No se pudo guardar cédula del representante para aspirante {cedula_aspirante}: {e}")
        return None, None

def guardar_cedula_aspirante(doc_base64, cedula_aspirante):
    """
    Guarda la fotocopia / escaneo de la cédula del aspirante en /cedulas_aspirantes/
    con nombre cedula_alum_<cedula>.<jpg|png|pdf>. Valida tamaño (máx 5 MB) y firma binaria.
    Retorna (filename, error).
    """
    if not doc_base64 or not isinstance(doc_base64, str):
        return None, "No se recibió el documento de cédula del aspirante."
    try:
        encoded = doc_base64.split(',', 1)[1] if ',' in doc_base64 else doc_base64
        encoded = re.sub(r'\s+', '', encoded)
        encoded += '=' * (-len(encoded) % 4)
        doc_bytes = base64.b64decode(encoded)
    except Exception:
        return None, "El archivo de la cédula del aspirante está dañado o no es válido."

    if len(doc_bytes) > MAX_CEDULA_ALUM_BYTES:
        return None, "La cédula del aspirante excede el tamaño máximo permitido de 5 MB."
    ext_final = detectar_tipo_documento(doc_bytes)
    if not ext_final:
        return None, "Formato de cédula no permitido. Solo se admiten archivos .JPG, .PNG o .PDF."

    ced_digits = re.sub(r'\D', '', str(cedula_aspirante)) or str(cedula_aspirante)
    filename = f"cedula_alum_{ced_digits}.{ext_final}"
    guardado = False
    for target_dir in (CEDULAS_ALUM_DIR, CEDULAS_ALUM_FRONTEND_DIR):
        try:
            os.makedirs(target_dir, exist_ok=True)
            for prev in glob.glob(os.path.join(target_dir, f"cedula_alum_{ced_digits}.*")):
                try:
                    if os.path.basename(prev) != filename:
                        os.remove(prev)
                except Exception:
                    pass
            with open(os.path.join(target_dir, filename), 'wb') as f:
                f.write(doc_bytes)
            guardado = True
        except Exception:
            pass
    if not guardado:
        return None, "No se pudo almacenar la cédula del aspirante en el servidor."
    logger.info(f"Cédula del aspirante guardada en /cedulas_aspirantes/{filename} ({len(doc_bytes)} bytes)")
    return filename, None

def asegurar_columnas_representante(cur, conn):
    """Garantiza que las columnas para aspirantes menores de edad existan en academico.estudiantes."""
    sentencias = [
        "ALTER TABLE academico.estudiantes ADD COLUMN IF NOT EXISTS fotocopia_cedula_repres TEXT;",
        "ALTER TABLE academico.estudiantes ADD COLUMN IF NOT EXISTS ced_repres VARCHAR(20);",
        "ALTER TABLE academico.estudiantes ADD COLUMN IF NOT EXISTS nom_repres VARCHAR(150);",
        "ALTER TABLE academico.estudiantes ADD COLUMN IF NOT EXISTS parentesco_repres VARCHAR(50);",
        "ALTER TABLE academico.estudiantes ADD COLUMN IF NOT EXISTS telemov_repres VARCHAR(50);",
        "ALTER TABLE academico.estudiantes ADD COLUMN IF NOT EXISTS fotocopia_cedula TEXT;",
        "ALTER TABLE academico.estudiantes ALTER COLUMN fotocopia_cedula TYPE TEXT;"
    ]
    for s in sentencias:
        try:
            cur.execute(s)
            conn.commit()
        except Exception:
            conn.rollback()

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
        asegurar_columnas_representante(cur, conn)
        query = """
            SELECT
                ced_alum, tipo_cedula, nom_alum, ape_alum, fec_nac_alum, edad_alum,
                sex_alum, est_civil_alum, pais_alum, est_alum, ciu_alum, direc_alum,
                lugar_nac_alum, nacionalidad_alum, foto_alum,
                telemov_alum, telehabi_alum, correo_alum,
                niv_acad_alum, inst_grad_alum, ano_grad_alum, tipo_colegio,
                carrera, created_at,
                fotocopia_cedula_repres, ced_repres, nom_repres, parentesco_repres, telemov_repres,
                fotocopia_cedula
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

        # Cargar foto en base64 desde la columna foto_alum de la BD o desde la carpeta /fotos_aspirantes
        foto_base64 = None
        foto_val = data.get('foto_alum')
        if foto_val and isinstance(foto_val, str):
            foto_str = foto_val.strip()
            if foto_str.startswith('data:image/'):
                foto_base64 = foto_str
            elif len(foto_str) > 300 and not foto_str.endswith('.jpg') and not foto_str.endswith('.png'):
                foto_base64 = f"data:image/jpeg;base64,{foto_str}"

        nombre_jpg = construir_nombre_archivo_foto(ced_int, data.get('nom_alum', ''), data.get('ape_alum', ''), 'jpg')
        nombre_png = construir_nombre_archivo_foto(ced_int, data.get('nom_alum', ''), data.get('ape_alum', ''), 'png')
        archivo_encontrado = nombre_jpg

        # Si no estaba en Base64 en BD, buscar en carpeta /fotos_aspirantes
        if not foto_base64:
            posibles_archivos = (
                [
                    os.path.join(FOTOS_ASPIRANTES_DIR, nombre_jpg),
                    os.path.join(FOTOS_ASPIRANTES_DIR, nombre_png),
                    os.path.join(FOTOS_ASPIRANTES_FRONTEND_DIR, nombre_jpg),
                    os.path.join(FOTOS_ASPIRANTES_FRONTEND_DIR, nombre_png),
                ]
                + glob.glob(os.path.join(FOTOS_ASPIRANTES_DIR, f"*-{ced_int}.*"))
                + glob.glob(os.path.join(FOTOS_ASPIRANTES_FRONTEND_DIR, f"*-{ced_int}.*"))
            )
            if foto_val and isinstance(foto_val, str) and len(foto_val) < 260:
                posibles_archivos.append(os.path.join(FOTOS_ASPIRANTES_DIR, os.path.basename(foto_val)))
            for fpath in posibles_archivos:
                if os.path.exists(fpath):
                    try:
                        archivo_encontrado = os.path.basename(fpath)
                        mime_t = 'image/png' if archivo_encontrado.lower().endswith('.png') else 'image/jpeg'
                        with open(fpath, 'rb') as f:
                            encoded = base64.b64encode(f.read()).decode('utf-8')
                            foto_base64 = f"data:{mime_t};base64,{encoded}"
                        break
                    except Exception:
                        pass

        data['foto_base64'] = foto_base64
        data['ruta_foto_archivo'] = f"/fotos_aspirantes/{archivo_encontrado}" if (foto_base64 or archivo_encontrado) else None
        data['enlace_foto'] = data['ruta_foto_archivo']
        
        # Enlace a la cédula del representante si existe
        repres_doc = data.get('fotocopia_cedula_repres')
        if repres_doc and isinstance(repres_doc, str) and repres_doc.strip():
            nombre_repres_doc = os.path.basename(repres_doc.strip())
            data['enlace_cedula_repres'] = f"/cedulas_representantes/{nombre_repres_doc}"
        else:
            data['enlace_cedula_repres'] = None

        # Enlace a la cédula del propio aspirante si existe
        ced_alum_doc = data.get('fotocopia_cedula')
        if ced_alum_doc and isinstance(ced_alum_doc, str) and ced_alum_doc.strip():
            data['enlace_cedula_aspirante'] = f"/cedulas_aspirantes/{os.path.basename(ced_alum_doc.strip())}"
        else:
            data['enlace_cedula_aspirante'] = None

        return data, None
    except Exception as e:
        logger.error(f"Error consultando aspirante por cédula {cedula}: {e}")
        return None, "Error al consultar los datos del aspirante en la base de datos."
    finally:
        release_db(conn, cur)

def actualizar_foto_aspirante(cedula, foto_base64, nom_alum='', ape_alum='', ext='jpg'):
    """
    Aloja la fotografía en la carpeta '/fotos_aspirantes' bajo el formato
    primer_nom_primer_ape-ced_aspirante.jpg (o .png) y actualiza el campo foto_alum
    de academico.estudiantes si el aspirante ya está inscrito.
    """
    if not foto_base64:
        return False, None, "No se recibió ninguna fotografía."
    try:
        ced_int = int(cedula)
    except Exception:
        return False, None, "Número de cédula inválido."

    conn, cur = get_db_cursor()
    nom_db = str(nom_alum or '').strip()
    ape_db = str(ape_alum or '').strip()

    if conn and (not nom_db or not ape_db):
        try:
            cur.execute("SELECT nom_alum, ape_alum FROM academico.estudiantes WHERE ced_alum = %s LIMIT 1;", (ced_int,))
            row = cur.fetchone()
            if row:
                nom_db = nom_db or (row[0] or '')
                ape_db = ape_db or (row[1] or '')
        except Exception:
            conn.rollback()

    foto_data_uri, filename = guardar_foto_aspirante(
        foto_base64,
        str(ced_int),
        FOTOS_ASPIRANTES_DIR,
        nom_alum=nom_db,
        ape_alum=ape_db,
        ext=ext
    )
    if not foto_data_uri:
        if conn:
            release_db(conn, cur, commit=False)
        return False, None, "El formato de la fotografía no es válido."

    if not conn:
        return True, filename, None

    try:
        try:
            cur.execute("ALTER TABLE academico.estudiantes ALTER COLUMN foto_alum TYPE TEXT;")
            conn.commit()
        except Exception:
            conn.rollback()

        cur.execute(
            "UPDATE academico.estudiantes SET foto_alum = %s, updated_at = CURRENT_TIMESTAMP WHERE ced_alum = %s;",
            (filename, ced_int)
        )
        conn.commit()
        release_db(conn, cur, commit=True)
        return True, filename, None
    except Exception as e:
        logger.error(f"Error actualizando foto de {cedula}: {e}")
        release_db(conn, cur, commit=False)
        return False, None, str(e)

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

        # Procesar fotografía si fue capturada o subida y alojarla como primer_nom_primer_ape-ced_aspirante.jpg/.png
        foto_nombre = None
        if data.get('foto_base64'):
            try:
                cur.execute("ALTER TABLE academico.estudiantes ALTER COLUMN foto_alum TYPE TEXT;")
                conn.commit()
            except Exception:
                conn.rollback()
            _, foto_filename = guardar_foto_aspirante(
                data.get('foto_base64'),
                str(ced_int),
                FOTOS_ASPIRANTES_DIR,
                nom_alum=data.get('nom_alum', ''),
                ape_alum=data.get('ape_alum', ''),
                ext=data.get('foto_ext', 'jpg')
            )
            foto_nombre = foto_filename

        # Asegurar columnas para representante legal y procesar documento si es menor de edad
        asegurar_columnas_representante(cur, conn)
        repres_doc_filename = None
        if data.get('repres_doc_base64'):
            _, repres_doc_filename = guardar_cedula_representante(
                data.get('repres_doc_base64'),
                str(ced_int),
                nom_repres=data.get('nom_repres', ''),
                ext=data.get('repres_doc_ext', 'jpg')
            )

        ruta_ced_repres = f"/cedulas_representantes/{repres_doc_filename}" if repres_doc_filename else None

        # Cédula del aspirante (obligatoria para menores y mayores de edad)
        ced_alum_filename, err_ced_doc = guardar_cedula_aspirante(data.get('cedula_doc_base64'), str(ced_int))
        if err_ced_doc:
            release_db(conn, cur, commit=False)
            return False, err_ced_doc
        ruta_ced_alum = f"/cedulas_aspirantes/{ced_alum_filename}"

        # 3. Columnas exactas que existen en academico.estudiantes
        columnas = [
            'ced_alum', 'tipo_cedula', 'nom_alum', 'ape_alum', 'fec_nac_alum', 'edad_alum',
            'sex_alum', 'est_civil_alum', 'pais_alum', 'est_alum', 'ciu_alum', 'direc_alum',
            'lugar_nac_alum', 'nacionalidad_alum', 'etnia', 'foto_alum',
            'telemov_alum', 'telehabi_alum', 'correo_alum',
            'niv_acad_alum', 'inst_grad_alum', 'ubica_inst_muni_alum', 'ano_grad_alum', 'tipo_colegio',
            'carrera', 'modalidad_ing', 'condicion_resi', 'turno_class',
            'canal_inscripcion', 'status_alum', 'observaciones', 'is_active', 'creado_por', 'actualizado_por',
            'fotocopia_cedula_repres', 'ced_repres', 'nom_repres', 'parentesco_repres', 'telemov_repres',
            'fotocopia_cedula'
        ]

        obs_texto = str(data.get('observaciones') or 'Ninguna').strip()
        if data.get('nom_repres'):
            obs_texto += f" | Representante: {data.get('nom_repres')} (CI: {data.get('ced_repres')}, {data.get('parentesco_repres', 'Familiar')}, Tel: {data.get('telemov_repres')})"

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
            obs_texto,
            True,
            'WEB_PUBLIC_FORM',
            'WEB_PUBLIC_FORM',
            ruta_ced_repres,
            data.get('ced_repres'),
            data.get('nom_repres'),
            data.get('parentesco_repres'),
            data.get('telemov_repres'),
            ruta_ced_alum
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
