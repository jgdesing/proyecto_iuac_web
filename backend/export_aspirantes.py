"""
export_aspirantes.py - Módulo y Script CLI de exportación y vaciado de datos.
Permite extraer los registros capturados en la Landing Page web y generar:
1. Script SQL de inserción masiva limpia con ON CONFLICT DO UPDATE (para correr en bd_aspirantes -> academico.estudiantes).
2. Archivo Excel (.xls) formateado con encabezados institucionales y soporte completo de acentos/teléfonos.
3. Archivo CSV con BOM UTF-8 compatible directamente con Microsoft Excel.
4. Formato JSON para consumo por API o migrador.
"""

import os
import sys
import io
import csv
import html
import json
import re
import glob
import base64
import argparse
from datetime import datetime

try:
    from database import get_db_cursor, release_db
except ImportError:
    from backend.database import get_db_cursor, release_db

# ── COLUMNAS OFICIALES PARA VACIADO EN ACADEMICO.ESTUDIANTES ─────────────────
# 100% compatible con el esquema de bd_aspirantes y el módulo de Recepción Online
COLUMNAS_VACIADO_ESTUDIANTES = [
    'ced_alum', 'tipo_cedula', 'nom_alum', 'ape_alum', 'fec_nac_alum', 'edad_alum',
    'sex_alum', 'est_civil_alum', 'pais_alum', 'est_alum', 'ciu_alum', 'direc_alum',
    'lugar_nac_alum', 'nacionalidad_alum', 'etnia',
    'telemov_alum', 'telehabi_alum', 'correo_alum',
    'niv_acad_alum', 'inst_grad_alum', 'ubica_inst_muni_alum', 'ano_grad_alum', 'tipo_colegio',
    'carrera', 'modalidad_ing', 'condicion_resi', 'turno_class',
    'foto_alum', 'fotocopia_cedula', 'fotocopia_cedula_repres',
    'ced_repres', 'nom_repres', 'parentesco_repres', 'telemov_repres',
    'derechos_aeronauticos', 'comprobante_derechos',
    'canal_inscripcion', 'status_alum', 'nucleo', 'observaciones',
    'is_active', 'creado_por', 'actualizado_por'
]

def resolver_archivo_a_base64(valor_campo, subcarpetas, prefijo=None):
    """
    Garantiza que la fotografía o documento viaje incrustado en el archivo SQL.
    Si el campo ya contiene un Data URI ('data:image/...'), se conserva íntegro.
    Si contiene un nombre de archivo relativo o existe en disco, lo lee y lo
    convierte a Data URI Base64 para máxima portabilidad entre servidores.
    """
    if not valor_campo and not prefijo:
        return None

    val_str = str(valor_campo).strip() if valor_campo else ""
    if val_str.startswith("data:"):
        return val_str

    base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    candidatos = []

    # 1. Búsqueda por nombre de archivo exacto
    if val_str:
        nombre_limpio = os.path.basename(val_str)
        for sub in subcarpetas:
            candidatos.append(os.path.join(base_dir, sub, nombre_limpio))
            candidatos.append(os.path.join(base_dir, nombre_limpio))

    # 2. Búsqueda por patrón de prefijo (ej: foto_12345678.*)
    if prefijo:
        for sub in subcarpetas:
            candidatos.extend(glob.glob(os.path.join(base_dir, sub, f"{prefijo}.*")))

    for path in candidatos:
        if os.path.isfile(path):
            try:
                with open(path, 'rb') as f:
                    doc_bytes = f.read()
                if doc_bytes and len(doc_bytes) > 20:
                    ext = os.path.splitext(path)[1].lower().lstrip('.')
                    mime = 'image/jpeg'
                    if ext == 'png':
                        mime = 'image/png'
                    elif ext == 'pdf':
                        mime = 'application/pdf'
                    b64 = base64.b64encode(doc_bytes).decode('ascii')
                    return f"data:{mime};base64,{b64}"
            except Exception:
                pass

    return valor_campo

