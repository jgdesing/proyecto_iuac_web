import os
from datetime import date
from dotenv import load_dotenv

load_dotenv()

class Config:
    # Entorno y Secretos
    ENV = os.getenv("FLASK_ENV", "production")
    SECRET_KEY = os.getenv("SECRET_KEY", "iuac_web_secret_token_change_in_production")
    ADMIN_API_KEY = os.getenv("ADMIN_API_KEY", "iuac_admin_export_secure_key_2026")
    PORT = int(os.getenv("PORT", 5050))
    DEBUG = os.getenv("DEBUG", "False").lower() in ("true", "1")

    # Base de Datos PostgreSQL
    DB_HOST = os.getenv("DB_HOST", "localhost")
    DB_PORT = int(os.getenv("DB_PORT", 5432))
    DB_NAME = os.getenv("DB_NAME", "bd_aspirantes")
    DB_USER = os.getenv("DB_USER", "postgres")
    DB_PASSWORD = os.getenv("DB_PASSWORD", "lollipop")
    DB_MIN_CONN = int(os.getenv("DB_MIN_CONN", 1))
    DB_MAX_CONN = int(os.getenv("DB_MAX_CONN", 10))

    # ── Criterios Reglamentarios de Admisión IUAC ──
    # Fecha oficial de inicio de actividades contra la cual el aspirante NO debe cumplir 24 años
    FECHA_INICIO_ACTIVIDADES = date(2027, 9, 13)
    EDAD_MAXIMA_SELECCION = 23  # Máximo 23 años cumplidos para el 13/09/2027
    EDAD_MINIMA_ASPIRANTE = 16  # Mínimo 16 años cumplidos al inscribirse
    ANIO_PROCESO = os.getenv("ANIO_PROCESO", "2026")

    # Rate Limiting
    RATELIMIT_DEFAULT = os.getenv("RATELIMIT_DEFAULT", "300 per day;60 per hour")
    RATELIMIT_SUBMIT = os.getenv("RATELIMIT_SUBMIT", "10 per minute")
