"""
export_aspirantes.py - Módulo y Script CLI de exportación y vaciado de datos.
Permite extraer los registros capturados en la Landing Page web y generar:
1. Script SQL de inserción masiva limpia con ON CONFLICT DO UPDATE (para correr en SisCE IUAC).
2. Archivo CSV con formato compatible con Excel.
3. Formato JSON para consumo por API o migrador.
"""

import os
import sys
import csv
import json
import argparse
from datetime import datetime
from database import get_db_cursor, release_db

def obtener_aspirantes_web(solo_pendientes=False, fecha_desde=None):
    """Consulta los aspirantes registrados vía web desde PostgreSQL."""
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
                foto_alum, canal_inscripcion, status_alum, observaciones, created_at
            FROM academico.estudiantes
            WHERE canal_inscripcion = 'WEB'
        """
        params = []
        if solo_pendientes:
            query += " AND status_alum = 'REGISTRADO_WEB'"
        if fecha_desde:
            query += " AND created_at >= %s"
            params.append(fecha_desde)

        query += " ORDER BY created_at ASC;"

        cur.execute(query, tuple(params))
        columnas = [desc[0] for desc in cur.description]
        filas = cur.fetchall()

        registros = []
        for r in filas:
            fila_dict = {}
            for col, val in zip(columnas, r):
                if isinstance(val, (datetime,)):
                    fila_dict[col] = val.isoformat()
                elif hasattr(val, 'isoformat'):
                    fila_dict[col] = val.isoformat()
                else:
                    fila_dict[col] = val
            registros.append(fila_dict)

        return registros
    finally:
        release_db(conn, cur)

def exportar_a_sql(registros, output_file="vaciado_aspirantes_iuac.sql"):
    """Genera sentencias SQL limpias con ON CONFLICT para el sistema principal."""
    if not registros:
        print("[AVISO] No hay registros para exportar.")
        return None

    columnas_base = [
        'ced_alum', 'tipo_cedula', 'nom_alum', 'ape_alum', 'fec_nac_alum', 'edad_alum',
        'sex_alum', 'est_civil_alum',
        'pais_alum', 'est_alum', 'ciu_alum', 'direc_alum', 'lugar_nac_alum', 'nacionalidad_alum', 'etnia',
        'telemov_alum', 'telehabi_alum', 'correo_alum',
        'niv_acad_alum', 'inst_grad_alum', 'ubica_inst_muni_alum', 'ano_grad_alum', 'tipo_colegio',
        'carrera', 'modalidad_ing', 'condicion_resi', 'turno_class',
        'foto_alum', 'canal_inscripcion', 'status_alum', 'observaciones'
    ]

    with open(output_file, 'w', encoding='utf-8') as f:
        f.write("-- ==============================================================================\n")
        f.write(f"-- VACIADO AUTOMÁTICO DE ASPIRANTES WEB IUAC A SISTEMA PRINCIPAL\n")
        f.write(f"-- FECHA DE GENERACIÓN: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
        f.write(f"-- TOTAL DE ASPIRANTES: {len(registros)}\n")
        f.write("-- ==============================================================================\n\n")
        f.write("BEGIN;\n\n")

        for reg in registros:
            vals = []
            for col in columnas_base:
                val = reg.get(col)
                if val is None:
                    vals.append("NULL")
                elif isinstance(val, bool):
                    vals.append("TRUE" if val else "FALSE")
                elif isinstance(val, (int, float)):
                    vals.append(str(val))
                else:
                    # Escapar comillas simples para SQL
                    clean_str = str(val).replace("'", "''")
                    vals.append(f"'{clean_str}'")

            cols_str = ", ".join(columnas_base)
            vals_str = ", ".join(vals)

            # Insert en estudiantes
            f.write(f"-- Aspirante Cédula V-{reg.get('ced_alum')}: {reg.get('nom_alum')} {reg.get('ape_alum')}\n")
            f.write(f"INSERT INTO academico.estudiantes ({cols_str})\n")
            f.write(f"VALUES ({vals_str})\n")
            f.write(f"ON CONFLICT (ced_alum) DO UPDATE SET\n")
            f.write(f"    carrera = EXCLUDED.carrera,\n")
            f.write(f"    telemov_alum = EXCLUDED.telemov_alum,\n")
            f.write(f"    correo_alum = EXCLUDED.correo_alum,\n")
            f.write(f"    updated_at = CURRENT_TIMESTAMP;\n\n")

            # Insert en especialidades
            carrera = reg.get('carrera', 'CTA')
            f.write(f"INSERT INTO academico.estudiante_especialidades (ced_alum, prioridad, especialidad)\n")
            f.write(f"VALUES ({reg.get('ced_alum')}, 1, '{carrera}')\n")
            f.write(f"ON CONFLICT (ced_alum) DO UPDATE SET especialidad = EXCLUDED.especialidad;\n\n")

        f.write("COMMIT;\n")
        f.write("-- Fin de vaciado exitoso.\n")

    print(f"[OK] Archivo SQL de vaciado generado: {output_file} ({len(registros)} registros)")
    return output_file

def exportar_a_csv(registros, output_file="aspirantes_web_iuac.csv"):
    """Exporta a CSV estructurado para Excel."""
    if not registros:
        print("[AVISO] No hay registros para exportar a CSV.")
        return None

    # Excluir foto_alum del CSV para que sea ligero
    columnas = [k for k in registros[0].keys() if k != 'foto_alum']

    with open(output_file, 'w', newline='', encoding='utf-8-sig') as f:
        writer = csv.DictWriter(f, fieldnames=columnas, delimiter=';')
        writer.writeheader()
        for r in registros:
            row_filtrada = {k: r.get(k, '') for k in columnas}
            writer.writerow(row_filtrada)

    print(f"[OK] Archivo CSV generado: {output_file} ({len(registros)} registros)")
    return output_file

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
    parser.add_argument('--format', choices=['sql', 'csv', 'json'], default='sql', help="Formato de exportación")
    parser.add_argument('--output', default=None, help="Nombre de archivo destino")
    parser.add_argument('--solo-pendientes', action='store_true', help="Solo exportar aspirantes con estado REGISTRADO_WEB")
    parser.add_argument('--marcar', action='store_true', help="Marcar como procesados después de exportar")

    args = parser.parse_args()
    aspirantes = obtener_aspirantes_web(solo_pendientes=args.solo_pendientes)
    print(f"Total aspirantes encontrados: {len(aspirantes)}")

    if not aspirantes:
        sys.exit(0)

    nombre_archivo = args.output
    if args.format == 'sql':
        out = nombre_archivo or f"vaciado_iuac_{datetime.now().strftime('%Y%m%d_%H%M%S')}.sql"
        exportar_a_sql(aspirantes, out)
    elif args.format == 'csv':
        out = nombre_archivo or f"aspirantes_iuac_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
        exportar_a_csv(aspirantes, out)
    elif args.format == 'json':
        out = nombre_archivo or f"aspirantes_iuac_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        with open(out, 'w', encoding='utf-8') as f:
            json.dump(aspirantes, f, ensure_ascii=False, indent=2)
        print(f"[OK] Archivo JSON generado: {out}")

    if args.marcar:
        ceds = [r['ced_alum'] for r in aspirantes]
        afectados = marcar_como_procesados(ceds)
        print(f"[OK] {afectados} aspirantes marcados como PROCESADO_SISTEMA.")

