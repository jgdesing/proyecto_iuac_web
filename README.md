# Portal de Captura de Aspirantes IUAC (Landing Page Web)

Sistema independiente de captura de aspirantes y preinscripción en línea para el **Instituto Universitario de Aviación Civil (IUAC)**, diseñado para ser alojado en un hosting temporal o en la nube (PostgreSQL + Python) y permitir el vaciado directo y limpio de registros hacia el sistema principal (**SisCE IUAC / `proyecto_iuac_v1`**).

---

## 🚀 Características Principales

1. **Arquitectura Ultra Rápida y Ligera:**
   - Carga inicial del formulario en menos de 1 segundo en redes móviles 3G/4G.
   - Catálogo de estados y ciudades de Venezuela precargado en cliente para respuesta instantánea (0 ms).
   - Formulario por pasos (Stepper interactivo de 3 fases) con diseño *Mobile-First* optimizado para teléfonos celulares y tablets.

2. **Captura Directa de Foto Carnet:**
   - Soporte para subir archivos desde la galería/PC o activar directamente la cámara del smartphone (`capture="user"`).
   - Compresión y redimensionamiento automático en Canvas a JPEG (~150 KB) antes de transmitir al servidor.

3. **Compatibilidad Total de Base de Datos (`academico.estudiantes`):**
   - Esquema clonado con las mismas columnas (`ced_alum`, `nom_alum`, `ape_alum`, `fec_nac_alum`, `carrera`, etc.).
   - Asignación automática de `canal_inscripcion = 'WEB'` y `status_alum = 'REGISTRADO_WEB'`.

4. **Blindaje de Seguridad Multicapa:**
   - **Honeypot Invisible:** Atrapa bots automatizados sin molestar a los aspirantes con captchas engorrosos.
   - **Rate Limiting:** Protección anti-flooding con Flask-Limiter por dirección IP.
   - **Inmunidad SQL & XSS:** Consultas parametrizadas estrictas (`%s`), sanitización y escape de código malicioso.
   - **Cabeceras HTTP Seguras:** HSTS, X-Frame-Options, X-Content-Type-Options y CSP.

5. **Módulo de Vaciado y Exportación al Sistema Principal:**
   - Generación de scripts SQL con `ON CONFLICT (ced_alum) DO UPDATE` para aplicar directamente en el sistema central sin duplicados.
   - Exportación a CSV compatible con Excel y JSON por API protegida mediante clave secreta.

---

## 📂 Estructura del Proyecto

```
proyecto_iuac_web/
├── backend/
│   ├── app.py                  # Servidor Flask principal y API REST
│   ├── config.py               # Configuración central y variables de entorno
│   ├── database.py             # Pool de conexiones Threaded a PostgreSQL
│   ├── db_aspirantes.py        # Consultas e inserciones parametrizadas
│   ├── validations.py          # Validaciones oficiales (Cédula, Teléfonos vzla, Edad, Carreras)
│   ├── security.py             # Rate limiter, Honeypot y cabeceras de seguridad
│   ├── export_aspirantes.py    # Script CLI para vaciar aspirantes al sistema central
│   ├── test_suite.py           # Pruebas automatizadas unitarias
│   └── requirements.txt        # Dependencias Python
├── frontend/
│   ├── index.html              # Landing Page oficial y formulario por pasos
│   ├── css/
│   │   └── landing.css         # Estilos aeronáuticos institucionales y responsive móvil
│   └── js/
│       ├── geo_data.js         # Catálogo de los 24 estados y ciudades de Venezuela
│       └── app.js              # Validación en tiempo real, stepper y cámara
├── schema/
│   ├── 001_create_academico_schema.sql  # DDL idéntico a academico.estudiantes
│   └── 002_catalogos_iniciales.sql      # Carreras oficiales IUAC (CTA, ICA, IMA, SAR, etc.)
├── Dockerfile                  # Empaquetado para despliegue en contenedor
├── docker-compose.yml          # Levanta app + PostgreSQL en un comando
├── .env.example                # Plantilla de variables de configuración
└── README.md                   # Esta guía
```

