import os
import io
from flask import Flask, request, jsonify, send_from_directory, Response
from flask_cors import CORS
from config import Config
from database import init_db_pool, check_db_health
from security import create_limiter, apply_security_headers, check_honeypot, contains_malicious_payload
from validations import validate_aspirante_payload, validar_cedula_venezolana
from db_aspirantes import check_cedula_exists, check_correo_exists, get_active_carreras, insert_aspirante_web
from export_aspirantes import obtener_aspirantes_web, exportar_a_sql, exportar_a_csv, marcar_como_procesados

# Directorios de frontend y uploads
FRONTEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'frontend'))
UPLOAD_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), 'uploads', 'fotos'))
os.makedirs(UPLOAD_DIR, exist_ok=True)

app = Flask(__name__, static_folder=FRONTEND_DIR)
app.config.from_object(Config)

# CORS seguro
CORS(app, resources={r"/api/*": {"origins": "*"}})

# Servir fotos subidas de aspirantes
@app.route('/uploads/fotos/<path:filename>', methods=['GET'])
def serve_foto(filename):
    return send_from_directory(UPLOAD_DIR, filename)

# Blindaje de Seguridad: Rate Limiting
limiter = create_limiter(app)

# Blindaje de Seguridad: Cabeceras HTTP
@app.after_request
def after_request_security(response):
    return apply_security_headers(response)

# Inicializar conexión a PostgreSQL
try:
    init_db_pool()
except Exception as e:
    app.logger.error(f"PostgreSQL pool init deferred: {e}")

# ── 1. RUTAS ESTÁTICAS DE LA LANDING PAGE Y PANEL ADMIN ───────────────────────
@app.route('/', methods=['GET'])
def serve_index():
    return send_from_directory(FRONTEND_DIR, 'index.html')

@app.route('/admin', methods=['GET'])
def serve_admin():
    return send_from_directory(FRONTEND_DIR, 'admin.html')

@app.route('/<path:path>', methods=['GET'])
def serve_static(path):
    if os.path.exists(os.path.join(FRONTEND_DIR, path)):
        return send_from_directory(FRONTEND_DIR, path)
    return send_from_directory(FRONTEND_DIR, 'index.html')

# ── 2. MONITOREO Y SALUD DEL SERVICIO ─────────────────────────────────────────
@app.route('/api/health', methods=['GET'])
def api_health():
    db_ok, db_msg = check_db_health()
    status_code = 200 if db_ok else 503
    return jsonify({
        "status": "online" if db_ok else "degraded",
        "institution": "IUAC - Instituto Universitario de Aeronáutica Civil",
        "service": "Portal de Captura Web de Aspirantes",
        "database": {"ok": db_ok, "detail": db_msg},
        "version": "1.0.0"
    }), status_code

# ── 3. CATÁLOGO DE CARRERAS ACTIVAS ───────────────────────────────────────────
@app.route('/api/carreras', methods=['GET'])
def api_carreras():
    carreras = get_active_carreras()
    return jsonify({"ok": True, "data": carreras})

# ── 4. VALIDACIÓN EN TIEMPO REAL DE CÉDULA ────────────────────────────────────
@app.route('/api/validar-cedula/<cedula>', methods=['GET'])
@limiter.limit("60 per minute")
def api_validar_cedula(cedula):
    ok_ced, ced_clean, err_ced = validar_cedula_venezolana(cedula)
    if not ok_ced:
        return jsonify({"ok": False, "valid": False, "error": err_ced}), 400

    try:
        existe = check_cedula_exists(ced_clean)
        return jsonify({
            "ok": True,
            "cedula": ced_clean,
            "exists": existe,
            "disponible": not existe,
            "mensaje": "Cédula disponible para preinscripción" if not existe else "Esta cédula ya se encuentra registrada en el sistema."
        })
    except Exception as e:
        return jsonify({"ok": False, "error": "No se pudo verificar la cédula en este momento."}), 500

