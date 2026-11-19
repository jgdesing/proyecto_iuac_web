import re
from datetime import date, datetime
from config import Config

CARRERAS_VALIDAS = {
    'CTA': 'Control de Tránsito Aéreo',
    'ICA': 'Información y Comunicaciones Aeronáuticas',
    'IMA': 'Mantenimiento Aeronáutico',
    'SAR': 'Búsqueda y Salvamento',
    'ETA': 'Electrónica Aeronáutica'
}

REGEX_EMAIL = re.compile(r'^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$')
REGEX_SOLO_LETRAS_Y_ESPACIOS = re.compile(r'^[a-zA-ZáéíóúÁÉÍÓÚñÑüÜ\s\.]+$')

def limpiar_texto_estricto(val):
    """
    Limpieza universal y estricta para cualquier campo que contenga letras o palabras:
    1. Elimina cualquier espacio al inicio y al final (.strip()).
    2. Colapsa múltiples espacios internos (espacios dobles, triples, tabulaciones o saltos)
       en exactamente un único espacio simple.
    """
    if val is None:
        return ''
    return re.sub(r'\s+', ' ', str(val)).strip()

def calcular_edad_en_fecha(fecha_nac, fecha_referencia):
    """Calcula los años cumplidos de una persona en una fecha específica."""
    if isinstance(fecha_nac, str):
        for fmt in ('%Y-%m-%d', '%d/%m/%Y', '%d-%m-%Y'):
            try:
                fecha_nac = datetime.strptime(fecha_nac.strip(), fmt).date()
                break
            except ValueError:
                pass
    if not isinstance(fecha_nac, (date, datetime)):
        return None
    return fecha_referencia.year - fecha_nac.year - ((fecha_referencia.month, fecha_referencia.day) < (fecha_nac.month, fecha_nac.day))

def calcular_edad_actual(fecha_nac):
    """Calcula la edad en años a la fecha de hoy."""
    return calcular_edad_en_fecha(fecha_nac, date.today())

def verificar_criterio_edad_iuac(fecha_nac):
    """
    Reglamentación oficial del IUAC (Imagen 1):
    - El ingreso formal de los nuevos alumnos será el 13 de Septiembre de 2027.
    - El bachiller NO DEBE CUMPLIR SU AÑO NÚMERO 24 PARA ESA FECHA.
    - La edad límite reglamentaria permitida es de 23 años cumplidos.
    - Edad mínima de ingreso: 16 años cumplidos.
    Retorna (cumple: bool, edad_actual: int, edad_al_ingreso: int, mensaje_error: str|None)
    """
    edad_actual = calcular_edad_actual(fecha_nac)
    if edad_actual is None:
        return False, None, None, "Fecha de nacimiento no válida."

    if edad_actual < Config.EDAD_MINIMA_ASPIRANTE:
        return False, edad_actual, None, f"El aspirante debe tener al menos {Config.EDAD_MINIMA_ASPIRANTE} años cumplidos para registrarse (Edad actual: {edad_actual} años)."

    edad_al_ingreso = calcular_edad_en_fecha(fecha_nac, Config.FECHA_INICIO_ACTIVIDADES)
    if edad_al_ingreso > Config.EDAD_MAXIMA_SELECCION:
        return False, edad_actual, edad_al_ingreso, (
            f"El aspirante NO cumple el requisito reglamentario de edad máxima: "
            f"para el inicio de actividades académicas el 13/09/2027 tendrá {edad_al_ingreso} años. "
            f"El reglamento establece un máximo de {Config.EDAD_MAXIMA_SELECCION} años cumplidos (no cumplir 24 años para esa fecha)."
        )

    return True, edad_actual, edad_al_ingreso, None

def validar_cedula_venezolana(cedula):
    """
    Valida que la cédula contenga exactamente 8 dígitos numéricos (solo dígitos).
    Retorna (es_valido, cedula_int, error)
    """
    if not cedula:
        return False, None, "El número de cédula es obligatorio."
    
    ced_str = str(cedula).upper().replace('V-', '').replace('E-', '').replace('.', '').replace(' ', '').strip()
    if not ced_str.isdigit():
        return False, None, "La cédula debe contener exclusivamente números (solo dígitos)."
    
    if len(ced_str) != 8:
        return False, None, "La cédula debe contener exactamente 8 dígitos numéricos (ej: 30123456)."
    
    ced_int = int(ced_str)
    if ced_int < 10000000 or ced_int > 99999999:
        return False, None, "El número de cédula debe tener 8 dígitos numéricos válidos."

    return True, ced_int, None