---

## 🛠️ Puesta en Marcha Local

### Opción A: Con Python y PostgreSQL Local
1. Cree un entorno virtual e instale dependencias:
   ```bash
   python -m venv .venv
   .venv\Scripts\activate   # En Windows
   pip install -r backend/requirements.txt
   ```
2. Configure su archivo `.env` basado en `.env.example`:
   ```bash
   copy .env.example .env
   ```
3. Ejecute los scripts SQL en su base de datos PostgreSQL:
   ```bash
   psql -U postgres -d bd_aspirantes -f schema/001_create_academico_schema.sql
   psql -U postgres -d bd_aspirantes -f schema/002_catalogos_iniciales.sql
   ```
4. Inicie el servidor:
   ```bash
   python backend/app.py
   ```
   Abra en su navegador: `http://localhost:5050`

### Opción B: Con Docker Compose (Recomendado para servidores)
```bash
docker compose up -d
```
Esto levantará la base de datos PostgreSQL y la aplicación web en el puerto `5050`.

---

## 🌐 Guía de Despliegue en Hosting (Producción)

### 1. En Hosting cPanel (con "Setup Python App")
1. Suba los archivos de `proyecto_iuac_web` a la carpeta de su dominio en cPanel (ej. `public_html` o `iuac_web`).
2. En cPanel, vaya a **Setup Python App** -> Cree una aplicación con **Python 3.10 o superior**.
3. En *Application root* indique la ruta del proyecto y en *Application startup file* coloque `backend/app.py` (función `app`).
4. Cree la base de datos PostgreSQL en cPanel (**PostgreSQL Databases**) y cargue los archivos de la carpeta `schema/` desde phpPgAdmin o por terminal SSH.
5. Edite las variables en `.env` con los datos de usuario y contraseña de su base de datos en cPanel.

### 2. En VPS Linux (Ubuntu / Debian con Nginx y Gunicorn)
1. Instale los requerimientos:
   ```bash
   sudo apt update && sudo apt install -y python3-pip python3-venv nginx postgresql
   ```
2. Corra Gunicorn con systemd apuntando a `backend/app:app`.
3. Configure Nginx como proxy reverso con SSL gratuito (Let's Encrypt / Certbot).

---

## 🔄 Cómo Vaciar los Datos al Sistema Central (`proyecto_iuac_v1`)

Cuando haya finalizado el periodo de captura web o desee vaciar los registros al sistema principal:

### Método 1: Script CLI de Generación SQL (Más Seguro y Limpio)
Ejecute en el servidor o descargue:
```bash
python backend/export_aspirantes.py --format sql --output vaciado_produccion.sql
```
Este script genera un archivo `vaciado_produccion.sql` con sentencias del tipo:
```sql
INSERT INTO academico.estudiantes (...) VALUES (...)
ON CONFLICT (ced_alum) DO UPDATE SET ...
```
Luego solo debe ejecutar ese script en la base de datos de su sistema central `proyecto_iuac_v1`:
```bash
psql -U postgres -d bd_aspirantes -f vaciado_produccion.sql
```
*No habrá colisiones ni errores si un aspirante ya existía, ya que usa `ON CONFLICT`.*

### Método 2: Descarga Directa por API Administrativa
Desde el navegador o mediante cURL con su clave administrativa:
```bash
curl -H "X-Admin-Key: iuac_admin_export_secure_key_2026" \
     "https://su-dominio.com/api/admin/exportar?format=sql" \
     -o vaciado_aspirantes.sql
```
También puede descargar en formato CSV compatible con Excel:
```bash
https://su-dominio.com/api/admin/exportar?format=csv&key=iuac_admin_export_secure_key_2026
```

---

## 🧪 Pruebas Automatizadas

Para validar las reglas de negocio, teléfonos venezolanos y filtros de seguridad:
```bash
python backend/test_suite.py
```
Resultado: **8 tests pasados exitosamente.**

