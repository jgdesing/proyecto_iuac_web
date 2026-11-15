-- ==============================================================================
-- PROYECTO IUAC WEB - CAPTURA DE ASPIRANTES
-- SCRIPT DDL: Estructura de Base de Datos para Hosting (PostgreSQL)
-- 100% Compatible con el esquema real de bd_aspirantes (academico.estudiantes)
-- ==============================================================================

CREATE SCHEMA IF NOT EXISTS academico;

-- 1. Catálogo Oficial de Carreras IUAC
CREATE TABLE IF NOT EXISTS academico.carreras (
    carrera_id SERIAL PRIMARY KEY,
    codigo VARCHAR(20) NOT NULL UNIQUE,
    nombre VARCHAR(200) NOT NULL,
    descripcion TEXT,
    activo BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(50) DEFAULT 'system'
);

-- 2. Tabla Maestra de Captura de Aspirantes / Estudiantes
CREATE TABLE IF NOT EXISTS academico.estudiantes (
    ced_alum INTEGER PRIMARY KEY,
    nom_alum VARCHAR(100),
    ape_alum VARCHAR(100),
    fec_nac_alum DATE,
    sex_alum VARCHAR(20),
    direc_alum VARCHAR(500),
    telehabi_alum VARCHAR(50),
    telemov_alum VARCHAR(50),
    est_civil_alum VARCHAR(50),
    estatura_alum NUMERIC(4,2),
    peso_alum REAL,
    pais_alum VARCHAR(100) DEFAULT 'Venezuela',
    est_alum VARCHAR(100),
    ciu_alum VARCHAR(100),
    foto_alum VARCHAR(255),
    edad_alum INTEGER,
    correo_alum VARCHAR(150) UNIQUE,
    lugar_nac_alum VARCHAR(150),
    nacionalidad_alum VARCHAR(100) DEFAULT 'VENEZOLANA',
    niv_acad_alum VARCHAR(150) DEFAULT 'Bachiller',
    inst_grad_alum VARCHAR(200),
    ubica_inst_muni_alum VARCHAR(150),
    ano_grad_alum INTEGER,
    tipo_colegio VARCHAR(50) DEFAULT 'Público',
    modalidad_ing VARCHAR(50) DEFAULT 'REGULAR',
    condicion_resi VARCHAR(50) DEFAULT 'EXTERNO',
    turno_class VARCHAR(50) DEFAULT 'DIURNO',
    etnia VARCHAR(150) DEFAULT 'Ninguna',
    carrera VARCHAR(50),
    fec_inscrip_alum DATE DEFAULT CURRENT_DATE,
    informe_acepta VARCHAR(255),
    aula CHARACTER(10),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    telegram_chat_id BIGINT,
    derechos_aeronauticos VARCHAR(255),
    fotocopia_cedula VARCHAR(255),
    fotocopia_cedula_repres VARCHAR(255),
    canal_inscripcion VARCHAR(50) DEFAULT 'WEB',
    creado_por VARCHAR(50) DEFAULT 'WEB_PUBLIC_FORM',
    actualizado_por VARCHAR(50) DEFAULT 'WEB_PUBLIC_FORM',
    tipo_cedula VARCHAR(10) DEFAULT 'V',
    nucleo VARCHAR(50) DEFAULT 'SEDE_CENTRAL',
    status_alum VARCHAR(50) DEFAULT 'REGISTRADO_WEB',
    comprobante_derechos VARCHAR(255),
    observaciones TEXT
);

-- 3. Prioridad de Carrera
CREATE TABLE IF NOT EXISTS academico.estudiante_especialidades (
    id_especialidad SERIAL PRIMARY KEY,
    ced_alum INTEGER NOT NULL,
    prioridad INTEGER NOT NULL DEFAULT 1,
    especialidad VARCHAR(50) NOT NULL,
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_web_cedula UNIQUE (ced_alum)
);

-- Índices de Optimización
CREATE INDEX IF NOT EXISTS idx_web_estudiantes_correo ON academico.estudiantes(correo_alum);
CREATE INDEX IF NOT EXISTS idx_web_estudiantes_carrera ON academico.estudiantes(carrera);
CREATE INDEX IF NOT EXISTS idx_web_estudiantes_created_at ON academico.estudiantes(created_at);
