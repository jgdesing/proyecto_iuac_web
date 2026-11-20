-- ==============================================================================
-- PROYECTO IUAC WEB - CATÁLOGOS INICIALES
-- Carga de Carreras Acreditadas del IUAC
-- ==============================================================================

INSERT INTO academico.carreras (codigo, nombre, descripcion, activo)
VALUES 
    ('CTA', 'Licenciado en Aeronáutica Civil, mención Control de Tránsito Aéreo.', 'Formación de controladores de tránsito aéreo certificados bajo normativas aeronáuticas internacionales.', TRUE),
    ('ICA', 'Licenciado en Aeronáutica Civil, mención Información y Comunicación Aeronáutica.', 'Gestión de telecomunicaciones, mensajería y servicios de navegación y soporte aeronáutico.', TRUE),
    ('ETA', 'Ingeniero en Aeronáutica Civil, mención Electrónica para la Seguridad del Transito Aéreo.', 'Mantenimiento y calibración de sistemas de navegación, radar, aviónica y radioayudas.', TRUE),
    ('IMA', 'Ingeniería en Mantenimiento Aeronáutico.', 'Técnicas avanzadas de inspección, mantenimiento y reparación estructural y de sistemas de aeronaves.', TRUE),
    ('SAR', 'Búsqueda y Salvamento', 'Operaciones tácticas, rescate aéreo y gestión de emergencias aeroportuarias y de aviación.', FALSE),
    ('GTM', 'Gestión de Tripulación de Mando', 'Formación integral para futuros comandantes y pilotos en aviación comercial y de transporte.', FALSE),
    ('GTCP', 'Gestión de Tripulación de Cabina de Pasajeros', 'Seguridad en cabina, atención al pasajero, primeros auxilios aeronáuticos y protocolos de vuelo.', FALSE)
ON CONFLICT (codigo) DO UPDATE SET 
    nombre = EXCLUDED.nombre,
    descripcion = EXCLUDED.descripcion,
    activo = EXCLUDED.activo;

