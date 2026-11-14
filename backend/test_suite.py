"""
test_suite.py - Pruebas unitarias completas de validación y seguridad
Incluye la reglamentación oficial de edad para el 13/09/2027.
"""

import unittest
from datetime import date
from validations import (
    validar_cedula_venezolana,
    validar_telefono_venezolano,
    calcular_edad_actual,
    verificar_criterio_edad_iuac,
    validate_aspirante_payload,
    CARRERAS_VALIDAS
)
from security import check_honeypot, contains_malicious_payload

class TestValidationsIUAC(unittest.TestCase):

    def test_criterio_edad_reglamentaria_13_septiembre_2027(self):
        # 1. Nacido el 13 de Septiembre de 2003: Al 13/09/2027 cumple 24 años -> RECHAZADO
        ok1, edad_act1, edad_ing1, err1 = verificar_criterio_edad_iuac("2003-09-13")
        self.assertFalse(ok1)
        self.assertEqual(edad_ing1, 24)
        self.assertIn("máximo de 23 años cumplidos", err1)

        # 2. Nacido el 14 de Septiembre de 2003: Al 13/09/2027 aún tiene 23 años -> ADMITIDO
        ok2, edad_act2, edad_ing2, _ = verificar_criterio_edad_iuac("2003-09-14")
        self.assertTrue(ok2)
        self.assertEqual(edad_ing2, 23)

        # 3. Aspirante menor de 16 años al momento del registro -> RECHAZADO
        ok3, _, _, err3 = verificar_criterio_edad_iuac("2015-01-01")
        self.assertFalse(ok3)
        self.assertIn("al menos 16 años", err3)

    def test_nombres_solo_letras_y_espacios(self):
        datos_con_numeros = {
            "tipo_cedula": "V",
            "ced_alum": "28123456",
            "nom_alum": "Carlos123",
            "ape_alum": "Mendoza",
            "fec_nac_alum": "2005-05-15",
            "sex_alum": "M",
            "est_civil_alum": "Soltero/a",
            "est_alum": "Aragua",
            "ciu_alum": "Maracay",
            "direc_alum": "Av Bolivar centro",
            "telemov_alum": "0412-1234567",
            "correo_alum": "carlos@correo.com",
            "carrera": "CTA"
        }
        ok, _, err = validate_aspirante_payload(datos_con_numeros)
        self.assertFalse(ok)
        self.assertIn("solo permite letras", err)

    def test_validar_cedula_correcta(self):
        ok, clean_int, err = validar_cedula_venezolana("28.456.123")
        self.assertTrue(ok)
        self.assertEqual(clean_int, 28456123)
        self.assertIsInstance(clean_int, int)

    def test_telefonos_venezolanos(self):
        ok1, t1, _ = validar_telefono_venezolano("04121234567", "móvil")
        self.assertTrue(ok1)
        self.assertEqual(t1, "04121234567")

        ok2, t2, _ = validar_telefono_venezolano("+58-414-987-6543", "móvil")
        self.assertTrue(ok2)
        self.assertEqual(t2, "04149876543")

        # Prefijo inexistente
        ok3, _, _ = validar_telefono_venezolano("04191234567", "móvil")
        self.assertFalse(ok3)

    def test_deteccion_honeypot(self):
        self.assertFalse(check_honeypot({"website_url_hp": ""}))
        self.assertTrue(check_honeypot({"website_url_hp": "http://spambot.net"}))

    def test_prevencion_inyeccion_sql(self):
        payload_malicioso = {
            "nom_alum": "Juan'; DROP TABLE academico.estudiantes; --",
            "ape_alum": "Perez"
        }
        is_mal, err = contains_malicious_payload(payload_malicioso)
        self.assertTrue(is_mal)
        self.assertIn("nom_alum", err)

    def test_carreras_oficiales_iuac(self):
        carreras_esperadas = {'CTA', 'ICA', 'IMA', 'SAR', 'ETA', 'GTM', 'GTCP'}
        self.assertEqual(set(CARRERAS_VALIDAS.keys()), carreras_esperadas)

    def test_payload_completo_valido(self):
        datos = {
            "tipo_cedula": "V",
            "ced_alum": "29123456",
            "nom_alum": "Andres Eloy",
            "ape_alum": "Blanco Ramos",
            "fec_nac_alum": "2005-08-20",
            "sex_alum": "M",
            "est_civil_alum": "Soltero/a",
            "est_alum": "Aragua",
            "ciu_alum": "Maracay",
            "direc_alum": "Av. Las Delicias, Res. El Bosque",
            "telemov_alum": "0412-1234567",
            "correo_alum": "andres.blanco@correo.com",
            "carrera": "CTA",
            "ano_grad_alum": "2024",
            "inst_grad_alum": "Liceo Bolivariano Codazzi"
        }
        ok, cleaned, err = validate_aspirante_payload(datos)
        self.assertTrue(ok, f"Fallo con error: {err}")
        self.assertEqual(cleaned['carrera'], 'CTA')
        self.assertEqual(cleaned['ced_alum'], 29123456)
        self.assertIsInstance(cleaned['ced_alum'], int)

if __name__ == '__main__':
    unittest.main()
