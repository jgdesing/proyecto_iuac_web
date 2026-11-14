import re
from datetime import date, datetime
from config import Config

CARRERAS_VALIDAS = {
    'CTA': 'Control de Tránsito Aéreo',
    'ICA': 'Información y Comunicaciones Aeronáuticas',
    'IMA': 'Mantenimiento Aeronáutico',
    'SAR': 'Búsqueda y Salvamento',
    'ETA': 'Electrónica Aeronáutica',
    'GTM': 'Gestión de Tripulación de Mando',
    'GTCP': 'Gestión de Tripulación de Cabina de Pasajeros'
}

REGEX_EMAIL = re.compile(r'^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$')
REGEX_SOLO_LETRAS_Y_ESPACIOS = re.compile(r'^[a-zA-ZáéíóúÁÉÍÓÚñÑüÜ\s\.]+$')

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
    Valida que la cédula sea un número entero de 6 a 8 dígitos.
    Retorna (es_valido, cedula_int, error)
    """
    if not cedula:
        return False, None, "El número de cédula es obligatorio."
    
    ced_str = str(cedula).upper().replace('V-', '').replace('E-', '').replace('.', '').replace(' ', '').strip()
    if not ced_str.isdigit():
        return False, None, "La cédula debe contener exclusivamente números."
    
    if len(ced_str) < 6 or len(ced_str) > 8:
        return False, None, "La cédula debe tener entre 6 y 8 dígitos numéricos válidos."
    
    ced_int = int(ced_str)
    if ced_int < 1000000 or ced_int > 99999999:
        return False, None, "El número de cédula está fuera del rango válido."

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
    tipo_ced = str(data.get('tipo_cedula', 'V')).upper().strip()
    if tipo_ced not in ('V', 'E', 'P'):
        tipo_ced = 'V'
    ok_ced, ced_int, err_ced = validar_cedula_venezolana(ced_raw)
    if not ok_ced:
        return False, None, err_ced
    cleaned['ced_alum'] = ced_int
    cleaned['tipo_cedula'] = tipo_ced

    # 2. Nombres y Apellidos (solo caracteres alfabéticos y espacios)
    nom = str(data.get('nom_alum', '')).strip()
    ape = str(data.get('ape_alum', '')).strip()
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
    fec_nac_str = str(data.get('fec_nac_alum', '')).strip()
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
    sex = str(data.get('sex_alum', 'M')).upper().strip()
    if sex not in ('M', 'F'):
        sex = 'M'
    cleaned['sex_alum'] = sex
    cleaned['est_civil_alum'] = str(data.get('est_civil_alum', 'Soltero/a')).strip()[:50]

    # 5. Teléfonos
    tel_mov_raw = data.get('telemov_alum')
    ok_mov, tel_mov, err_mov = validar_telefono_venezolano(tel_mov_raw, 'móvil')
    if not ok_mov:
        return False, None, err_mov
    cleaned['telemov_alum'] = tel_mov

    tel_hab_raw = data.get('telehabi_alum')
    if tel_hab_raw and str(tel_hab_raw).strip():
        ok_hab, tel_hab, err_hab = validar_telefono_venezolano(tel_hab_raw, 'habitación')
        if not ok_hab:
            return False, None, err_hab
        cleaned['telehabi_alum'] = tel_hab
    else:
        cleaned['telehabi_alum'] = tel_mov

    # 6. Correo Electrónico
    correo = str(data.get('correo_alum', '')).strip().lower()
    if not correo or not REGEX_EMAIL.match(correo):
        return False, None, "El correo electrónico no posee un formato válido (ej: aspirante@correo.com)."
    cleaned['correo_alum'] = correo[:150]

    # 7. Residencia y Ubicación
    cleaned['pais_alum'] = str(data.get('pais_alum', 'Venezuela')).strip()[:100]
    cleaned['est_alum'] = str(data.get('est_alum', '')).strip()[:100]
    cleaned['ciu_alum'] = str(data.get('ciu_alum', '')).strip()[:100]
    cleaned['direc_alum'] = str(data.get('direc_alum', '')).strip()[:500]
    cleaned['lugar_nac_alum'] = str(data.get('lugar_nac_alum', '')).strip()[:150]
    cleaned['nacionalidad_alum'] = str(data.get('nacionalidad_alum', 'VENEZOLANA')).strip()[:100]
    cleaned['etnia'] = 'Ninguna'  # Eliminado del formulario visual

    if not cleaned['est_alum']:
        return False, None, "Debe seleccionar su Estado de residencia."
    if not cleaned['ciu_alum']:
        return False, None, "Debe seleccionar su Ciudad o Municipio."
    if not cleaned['direc_alum'] or len(cleaned['direc_alum']) < 8:
        return False, None, "Debe detallar su dirección de habitación completa (mínimo 8 caracteres)."

    # 8. Datos Académicos
    cleaned['niv_acad_alum'] = str(data.get('niv_acad_alum', 'Bachiller')).strip()[:150]
    cleaned['inst_grad_alum'] = str(data.get('inst_grad_alum', '')).strip()[:200]
    cleaned['ubica_inst_muni_alum'] = str(data.get('ubica_inst_muni_alum', '')).strip()[:150]
    
    ano_grad = data.get('ano_grad_alum')
    if ano_grad and str(ano_grad).isdigit():
        ano_int = int(ano_grad)
        if ano_int < 1990 or ano_int > (date.today().year + 1):
            return False, None, f"El año de graduación debe ser válido (entre 1990 y {date.today().year + 1})."
        cleaned['ano_grad_alum'] = ano_int
    else:
        cleaned['ano_grad_alum'] = date.today().year

    cleaned['tipo_colegio'] = str(data.get('tipo_colegio', 'Público')).strip()[:50]

    # 9. Carrera de Postulación IUAC
    carrera = str(data.get('carrera', '')).strip().upper()
    if carrera not in CARRERAS_VALIDAS:
        return False, None, f"La carrera seleccionada '{carrera}' no es válida. Seleccione una carrera de la oferta académica oficial."
    cleaned['carrera'] = carrera

    # 10. Metadatos del Sistema y Fotografía
    cleaned['foto_base64'] = data.get('foto_base64')
    cleaned['modalidad_ing'] = 'REGULAR'
    cleaned['condicion_resi'] = 'EXTERNO'
    cleaned['turno_class'] = 'DIURNO'
    cleaned['canal_inscripcion'] = 'WEB'
    cleaned['status_alum'] = 'REGISTRADO_WEB'
    cleaned['observaciones'] = str(data.get('observaciones', 'Inscripción vía formulario público web')).strip()[:500]

    return True, cleaned, None