def obtener_aspirantes_web(solo_pendientes=False, fecha_desde=None):
    """
    Consulta todos los aspirantes registrados en PostgreSQL (academico.estudiantes),
    incorporando trazabilidad de fotos, representantes y logs de SMS.
    """
    conn, cur = get_db_cursor()
    if not conn:
        print("[ERROR] No se pudo conectar a la base de datos.")
        return []

    try:
        # Consulta global dinámica de todas las columnas existentes
        query = "SELECT * FROM academico.estudiantes WHERE 1=1"
        params = []
        if solo_pendientes:
            query += " AND status_alum = 'REGISTRADO_WEB'"
        if fecha_desde:
            query += " AND created_at >= %s"
            params.append(fecha_desde)

        query += " ORDER BY created_at ASC, ced_alum ASC;"

        cur.execute(query, tuple(params))
        columnas = [desc[0] for desc in cur.description]
        filas = cur.fetchall()

        # Consultar SMS logs para vincular folio y acuse de recibo si la tabla existe
        sms_dict = {}
        try:
            cur.execute("""
                SELECT DISTINCT ON (ced_alum) ced_alum, acuse_recibo, folio, fecha_envio, estado
                FROM academico.sms_logs
                ORDER BY ced_alum, fecha_envio DESC;
            """)
            for row in cur.fetchall():
                sms_dict[row[0]] = {
                    'acuse_recibo': row[1],
                    'folio': row[2],
                    'fecha_envio': row[3],
                    'estado_sms': row[4]
                }
        except Exception:
            pass  # Si aún no existe academico.sms_logs, continúa de forma segura

        registros = []
        for r in filas:
            fila_dict = {}
            for col, val in zip(columnas, r):
                if isinstance(val, datetime):
                    fila_dict[col] = val.strftime('%Y-%m-%d %H:%M:%S')
                elif hasattr(val, 'isoformat'):
                    fila_dict[col] = val.isoformat()
                else:
                    fila_dict[col] = val

            ced = fila_dict.get('ced_alum')

            # Acoplar acuse de recibo y folio de notificación
            if ced in sms_dict:
                fila_dict['acuse_recibo_sms'] = sms_dict[ced].get('acuse_recibo')
                fila_dict['folio_sms'] = sms_dict[ced].get('folio')
                fila_dict['estado_sms'] = sms_dict[ced].get('estado_sms')
            else:
                fila_dict['acuse_recibo_sms'] = f"ACK-IUAC-WEB-{ced}"
                fila_dict['folio_sms'] = f"IUAC-2026-{ced}"
                fila_dict['estado_sms'] = 'REGISTRADO'

            # Resolver y embeber imágenes físicas a Base64 para que viajen dentro del SQL
            fila_dict['foto_alum'] = resolver_archivo_a_base64(
                fila_dict.get('foto_alum'),
                subcarpetas=['fotos_aspirantes', 'frontend/fotos_aspirantes'],
                prefijo=f"foto_{ced}"
            )
            fila_dict['fotocopia_cedula_repres'] = resolver_archivo_a_base64(
                fila_dict.get('fotocopia_cedula_repres'),
                subcarpetas=['cedulas_representantes', 'frontend/cedulas_representantes'],
                prefijo=f"cedula_repres_{ced}"
            )

            fila_dict['posee_foto'] = 'SI' if (fila_dict.get('foto_alum') and len(str(fila_dict.get('foto_alum'))) > 10) else 'NO'
            fila_dict['posee_cedula_repres'] = 'SI' if (fila_dict.get('fotocopia_cedula_repres') and len(str(fila_dict.get('fotocopia_cedula_repres'))) > 10) else 'NO'
            registros.append(fila_dict)

        return registros
    finally:
        release_db(conn, cur)