def validar_telefono_venezolano(telefono, tipo='móvil'):
    """
    Valida número telefónico conforme al estándar venezolano.
    Prefijos móviles válidos: 412, 414, 424, 416, 426.
    Prefijos fijos válidos: 2xx (ej: 0212, 0243, 0241, etc.)
    Retorna (es_valido, telefono_limpio, error)
    """
    if not telefono:
        return False, None, f"El teléfono {tipo} es obligatorio."

    raw = str(telefono).strip()
    digits = re.sub(r'\D', '', raw)

    if digits.startswith('58'):
        local = digits[2:]
    elif digits.startswith('0'):
        local = digits[1:]
    else:
        local = digits

    if len(local) != 10:
        return False, None, f"El teléfono {tipo} debe tener 11 dígitos (ej: 0412-1234567 o 0243-1234567)."

    prefijo = local[:3]
    prefijos_moviles = {'412', '414', '424', '416', '426'}

    if tipo in ('móvil', 'movil'):
        if prefijo not in prefijos_moviles:
            return False, None, f"El código '{prefijo}' no corresponde a una operadora móvil válida (0412, 0414, 0424, 0416, 0426)."
    elif tipo in ('habitación', 'habitacion', 'fijo', 'secundario'):
        if not (local.startswith('2') or prefijo in prefijos_moviles):
            return False, None, "El teléfono de habitación debe ser una línea fija local (02XX) o un celular secundario válido."

    telefono_estandar = f"0{local}"
    return True, telefono_estandar, None

