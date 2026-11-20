import re
import html
import logging
from flask import request, jsonify, has_request_context
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

logger = logging.getLogger("IUAC_SECURITY")

def _get_client_ip():
    if has_request_context():
        return getattr(request, 'remote_addr', '127.0.0.1')
    return '127.0.0.1'

# ── 1. RATE LIMITING ──────────────────────────────────────────────────────────
def create_limiter(app):
    return Limiter(
        get_remote_address,
        app=app,
        default_limits=["300 per hour", "60 per minute"],
        storage_uri="memory://"
    )

# ── 2. CABECERAS DE SEGURIDAD ENDURECIDAS ─────────────────────────────────────
def apply_security_headers(response):
    response.headers['X-Frame-Options'] = 'SAMEORIGIN'
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'
    response.headers.pop('ETag', None)
    response.headers.pop('Last-Modified', None)
    return response

# ── 3. DETECCIÓN DE BOTS (HONEYPOT) ───────────────────────────────────────────
def check_honeypot(data):
    """
    Verifica si el campo trampa oculto 'website_url_hp' fue llenado.
    Los usuarios humanos no lo ven; los bots automatizados suelen llenarlo.
    Retorna True si es bot detectado.
    """
    hp_val = data.get('website_url_hp') or data.get('hp_field')
    if hp_val and str(hp_val).strip() != "":
        ip = _get_client_ip()
        logger.warning(f"Bot detectado por Honeypot desde IP {ip}. Valor recibido: {str(hp_val)[:50]}")
        return True
    return False

# ── 4. SANITIZACIÓN GENERAL Y PREVENCIÓN DE INYECCIÓN ─────────────────────────
PATRON_SQL_PELIGROSO = re.compile(
    r"(\b(UNION\s+ALL|UNION\s+SELECT|DROP\s+TABLE|DROP\s+DATABASE|DROP\s+SCHEMA|TRUNCATE\s+TABLE|ALTER\s+TABLE|EXEC\(|EXECUTE\(|DELETE\s+FROM|INSERT\s+INTO|UPDATE\s+.*SET)\b|<script\b|<iframe\b|javascript:|onerror\s*=|onload\s*=)",
    re.IGNORECASE
)

def sanitize_text(val, max_len=250):
    if val is None:
        return ""
    val_str = str(val).strip()
    # Limitar longitud
    val_str = val_str[:max_len]
    # Escapar caracteres HTML peligrosos
    val_escaped = html.escape(val_str, quote=True)
    return val_escaped

def contains_malicious_payload(data):
    """
    Escanea recursivamente los campos de texto para detectar payloads de inyección.
    Excluye campos de imágenes en base64 para evitar falsos positivos por entropía.
    """
    campos_excluidos = {'foto_base64', 'foto_b64', 'comprobante_b64', 'foto_alum', 'comprobante_derechos'}
    for k, v in data.items():
        if k in campos_excluidos:
            continue
        if isinstance(v, str):
            if PATRON_SQL_PELIGROSO.search(v):
                ip = _get_client_ip()
                logger.warning(f"Intento de inyección detectado en campo '{k}' desde IP {ip}")
                return True, f"Caracteres o sentencias no permitidas en el campo {k}."
    return False, None
