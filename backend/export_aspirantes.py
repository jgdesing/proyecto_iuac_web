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
import argparse
from datetime import datetime
from database import get_db_cursor, release_db

COLUMNAS_VACIADO_ESTUDIANTES = [
    'ced_alum', 'tipo_cedula', 'nom_alum', 'ape_alum', 'fec_nac_alum', 'edad_alum',
    'sex_alum', 'est_civil_alum', 'pais_alum', 'est_alum', 'ciu_alum', 'direc_alum',
    'lugar_nac_alum', 'nacionalidad_alum', 'etnia',
    'telemov_alum', 'telehabi_alum', 'correo_alum',
    'niv_acad_alum', 'inst_grad_alum', 'ubica_inst_muni_alum', 'ano_grad_alum', 'tipo_colegio',
    'carrera', 'modalidad_ing', 'condicion_resi', 'turno_class',
    'foto_alum', 'canal_inscripcion', 'status_alum', 'observaciones',
    'is_active', 'creado_por', 'actualizado_por'
]

def obtener_aspirantes_web(solo_pendientes=False, fecha_desde=None):
    """Consulta todos los aspirantes registrados en PostgreSQL (academico.estudiantes)."""
    conn, cur = get_db_cursor()
    if not conn:
        print("[ERROR] No se pudo conectar a la base de datos.")
        return []

    try:
        query = """
            SELECT 
                ced_alum, tipo_cedula, nom_alum, ape_alum, fec_nac_alum, edad_alum,
                sex_alum, est_civil_alum, pais_alum, est_alum, ciu_alum, direc_alum,
                lugar_nac_alum, nacionalidad_alum, etnia,
                telemov_alum, telehabi_alum, correo_alum,
                niv_acad_alum, inst_grad_alum, ubica_inst_muni_alum, ano_grad_alum, tipo_colegio,
                carrera, modalidad_ing, condicion_resi, turno_class,
                foto_alum, canal_inscripcion, status_alum, observaciones,
                is_active, creado_por, actualizado_por, created_at
            FROM academico.estudiantes
            WHERE 1=1
        """
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

        registros = []
        for r in filas:
            fila_dict = {}
            for col, val in zip(columnas, r):
                if isinstance(val, (datetime,)):
                    fila_dict[col] = val.strftime('%Y-%m-%d %H:%M:%S')
                elif hasattr(val, 'isoformat'):
                    fila_dict[col] = val.isoformat()
                else:
                    fila_dict[col] = val
            fila_dict['posee_foto'] = 'SI' if (fila_dict.get('foto_alum') and len(str(fila_dict.get('foto_alum'))) > 10) else 'NO'
            registros.append(fila_dict)

        return registros
    finally:
        release_db(conn, cur)

def generar_contenido_sql(registros):
    """
    Genera el contenido SQL completo para vaciar los aspirantes capturados en la web
    hacia la base de datos real del sistema: bd_aspirantes (esquema academico.estudiantes).
    Incluye la fotografía en el campo foto_alum y sincroniza academico.estudiante_especialidades.
    """
    out = io.StringIO()
    out.write("-- ==============================================================================\n")
    out.write("-- VACIADO OFICIAL DE ASPIRANTES WEB IUAC -> BASE DE DATOS REAL (bd_aspirantes)\n")
    out.write("-- ESQUEMA DESTINO: academico.estudiantes y academico.estudiante_especialidades\n")
    out.write(f"-- FECHA DE GENERACIÓN: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
    out.write(f"-- TOTAL DE ASPIRANTES EXPORTADOS: {len(registros)}\n")
    out.write("-- ==============================================================================\n\n")
    out.write("BEGIN;\n\n")
    out.write("-- Asegurar que el campo foto_alum en bd_aspirantes soporte la fotografía completa en Base64\n")
    out.write("ALTER TABLE academico.estudiantes ALTER COLUMN foto_alum TYPE TEXT;\n\n")

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

        out.write(f"-- Aspirante Cédula {reg.get('tipo_cedula', 'V')}-{ced_int}: {reg.get('nom_alum')} {reg.get('ape_alum')}\n")
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
        out.write("    telemov_alum = EXCLUDED.telemov_alum,\n")
        out.write("    telehabi_alum = EXCLUDED.telehabi_alum,\n")
        out.write("    correo_alum = EXCLUDED.correo_alum,\n")
        out.write("    niv_acad_alum = EXCLUDED.niv_acad_alum,\n")
        out.write("    inst_grad_alum = EXCLUDED.inst_grad_alum,\n")
        out.write("    ano_grad_alum = EXCLUDED.ano_grad_alum,\n")
        out.write("    tipo_colegio = EXCLUDED.tipo_colegio,\n")
        out.write("    carrera = EXCLUDED.carrera,\n")
        out.write("    foto_alum = COALESCE(EXCLUDED.foto_alum, academico.estudiantes.foto_alum),\n")
        out.write("    observaciones = EXCLUDED.observaciones,\n")
        out.write("    updated_at = CURRENT_TIMESTAMP;\n\n")

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
        'posee_foto', 'status_alum', 'observaciones', 'created_at'
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
