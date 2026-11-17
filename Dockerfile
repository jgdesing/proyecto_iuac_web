FROM python:3.11-slim

WORKDIR /app

# Instalar dependencias del sistema mínimas
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libpq-dev && \
    rm -rf /var/lib/apt/lists/*

# Copiar requerimientos y compilar
COPY backend/requirements.txt requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copiar aplicación completa
COPY backend/ backend/
COPY frontend/ frontend/
COPY schema/ schema/

EXPOSE 5050

WORKDIR /app/backend
CMD ["gunicorn", "--bind", "0.0.0.0:5050", "--workers", "3", "--timeout", "60", "app:app"]