def validate_aspirante_payload(data):
    """
    Validación exhaustiva de todos los campos del aspirante para academico.estudiantes.
    """
    cleaned = {}
    
    # 1. Cédula (integer)
    ced_raw = data.get('ced_alum')
    tipo_ced = limpiar_texto_estricto(data.get('tipo_cedula', 'V')).upper()
    if tipo_ced not in ('V', 'E', 'P'):
        tipo_ced = 'V'
    ok_ced, ced_int, err_ced = validar_cedula_venezolana(ced_raw)
    if not ok_ced:
        return False, None, err_ced
    cleaned['ced_alum'] = ced_int
    cleaned['tipo_cedula'] = tipo_ced

    # 2. Nombres y Apellidos (solo caracteres alfabéticos y espacios, sin espacios residuales)
    nom = limpiar_texto_estricto(data.get('nom_alum', ''))
    ape = limpiar_texto_estricto(data.get('ape_alum', ''))
    if len(nom) < 2 or len(nom) > 100:
        return False, None, "Debe ingresar sus nombres completos (mínimo 2 letras)."
    if len(ape) < 2 or len(ape) > 100:
        return False, None, "Debe ingresar sus apellidos completos (mínimo 2 letras)."
    if not REGEX_SOLO_LETRAS_Y_ESPACIOS.match(nom):
        return False, None, "El campo Nombres solo permite letras y espacios."
    if not REGEX_SOLO_LETRAS_Y_ESPACIOS.match(ape):
        return False, None, "El campo Apellidos solo permite letras y espacios."
    cleaned['nom_alum'] = nom.title()
    cleaned['ape_alum'] = ape.title()

    # 3. Fecha de Nacimiento y Criterio de Edad IUAC (Inicio de Actividades 13/09/2027)
    fec_nac_str = limpiar_texto_estricto(data.get('fec_nac_alum', ''))
    if not fec_nac_str:
        return False, None, "La fecha de nacimiento es obligatoria."
    
    try:
        fec_nac = datetime.strptime(fec_nac_str, '%Y-%m-%d').date()
    except ValueError:
        return False, None, "El formato de fecha de nacimiento debe ser AAAA-MM-DD."
    
    cumple_edad, edad_actual, edad_al_ingreso, err_edad = verificar_criterio_edad_iuac(fec_nac)
    if not cumple_edad:
        return False, None, err_edad
    
    cleaned['fec_nac_alum'] = fec_nac.isoformat()
    cleaned['edad_alum'] = int(edad_actual)

    # 4. Género y Estado Civil
    sex = limpiar_texto_estricto(data.get('sex_alum', '')).upper()
    if sex not in ('M', 'F'):
        return False, None, "Debe seleccionar su género."
    cleaned['sex_alum'] = sex

    est_civil = limpiar_texto_estricto(data.get('est_civil_alum', ''))[:50]
    if not est_civil:
        return False, None, "Debe seleccionar su estado civil."
    cleaned['est_civil_alum'] = est_civil

    # 5. Teléfonos (Móvil obligatorio, habitación/secundario opcional)
    tel_mov_raw = data.get('telemov_alum')
    ok_mov, tel_mov, err_mov = validar_telefono_venezolano(tel_mov_raw, 'móvil')
    if not ok_mov:
        return False, None, err_mov
    cleaned['telemov_alum'] = tel_mov

    tel_hab_raw = data.get('telehabi_alum')
    if not tel_hab_raw or not str(tel_hab_raw).strip():
        cleaned['telehabi_alum'] = None
    else:
        ok_hab, tel_hab, err_hab = validar_telefono_venezolano(tel_hab_raw, 'habitación')
        if not ok_hab:
            # Si introdujo un celular como secundario, validar como móvil
            ok_hab_mov, tel_hab_mov, err_hab_mov = validar_telefono_venezolano(tel_hab_raw, 'móvil')
            if not ok_hab_mov:
                return False, None, err_hab
            cleaned['telehabi_alum'] = tel_hab_mov
        else:
            cleaned['telehabi_alum'] = tel_hab

    # 6. Correo Electrónico
    correo = limpiar_texto_estricto(data.get('correo_alum', '')).lower().replace(' ', '')
    if not correo or not REGEX_EMAIL.match(correo):
        return False, None, "El correo electrónico no posee un formato válido (ej: aspirante@correo.com)."
    cleaned['correo_alum'] = correo[:150]

    # 7. Residencia y Ubicación
    cleaned['pais_alum'] = limpiar_texto_estricto(data.get('pais_alum', 'Venezuela'))[:100]
    cleaned['est_alum'] = limpiar_texto_estricto(data.get('est_alum', ''))[:100]
    cleaned['ciu_alum'] = limpiar_texto_estricto(data.get('ciu_alum', ''))[:100]
    cleaned['direc_alum'] = limpiar_texto_estricto(data.get('direc_alum', ''))[:500]
    cleaned['lugar_nac_alum'] = limpiar_texto_estricto(data.get('lugar_nac_alum', ''))[:150]
    cleaned['nacionalidad_alum'] = limpiar_texto_estricto(data.get('nacionalidad_alum', 'VENEZOLANA'))[:100]
    cleaned['etnia'] = 'Ninguna'  # Eliminado del formulario visual

    if not cleaned['lugar_nac_alum']:
        return False, None, "Debe seleccionar su lugar de nacimiento."
    if not cleaned['est_alum']:
        return False, None, "Debe seleccionar su Estado de residencia."
    if not cleaned['ciu_alum']:
        return False, None, "Debe seleccionar su Ciudad o Municipio."
    if not cleaned['direc_alum'] or len(cleaned['direc_alum']) < 8:
        return False, None, "Debe detallar su dirección de habitación completa (mínimo 8 caracteres)."

    # 8. Datos Académicos (Todos obligatorios)
    cleaned['niv_acad_alum'] = limpiar_texto_estricto(data.get('niv_acad_alum', ''))[:150]
    if not cleaned['niv_acad_alum']:
        return False, None, "Debe seleccionar su nivel académico."
    cleaned['inst_grad_alum'] = limpiar_texto_estricto(data.get('inst_grad_alum', ''))[:200]
    cleaned['ubica_inst_muni_alum'] = limpiar_texto_estricto(data.get('ubica_inst_muni_alum', ''))[:150]
    if not cleaned['inst_grad_alum'] or len(cleaned['inst_grad_alum']) < 3:
        return False, None, "Debe ingresar el nombre de la institución o plantel de egreso."
    
    ano_grad = data.get('ano_grad_alum')
    if ano_grad and str(ano_grad).isdigit():
        ano_int = int(ano_grad)
        if ano_int < 1990 or ano_int > (date.today().year + 1):
            return False, None, f"El año de graduación debe ser válido (entre 1990 y {date.today().year + 1})."
        cleaned['ano_grad_alum'] = ano_int
    else:
        return False, None, "El año de graduación es obligatorio."

    val_colegio = limpiar_texto_estricto(data.get('tipo_colegio', ''))
    if not val_colegio:
        return False, None, "Debe seleccionar el tipo de institución."
    cleaned['tipo_colegio'] = 'Privado' if 'privad' in val_colegio.lower() else 'Público'

    # 9. Carrera de Postulación IUAC (Obligatoria)
    carrera = limpiar_texto_estricto(data.get('carrera', '')).upper()
    if carrera not in CARRERAS_VALIDAS:
        return False, None, f"La carrera seleccionada '{carrera}' no es válida. Seleccione una carrera de la oferta académica oficial."
    cleaned['carrera'] = carrera

    # 10. Fotografía Carnet (100% Obligatoria)
    foto_raw = data.get('foto_base64')
    if not foto_raw:
        return False, None, "La fotografía tipo carnet es obligatoria. Por favor suba un archivo o active su cámara."
    cleaned['foto_base64'] = foto_raw
    foto_ext_raw = str(data.get('foto_ext') or 'jpg').strip().lower().lstrip('.')
    cleaned['foto_ext'] = 'png' if foto_ext_raw == 'png' else 'jpg'

    # 10.1 Fotocopia o Escaneo de Cédula del Aspirante (100% Obligatoria para menores y mayores de edad)
    ced_doc_raw = data.get('cedula_doc_base64')
    if not ced_doc_raw:
        return False, None, "Debe subir o escanear la fotografía o fotocopia de la cédula de identidad del aspirante."
    cleaned['cedula_doc_base64'] = ced_doc_raw
    ced_doc_ext_raw = str(data.get('cedula_doc_ext') or 'jpg').strip().lower().lstrip('.')
    cleaned['cedula_doc_ext'] = 'png' if ced_doc_ext_raw == 'png' else ('pdf' if ced_doc_ext_raw == 'pdf' else 'jpg')

    # 11. Datos y Fotocopia de Cédula del Representante (Obligatorio si es menor de 18 años)
    # Por requerimiento oficial, el único recaudo obligatorio del representante es su fotocopia/escaneo de cédula
    if cleaned['edad_alum'] < 18:
        repres_doc = data.get('repres_doc_base64')
        if not repres_doc:
            return False, None, "Por ser menor de edad, debe subir o escanear la fotocopia de la cédula de su representante legal."
        cleaned['repres_doc_base64'] = repres_doc
        repres_ext_raw = str(data.get('repres_doc_ext') or 'jpg').strip().lower().lstrip('.')
        cleaned['repres_doc_ext'] = 'png' if repres_ext_raw == 'png' else ('pdf' if repres_ext_raw == 'pdf' else 'jpg')

        repres_ced_raw = data.get('ced_repres')
        if repres_ced_raw and str(repres_ced_raw).strip() and str(repres_ced_raw).strip() != 'Adjunta':
            ok_repres_ced, repres_ced_int, _ = validar_cedula_venezolana(repres_ced_raw)
            cleaned['ced_repres'] = str(repres_ced_int) if ok_repres_ced else 'Adjunta'
        else:
            cleaned['ced_repres'] = 'Adjunta'

        cleaned['nom_repres'] = str(data.get('nom_repres') or 'Representante Legal').strip()[:150]
        cleaned['parentesco_repres'] = str(data.get('parentesco_repres') or 'Representante Legal').strip()[:50]
        cleaned['telemov_repres'] = str(data.get('telemov_repres') or cleaned.get('telemov_alum', '')).strip()[:50]
    else:
        cleaned['ced_repres'] = None
        cleaned['nom_repres'] = None
        cleaned['parentesco_repres'] = None
        cleaned['telemov_repres'] = None
        cleaned['repres_doc_base64'] = None
        cleaned['repres_doc_ext'] = None

    cleaned['modalidad_ing'] = 'REGULAR'
    cleaned['condicion_resi'] = 'EXTERNO'
    cleaned['turno_class'] = 'DIURNO'
    cleaned['canal_inscripcion'] = 'WEB'
    cleaned['status_alum'] = 'REGISTRADO_WEB'

    return True, cleaned, None