def generar_contenido_sql(registros):
    """
    Genera el contenido SQL completo para vaciar los aspirantes capturados en la web
    hacia la base de datos real del sistema: bd_aspirantes (esquema academico.estudiantes).
    Incluye:
    - Blindaje DDL para creación de columnas de fotos, representantes y núcleos si faltaran.
    - Fotografías en Base64 para que el importador las extraiga y guarde automáticamente.
    - Sincronización en academico.estudiante_especialidades.
    - Cláusula ON CONFLICT (ced_alum) DO UPDATE para compatibilidad total con el modal de recepción.
    """
    out = io.StringIO()
    out.write("-- ==============================================================================\n")
    out.write("-- VACIADO OFICIAL DE ASPIRANTES WEB IUAC -> BASE DE DATOS REAL (bd_aspirantes)\n")
    out.write("-- ESQUEMA DESTINO: academico.estudiantes y academico.estudiante_especialidades\n")
    out.write(f"-- FECHA DE GENERACIÓN: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
    out.write(f"-- TOTAL DE ASPIRANTES EXPORTADOS: {len(registros)}\n")
    out.write("-- COMPATIBILIDAD: Modal de Recepción Online IUAC (Blindaje Anti-Inyección y Detección de Duplicados)\n")
    out.write("-- ==============================================================================\n\n")
    out.write("BEGIN;\n\n")

    # 1. Ajustes DDL preventivos e idempotentes en bd_aspirantes
    out.write("-- 1. Garantizar columnas requeridas en bd_aspirantes (Fotografías y Representantes)\n")
    out.write("ALTER TABLE academico.estudiantes ALTER COLUMN foto_alum TYPE TEXT;\n")
    out.write("ALTER TABLE academico.estudiantes ADD COLUMN IF NOT EXISTS tipo_cedula VARCHAR(10) DEFAULT 'V';\n")
    out.write("ALTER TABLE academico.estudiantes ADD COLUMN IF NOT EXISTS fotocopia_cedula VARCHAR(255);\n")
    out.write("ALTER TABLE academico.estudiantes ADD COLUMN IF NOT EXISTS fotocopia_cedula_repres TEXT;\n")
    out.write("ALTER TABLE academico.estudiantes ADD COLUMN IF NOT EXISTS ced_repres VARCHAR(20);\n")
    out.write("ALTER TABLE academico.estudiantes ADD COLUMN IF NOT EXISTS nom_repres VARCHAR(150);\n")
    out.write("ALTER TABLE academico.estudiantes ADD COLUMN IF NOT EXISTS parentesco_repres VARCHAR(50);\n")
    out.write("ALTER TABLE academico.estudiantes ADD COLUMN IF NOT EXISTS telemov_repres VARCHAR(50);\n")
    out.write("ALTER TABLE academico.estudiantes ADD COLUMN IF NOT EXISTS nucleo VARCHAR(50) DEFAULT 'SEDE CENTRAL';\n")
    out.write("ALTER TABLE academico.estudiantes ADD COLUMN IF NOT EXISTS derechos_aeronauticos VARCHAR(255);\n")
    out.write("ALTER TABLE academico.estudiantes ADD COLUMN IF NOT EXISTS comprobante_derechos VARCHAR(255);\n\n")

    if not registros:
        out.write("-- No hay registros capturados actualmente para exportar.\n")
        out.write("COMMIT;\n")
        return out.getvalue()

    for reg in registros:
        vals = []
        for col in COLUMNAS_VACIADO_ESTUDIANTES:
            val = reg.get(col)
            if val is None:
                vals.append("NULL")
            elif isinstance(val, bool):
                vals.append("TRUE" if val else "FALSE")
            elif isinstance(val, (int, float)):
                vals.append(str(val))
            else:
                clean_str = str(val).replace("'", "''")
                vals.append(f"'{clean_str}'")

        cols_str = ", ".join(COLUMNAS_VACIADO_ESTUDIANTES)
        vals_str = ", ".join(vals)
        ced_int = int(reg.get('ced_alum'))

        out.write(f"-- Aspirante Cédula {reg.get('tipo_cedula', 'V')}-{ced_int}: {reg.get('nom_alum')} {reg.get('ape_alum')} | Carrera: {reg.get('carrera')}\n")
        out.write(f"INSERT INTO academico.estudiantes ({cols_str})\n")
        out.write(f"VALUES ({vals_str})\n")
        out.write("ON CONFLICT (ced_alum) DO UPDATE SET\n")
        out.write("    tipo_cedula = EXCLUDED.tipo_cedula,\n")
        out.write("    nom_alum = EXCLUDED.nom_alum,\n")
        out.write("    ape_alum = EXCLUDED.ape_alum,\n")
        out.write("    fec_nac_alum = EXCLUDED.fec_nac_alum,\n")
        out.write("    edad_alum = EXCLUDED.edad_alum,\n")
        out.write("    sex_alum = EXCLUDED.sex_alum,\n")
        out.write("    est_civil_alum = EXCLUDED.est_civil_alum,\n")
        out.write("    pais_alum = EXCLUDED.pais_alum,\n")
        out.write("    est_alum = EXCLUDED.est_alum,\n")
        out.write("    ciu_alum = EXCLUDED.ciu_alum,\n")
        out.write("    direc_alum = EXCLUDED.direc_alum,\n")
        out.write("    lugar_nac_alum = EXCLUDED.lugar_nac_alum,\n")
        out.write("    nacionalidad_alum = EXCLUDED.nacionalidad_alum,\n")
        out.write("    etnia = EXCLUDED.etnia,\n")
        out.write("    telemov_alum = EXCLUDED.telemov_alum,\n")
        out.write("    telehabi_alum = EXCLUDED.telehabi_alum,\n")
        out.write("    correo_alum = EXCLUDED.correo_alum,\n")
        out.write("    niv_acad_alum = EXCLUDED.niv_acad_alum,\n")
        out.write("    inst_grad_alum = EXCLUDED.inst_grad_alum,\n")
        out.write("    ubica_inst_muni_alum = EXCLUDED.ubica_inst_muni_alum,\n")
        out.write("    ano_grad_alum = EXCLUDED.ano_grad_alum,\n")
        out.write("    tipo_colegio = EXCLUDED.tipo_colegio,\n")
        out.write("    carrera = EXCLUDED.carrera,\n")
        out.write("    modalidad_ing = EXCLUDED.modalidad_ing,\n")
        out.write("    condicion_resi = EXCLUDED.condicion_resi,\n")
        out.write("    turno_class = EXCLUDED.turno_class,\n")
        out.write("    foto_alum = COALESCE(EXCLUDED.foto_alum, academico.estudiantes.foto_alum),\n")
        out.write("    fotocopia_cedula = COALESCE(EXCLUDED.fotocopia_cedula, academico.estudiantes.fotocopia_cedula),\n")
        out.write("    fotocopia_cedula_repres = COALESCE(EXCLUDED.fotocopia_cedula_repres, academico.estudiantes.fotocopia_cedula_repres),\n")
        out.write("    ced_repres = EXCLUDED.ced_repres,\n")
        out.write("    nom_repres = EXCLUDED.nom_repres,\n")
        out.write("    parentesco_repres = EXCLUDED.parentesco_repres,\n")
        out.write("    telemov_repres = EXCLUDED.telemov_repres,\n")
        out.write("    derechos_aeronauticos = EXCLUDED.derechos_aeronauticos,\n")
        out.write("    comprobante_derechos = EXCLUDED.comprobante_derechos,\n")
        out.write("    nucleo = EXCLUDED.nucleo,\n")
        out.write("    status_alum = EXCLUDED.status_alum,\n")
        out.write("    observaciones = EXCLUDED.observaciones,\n")
        out.write("    updated_at = CURRENT_TIMESTAMP;\n\n")

        # 2. Sincronizar Prioridad y Carrera en academico.estudiante_especialidades
        carrera = str(reg.get('carrera', 'CTA')).replace("'", "''")
        out.write(f"DELETE FROM academico.estudiante_especialidades WHERE ced_alum = {ced_int};\n")
        out.write("INSERT INTO academico.estudiante_especialidades (ced_alum, prioridad, especialidad)\n")
        out.write(f"VALUES ({ced_int}, 1, '{carrera}');\n\n")

    out.write("COMMIT;\n")
    out.write("-- Fin de vaciado exitoso hacia bd_aspirantes (academico.estudiantes).\n")
    return out.getvalue()

def exportar_a_sql(registros, output_file="vaciado_aspirantes_iuac.sql"):
    """Escribe el script SQL de vaciado en disco."""
    sql_text = generar_contenido_sql(registros)
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write(sql_text)
    print(f"[OK] Archivo SQL de vaciado generado: {output_file} ({len(registros)} registros)")
    return output_file

def generar_contenido_csv(registros):
    """Genera contenido CSV con BOM UTF-8 (utf-8-sig) para abrir directamente en Excel sin perder acentos."""
    columnas_csv = [
        'ced_alum', 'tipo_cedula', 'nom_alum', 'ape_alum', 'fec_nac_alum', 'edad_alum',
        'sex_alum', 'est_civil_alum', 'nacionalidad_alum', 'lugar_nac_alum',
        'pais_alum', 'est_alum', 'ciu_alum', 'direc_alum',
        'telemov_alum', 'telehabi_alum', 'correo_alum',
        'carrera', 'niv_acad_alum', 'inst_grad_alum', 'ano_grad_alum', 'tipo_colegio',
        'posee_foto', 'posee_cedula_repres',
        'ced_repres', 'nom_repres', 'parentesco_repres', 'telemov_repres',
        'acuse_recibo_sms', 'folio_sms', 'status_alum', 'observaciones', 'created_at'
    ]
    output_csv = io.StringIO()
    output_csv.write('\ufeff')  # BOM UTF-8 para Microsoft Excel
    writer = csv.DictWriter(output_csv, fieldnames=columnas_csv, delimiter=';')
    writer.writeheader()
    for r in registros:
        writer.writerow({k: (r.get(k) if r.get(k) is not None else '') for k in columnas_csv})
    return output_csv.getvalue()

def exportar_a_csv(registros, output_file="aspirantes_web_iuac.csv"):
    """Exporta a archivo CSV en disco."""
    csv_text = generar_contenido_csv(registros)
    with open(output_file, 'w', newline='', encoding='utf-8-sig') as f:
        f.write(csv_text.lstrip('\ufeff'))
    print(f"[OK] Archivo CSV generado: {output_file} ({len(registros)} registros)")
    return output_file

def generar_contenido_excel(registros):
    """
    Genera un libro nativo compatible con Microsoft Excel (.xls) con codificación UTF-8,
    encabezados institucionales, bordes y formato texto en teléfonos/cédulas.
    """
    encabezados = [
        ('ced_alum', 'CÉDULA'),
        ('tipo_cedula', 'TIPO'),
        ('nom_alum', 'NOMBRES COMPLETOS'),
        ('ape_alum', 'APELLIDOS COMPLETOS'),
        ('fec_nac_alum', 'FECHA NACIMIENTO'),
        ('edad_alum', 'EDAD'),
        ('sex_alum', 'GÉNERO'),
        ('est_civil_alum', 'ESTADO CIVIL'),
        ('nacionalidad_alum', 'NACIONALIDAD'),
        ('lugar_nac_alum', 'LUGAR DE NACIMIENTO'),
        ('est_alum', 'ESTADO RESIDENCIA'),
        ('ciu_alum', 'CIUDAD / MUNICIPIO'),
        ('direc_alum', 'DIRECCIÓN DE HABITACIÓN'),
        ('telemov_alum', 'TELÉFONO MÓVIL'),
        ('telehabi_alum', 'TELÉFONO HABITACIÓN'),
        ('correo_alum', 'CORREO ELECTRÓNICO'),
        ('carrera', 'CARRERA / ESPECIALIDAD'),
        ('niv_acad_alum', 'NIVEL ACADÉMICO'),
        ('inst_grad_alum', 'INSTITUCIÓN DE EGRESO'),
        ('ano_grad_alum', 'AÑO GRADUACIÓN'),
        ('tipo_colegio', 'TIPO COLEGIO'),
        ('posee_foto', 'FOTO EN BD'),
        ('posee_cedula_repres', 'CÉDULA REPRES.'),
        ('nom_repres', 'NOMBRE REPRESENTANTE'),
        ('ced_repres', 'C.I. REPRESENTANTE'),
        ('parentesco_repres', 'PARENTESCO'),
        ('telemov_repres', 'TELÉFONO REPRES.'),
        ('acuse_recibo_sms', 'ACUSE SMS'),
        ('folio_sms', 'FOLIO ASIGNADO'),
        ('status_alum', 'ESTATUS'),
        ('created_at', 'FECHA REGISTRO')
    ]

    out = io.StringIO()
    out.write('<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">\n')
    out.write('<head><meta charset="UTF-8">\n')
    out.write('<style>\n')
    out.write('table { border-collapse: collapse; font-family: Arial, sans-serif; font-size: 10pt; }\n')
    out.write('th { background-color: #0a192f; color: #ffffff; font-weight: bold; border: 1px solid #334155; padding: 6px 10px; }\n')
    out.write('td { border: 1px solid #cbd5e1; padding: 5px 8px; vertical-align: middle; }\n')
    out.write('.txt { mso-number-format:"\\@"; }\n')
    out.write('</style></head><body>\n')
    out.write('<h3>INSTITUTO UNIVERSITARIO DE AERONÁUTICA CIVIL (IUAC) — LISTADO OFICIAL DE ASPIRANTES PREINSCRITOS</h3>\n')
    out.write(f'<p><strong>Fecha de Emisión:</strong> {datetime.now().strftime("%d/%m/%Y %H:%M:%S")} &nbsp;|&nbsp; <strong>Total Aspirantes:</strong> {len(registros)}</p>\n')
    out.write('<table><thead><tr>\n')
    for _, titulo in encabezados:
        out.write(f'<th>{html.escape(titulo)}</th>')
    out.write('</tr></thead><tbody>\n')

    campos_texto_forzado = {'telemov_alum', 'telehabi_alum', 'fec_nac_alum', 'created_at'}
    for r in registros:
        out.write('<tr>')
        for key, _ in encabezados:
            val = r.get(key)
            val_str = '' if val is None else str(val)
            cls = ' class="txt"' if key in campos_texto_forzado else ''
            out.write(f'<td{cls}>{html.escape(val_str)}</td>')
        out.write('</tr>\n')

    out.write('</tbody></table></body></html>')
    return out.getvalue()

def marcar_como_procesados(cedulas):
    """Actualiza el estado de los aspirantes en el hosting a 'PROCESADO_SISTEMA'."""
    if not cedulas:
        return 0
    conn, cur = get_db_cursor()
    if not conn:
        return 0
    try:
        placeholders = ', '.join(['%s'] * len(cedulas))
        query = f"""
            UPDATE academico.estudiantes
            SET status_alum = 'PROCESADO_SISTEMA', updated_at = CURRENT_TIMESTAMP
            WHERE ced_alum IN ({placeholders});
        """
        cur.execute(query, tuple(cedulas))
        afectados = cur.rowcount
        release_db(conn, cur, commit=True)
        return afectados
    except Exception as e:
        release_db(conn, cur, commit=False)
        print(f"[ERROR] Marcando aspirantes procesados: {e}")
        return 0

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="Exportador y Vaciador de Aspirantes Web IUAC")
    parser.add_argument('--format', choices=['sql', 'csv', 'excel', 'json'], default='sql', help="Formato de exportación")
    parser.add_argument('--output', default=None, help="Nombre de archivo destino")
    parser.add_argument('--solo-pendientes', action='store_true', help="Solo exportar aspirantes con estado REGISTRADO_WEB")
    parser.add_argument('--marcar', action='store_true', help="Marcar como procesados después de exportar")

    args = parser.parse_args()
    aspirantes = obtener_aspirantes_web(solo_pendientes=args.solo_pendientes)
    print(f"Total aspirantes encontrados: {len(aspirantes)}")

    nombre_archivo = args.output
    if args.format == 'sql':
        out = nombre_archivo or f"vaciado_iuac_{datetime.now().strftime('%Y%m%d_%H%M%S')}.sql"
        exportar_a_sql(aspirantes, out)
    elif args.format == 'csv':
        out = nombre_archivo or f"aspirantes_iuac_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
        exportar_a_csv(aspirantes, out)
    elif args.format == 'excel':
        out = nombre_archivo or f"aspirantes_iuac_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xls"
        with open(out, 'w', encoding='utf-8') as f:
            f.write(generar_contenido_excel(aspirantes))
        print(f"[OK] Archivo Excel generado: {out}")
    elif args.format == 'json':
        out = nombre_archivo or f"aspirantes_iuac_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        with open(out, 'w', encoding='utf-8') as f:
            json.dump(aspirantes, f, ensure_ascii=False, indent=2)
        print(f"[OK] Archivo JSON generado: {out}")

    if args.marcar and aspirantes:
        ceds = [r['ced_alum'] for r in aspirantes]
        afectados = marcar_como_procesados(ceds)
        print(f"[OK] {afectados} aspirantes marcados como PROCESADO_SISTEMA.")