# ── 5. REGISTRO PRINCIPAL DEL ASPIRANTE ───────────────────────────────────────
@app.route('/api/aspirantes/registrar', methods=['POST'])
@limiter.limit(Config.RATELIMIT_SUBMIT)
def api_registrar_aspirante():
    payload = request.get_json(silent=True) or {}

    # 1. Filtro Honeypot Anti-Bot (Trampa silenciosa)
    if check_honeypot(payload):
        # Simular éxito para que el bot no intente variantes de ataque
        return jsonify({
            "ok": True,
            "mensaje": "Preinscripción procesada con éxito",
            "comprobante": "IUAC-BOT-DISCARDED"
        }), 200

    # 2. Detección de inyecciones maliciosas
    is_malicious, mal_err = contains_malicious_payload(payload)
    if is_malicious:
        return jsonify({"ok": False, "error": mal_err}), 400

    # 3. Validación exhaustiva del formulario
    is_valid, cleaned_data, val_err = validate_aspirante_payload(payload)
    if not is_valid:
        return jsonify({"ok": False, "error": val_err}), 400

    # 4. Inserción en Base de Datos PostgreSQL
    ip_origen = request.headers.get('X-Forwarded-For', request.remote_addr or '127.0.0.1').split(',')[0].strip()
    user_agent = request.headers.get('User-Agent', '')[:250]

    success, db_err = insert_aspirante_web(cleaned_data, ip_origen=ip_origen, user_agent=user_agent)
    if not success:
        return jsonify({"ok": False, "error": db_err}), 400

    # Generar folio de comprobante institucional
    folio = f"IUAC-{Config.ANIO_PROCESO}-{cleaned_data['ced_alum']}"

    return jsonify({
        "ok": True,
        "mensaje": "¡Preinscripción registrada exitosamente en el IUAC!",
        "folio": folio,
        "cedula": cleaned_data['ced_alum'],
        "nombres": f"{cleaned_data['nom_alum']} {cleaned_data['ape_alum']}",
        "carrera": cleaned_data['carrera'],
        "fecha_registro": cleaned_data['fec_nac_alum']
    }), 201

# ── 6. PANEL DE CONTROL Y RESUMEN ADMINISTRATIVO ──────────────────────────────
@app.route('/api/admin/resumen', methods=['GET'])
def api_admin_resumen():
    auth_key = request.headers.get('X-Admin-Key') or request.args.get('key')
    if auth_key != Config.ADMIN_API_KEY:
        return jsonify({"ok": False, "error": "Acceso no autorizado. Clave administrativa requerida."}), 403

    registros = obtener_aspirantes_web()
    carreras_count = {}
    for r in registros:
        c = r.get('carrera', 'OTRA')
        carreras_count[c] = carreras_count.get(c, 0) + 1

    return jsonify({
        "ok": True,
        "total": len(registros),
        "por_carrera": carreras_count,
        "ultimos": [
            {
                "cedula": r.get('ced_alum'),
                "nombre": f"{r.get('nom_alum','')} {r.get('ape_alum','')}".strip(),
                "carrera": r.get('carrera'),
                "fecha": str(r.get('created_at', ''))[:16]
            } for r in registros[-10:]
        ]
    })

# ── 7. VACIADO / EXPORTACIÓN PARA EL SISTEMA CENTRAL ─────────────────────────
@app.route('/api/admin/exportar', methods=['GET'])
def api_admin_exportar():
    """
    Endpoint administrativo para vaciar o descargar los aspirantes web.
    Protegido por clave secreta en cabecera 'X-Admin-Key' o query param '?key='.
    """
    auth_key = request.headers.get('X-Admin-Key') or request.args.get('key')
    if auth_key != Config.ADMIN_API_KEY:
        return jsonify({"ok": False, "error": "Acceso no autorizado. Clave administrativa requerida."}), 403

    formato = request.args.get('format', 'sql').lower()
    solo_pend = request.args.get('pendientes', 'false').lower() in ('true', '1')

    registros = obtener_aspirantes_web(solo_pendientes=solo_pend)

    if formato == 'csv':
        output_csv = io.StringIO()
        if registros:
            cols = [k for k in registros[0].keys() if k != 'foto_alum']
            writer = csv.DictWriter(output_csv, fieldnames=cols, delimiter=';')
            writer.writeheader()
            for r in registros:
                writer.writerow({k: r.get(k, '') for k in cols})
        return Response(
            output_csv.getvalue(),
            mimetype="text/csv",
            headers={"Content-Disposition": f"attachment;filename=aspirantes_web_iuac.csv"}
        )

    elif formato == 'json':
        return jsonify({"ok": True, "total": len(registros), "data": registros})

    else: # Formato SQL por defecto
        temp_sql = os.path.join(os.path.dirname(__file__), 'temp_export.sql')
        exportar_a_sql(registros, temp_sql)
        with open(temp_sql, 'r', encoding='utf-8') as f:
            sql_content = f.read()
        try:
            os.remove(temp_sql)
        except Exception:
            pass
        return Response(
            sql_content,
            mimetype="application/sql",
            headers={"Content-Disposition": f"attachment;filename=vaciado_iuac_{Config.ANIO_PROCESO}.sql"}
        )

if __name__ == '__main__':
    print(f"Iniciando servidor IUAC Web en http://0.0.0.0:{Config.PORT}")
    app.run(host='0.0.0.0', port=Config.PORT, debug=Config.DEBUG)

