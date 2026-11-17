/**
 * app.js - Lógica interactiva del Instituto Universitario de Aeronáutica Civil (IUAC)
 * Maneja navegación por pasos, validación reglamentaria de edad (Inicio: 13/09/2027),
 * validaciones en tiempo real para todos los campos, popups institucionales y envío a PostgreSQL.
 */

// Si el usuario abre el archivo directamente con doble clic en Windows (protocolo file://),
// redirige las peticiones AJAX al servidor Flask local en http://127.0.0.1:5050
const API_BASE = (window.location.protocol === 'file:') ? 'http://127.0.0.1:5050' : '';

// Diccionario oficial de carreras IUAC activas (solo activo = TRUE)
const MAPA_CARRERAS = {
    'CTA': 'Control de Tránsito Aéreo (CTA)',
    'ICA': 'Información y Comunicaciones Aeronáuticas (ICA)',
    'IMA': 'Mantenimiento Aeronáutico (IMA)',
    'SAR': 'Búsqueda y Salvamento (SAR)',
    'ETA': 'Electrónica Aeronáutica (ETA)'
};

let capturedPhotoBase64 = null;
let ultimoRegistroAspirante = {};
window.MAPA_CARRERAS = MAPA_CARRERAS;
window.ultimoRegistroAspirante = ultimoRegistroAspirante;

document.addEventListener('DOMContentLoaded', () => {
    checkFileProtocolBanner();
    initInfoPopup();
    initCarrerasModal();
    initRecuperarPlanillaModal();
    initStepper();
    initPhotoCapture();
    initGeoSelectors();
    initRealtimeValidations();
    initFormSubmit();
});

// Aviso educativo si abrieron el archivo como file:// en lugar de por el servidor web
function checkFileProtocolBanner() {
    if (window.location.protocol === 'file:') {
        const warningBanner = document.createElement('div');
        warningBanner.style.cssText = 'background:#fef3c7; color:#92400e; border-bottom:2px solid #f59e0b; padding:10px 16px; font-size:0.88rem; text-align:center; font-family:sans-serif; position:sticky; top:0; z-index:99999; box-shadow:0 2px 8px rgba(0,0,0,0.15);';
        warningBanner.innerHTML = `
            <strong>ℹ️ Nota de Acceso:</strong> Ha abierto este archivo directamente con doble clic (<em>file://</em>). 
            Las peticiones se enviarán automáticamente a <code>http://127.0.0.1:5050</code>. 
            Para acceder desde su celular o red local, ingrese en su navegador a: 
            <a href="http://127.0.0.1:5050" target="_blank" style="color:#0284c7; font-weight:bold; text-decoration:underline;">http://127.0.0.1:5050</a> o desde el móvil a <strong>http://10.40.111.19:5050</strong>.
        `;
        document.body.insertBefore(warningBanner, document.body.firstChild);
    }
}

// ── CAPTURA Y VALIDACIÓN DE FOTOGRAFÍA DESDE MÓVIL/PC (PUNTO 5) ──────────────
function initPhotoCapture() {
    const fileInput = document.getElementById('asp-foto_alum');
    const btnSubir = document.getElementById('btn-subir-foto');
    const btnQuitar = document.getElementById('btn-quitar-foto');
    const imgPreview = document.getElementById('photo-preview-img');
    const iconPlaceholder = document.getElementById('photo-placeholder-icon');
    const errFoto = document.getElementById('err-foto');
    const statusFotoPrincipal = document.getElementById('status-foto-principal');

    if (!fileInput || !btnSubir) return;

    // Solo usar .click() por JS si el elemento NO es un <label for="asp-foto_alum">
    if (btnSubir.tagName !== 'LABEL') {
        btnSubir.addEventListener('click', () => {
            fileInput.click();
        });
    }

    fileInput.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;

        // Validar tipo de imagen de forma amplia (compatible con todos los móviles y PC)
        const esImagenValida = (file.type && file.type.startsWith('image/')) || /\.(jpe?g|png|webp|bmp|gif|heic|heif)$/i.test(file.name || '');
        if (!esImagenValida) {
            if (errFoto) {
                errFoto.textContent = 'Formato inválido. Seleccione una imagen (JPG, PNG o WebP).';
                errFoto.classList.add('visible');
            }
            fileInput.value = '';
            return;
        }

        if (file.size > 35 * 1024 * 1024) {
            if (errFoto) {
                errFoto.textContent = 'La imagen seleccionada supera los 35 MB. Por favor seleccione una foto más liviana.';
                errFoto.classList.add('visible');
            }
            fileInput.value = '';
            return;
        }

        if (errFoto) errFoto.classList.remove('visible');
        btnSubir.textContent = '⏳ Optimizando foto...';

        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = async () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                // Escalar manteniendo proporción carnet optimizada (máx 320x400 px = ~15-18 KB en BD)
                const maxW = 320;
                const maxH = 400;
                if (width > maxW || height > maxH) {
                    const ratio = Math.min(maxW / width, maxH / height);
                    width = Math.round(width * ratio);
                    height = Math.round(height * ratio);
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                // Exportar como JPEG ultra-optimizado para carnet PDF (0.72 calidad = ~15-18 KB)
                capturedPhotoBase64 = canvas.toDataURL('image/jpeg', 0.72);
                window.capturedPhotoBase64 = capturedPhotoBase64;

                if (imgPreview) {
                    imgPreview.src = capturedPhotoBase64;
                    imgPreview.style.display = 'block';
                }
                if (iconPlaceholder) iconPlaceholder.style.display = 'none';
                if (btnQuitar) btnQuitar.style.display = 'inline-block';
                btnSubir.textContent = '🔄 Cambiar Foto';
                fileInput.value = '';

                if (typeof window.actualizarBarraReactivaIUAC === 'function') {
                    window.actualizarBarraReactivaIUAC();
                }

                // Si ya escribió una cédula válida, alojar de inmediato en carpeta fotos_aspirantes y BD
                const cedActual = (document.getElementById('asp-ced_alum')?.value || '').replace(/\D/g, '').trim();
                if (cedActual && cedActual.length >= 6 && cedActual.length <= 8) {
                    try {
                        const res = await fetch(`${API_BASE}/api/aspirantes/actualizar-foto`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ ced_alum: cedActual, foto_base64: capturedPhotoBase64 })
                        });
                        const data = await res.json();
                        if (res.ok && data.ok && statusFotoPrincipal) {
                            statusFotoPrincipal.textContent = `✓ Guardada en fotos_aspirantes/foto_${cedActual}.jpg`;
                            statusFotoPrincipal.style.display = 'block';
                        }
                    } catch (_) {}
                } else if (statusFotoPrincipal) {
                    statusFotoPrincipal.textContent = '✓ Fotografía lista (se alojará en fotos_aspirantes al registrar)';
                    statusFotoPrincipal.style.display = 'block';
                }
            };
            img.onerror = () => {
                if (errFoto) {
                    errFoto.textContent = 'Error al procesar la imagen seleccionada. Intente con otra.';
                    errFoto.classList.add('visible');
                }
                btnSubir.textContent = '📷 Tomar Foto / Subir Imagen';
                fileInput.value = '';
            };
            img.src = event.target.result;
        };
        reader.onerror = () => {
            if (errFoto) {
                errFoto.textContent = 'Error al leer el archivo en el dispositivo.';
                errFoto.classList.add('visible');
            }
            btnSubir.textContent = '📷 Tomar Foto / Subir Imagen';
            fileInput.value = '';
        };
        reader.readAsDataURL(file);
    });

    if (btnQuitar) {
        btnQuitar.addEventListener('click', () => {
            fileInput.value = '';
            capturedPhotoBase64 = null;
            window.capturedPhotoBase64 = null;
            if (imgPreview) {
                imgPreview.src = '';
                imgPreview.style.display = 'none';
            }
            if (iconPlaceholder) iconPlaceholder.style.display = 'block';
            btnQuitar.style.display = 'none';
            btnSubir.textContent = '📷 Tomar Foto / Subir Imagen';
            if (statusFotoPrincipal) statusFotoPrincipal.style.display = 'none';
            if (errFoto) errFoto.classList.remove('visible');
            if (typeof window.actualizarBarraReactivaIUAC === 'function') {
                window.actualizarBarraReactivaIUAC();
            }
        });
    }
}

// ── 1. POPUP INFORMATIVO INICIAL DE ACREDITACIÓN / ADMISIÓN (IMAGEN 6) ────────
function initInfoPopup() {
    const modal = document.getElementById('modal-info-popup');
    const btnCerrar = document.getElementById('btn-cerrar-popup');
    const btnComenzar = document.getElementById('btn-comenzar-registro');

    if (!modal) return;

    // Mostrar popup automáticamente al cargar la página
    setTimeout(() => {
        modal.classList.add('active');
    }, 350);

    const cerrarPopup = () => {
        modal.classList.remove('active');
    };

    if (btnCerrar) btnCerrar.addEventListener('click', cerrarPopup);
    if (btnComenzar) btnComenzar.addEventListener('click', cerrarPopup);

    modal.addEventListener('click', (e) => {
        if (e.target === modal) cerrarPopup();
    });
}

// ── 2. MODAL CON FULL EFECTO DE CARRERAS OFICIALES (PUNTO 10) ────────────────
function initCarrerasModal() {
    const btnVer = document.getElementById('btn-ver-carreras');
    const modal = document.getElementById('modal-carreras');
    const btnCerrar = document.getElementById('btn-cerrar-carreras');
    const btnCerrarFooter = document.getElementById('btn-cerrar-carreras-footer');

    if (!modal || !btnVer) return;

    const abrirModal = () => modal.classList.add('active');
    const cerrarModal = () => modal.classList.remove('active');

    btnVer.addEventListener('click', abrirModal);
    if (btnCerrar) btnCerrar.addEventListener('click', cerrarModal);
    if (btnCerrarFooter) btnCerrarFooter.addEventListener('click', cerrarModal);

    modal.addEventListener('click', (e) => {
        if (e.target === modal) cerrarModal();
    });
}

// ── 3. GESTIÓN DEL STEPPER (FORMULARIO MULTI-PASO) ───────────────────────────
let currentStep = 1;
const totalSteps = 3;
let formularioBloqueadoPorEdad = false;
let formularioBloqueadoPorCedula = false;

function initStepper() {
    const btnNext = document.getElementById('btn-step-next');
    const btnPrev = document.getElementById('btn-step-prev');

    if (btnNext) {
        btnNext.addEventListener('click', () => {
            if (formularioBloqueadoPorCedula) {
                mostrarAvisoScroll('cedula-lock-banner');
                return;
            }
            if (formularioBloqueadoPorEdad) {
                mostrarAvisoScroll('age-lock-banner');
                return;
            }
            if (validateCurrentStep(currentStep)) {
                if (currentStep < totalSteps) {
                    goToStep(currentStep + 1);
                }
            }
        });
    }

    if (btnPrev) {
        btnPrev.addEventListener('click', () => {
            if (currentStep > 1) {
                goToStep(currentStep - 1);
            }
        });
    }
}

function goToStep(step) {
    document.querySelectorAll('.step-pane').forEach(pane => pane.classList.remove('active'));
    const targetPane = document.getElementById(`step-pane-${step}`);
    if (targetPane) targetPane.classList.add('active');

    document.querySelectorAll('.step-node').forEach(node => {
        const nodeStep = parseInt(node.getAttribute('data-step'), 10);
        node.classList.remove('active', 'completed');
        if (nodeStep < step) {
            node.classList.add('completed');
        } else if (nodeStep === step) {
            node.classList.add('active');
        }
    });

    currentStep = step;

    const btnPrev = document.getElementById('btn-step-prev');
    const btnNext = document.getElementById('btn-step-next');
    const btnSubmit = document.getElementById('btn-step-submit');

    if (btnPrev) btnPrev.style.display = currentStep === 1 ? 'none' : 'inline-flex';
    if (btnNext) btnNext.style.display = currentStep === totalSteps ? 'none' : 'inline-flex';
    if (btnSubmit) btnSubmit.style.display = currentStep === totalSteps ? 'inline-flex' : 'none';

    const card = document.querySelector('.form-card');
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── 4. CARGA DINÁMICA DE ESTADOS Y CIUDADES ──────────────────────────────────
function initGeoSelectors() {
    const estadoSelect = document.getElementById('asp-est_alum');
    const ciudadSelect = document.getElementById('asp-ciu_alum');

    if (!estadoSelect || !ciudadSelect) return;

    const estados = Object.keys(window.VENEZUELA_GEO || {}).sort();
    estados.forEach(est => {
        const opt = document.createElement('option');
        opt.value = est;
        opt.textContent = est;
        estadoSelect.appendChild(opt);
    });

    estadoSelect.addEventListener('change', () => {
        const estSeleccionado = estadoSelect.value;
        ciudadSelect.innerHTML = '<option value="">Seleccione una ciudad...</option>';

        if (estSeleccionado && window.VENEZUELA_GEO[estSeleccionado]) {
            const ciudades = window.VENEZUELA_GEO[estSeleccionado];
            ciudades.forEach(ciu => {
                const opt = document.createElement('option');
                opt.value = ciu;
                opt.textContent = ciu;
                ciudadSelect.appendChild(opt);
            });
            ciudadSelect.disabled = false;
            setFieldValid(estadoSelect, 'err-estado');
        } else {
            ciudadSelect.disabled = true;
            setFieldInvalid(estadoSelect, 'err-estado', 'Debe seleccionar un Estado.');
        }
    });

    ciudadSelect.addEventListener('change', () => {
        if (ciudadSelect.value) {
            setFieldValid(ciudadSelect, 'err-ciudad');
        } else {
            setFieldInvalid(ciudadSelect, 'err-ciudad', 'Debe seleccionar una Ciudad.');
        }
    });
}

// ── 5. REGLAMENTACIÓN OFICIAL DE EDAD IUAC (IMAGEN ANEXA 1) ───────────────────
// Inicio de actividades: 13 de Septiembre de 2027
// El aspirante NO DEBE CUMPLIR 24 AÑOS para esa fecha (máximo 23 años cumplidos)
const FECHA_INICIO_ACTIVIDADES = new Date(2027, 8, 13); // Mes 8 = Septiembre

function calcularAñosEnFecha(fechaNac, fechaRef) {
    let edad = fechaRef.getFullYear() - fechaNac.getFullYear();
    const m = fechaRef.getMonth() - fechaNac.getMonth();
    if (m < 0 || (m === 0 && fechaRef.getDate() < fechaNac.getDate())) {
        edad--;
    }
    return edad;
}

function validarEdadReglamentariaIUAC(fechaStr) {
    if (!fechaStr) return { valido: false, edadActual: null, error: 'Fecha obligatoria' };
    const parts = fechaStr.split('-');
    if (parts.length !== 3) return { valido: false, edadActual: null, error: 'Formato inválido' };

    const birth = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    const today = new Date();

    const edadActual = calcularAñosEnFecha(birth, today);
    const edadAlIngreso = calcularAñosEnFecha(birth, FECHA_INICIO_ACTIVIDADES);

    // Condición 1: Mínimo 16 años al momento del registro
    if (edadActual < 16) {
        return {
            valido: false,
            edadActual: edadActual,
            edadAlIngreso: edadAlIngreso,
            tipoFallo: 'MENOR_EDAD',
            error: `El aspirante tiene ${edadActual} años. La edad mínima requerida para registrarse es de 16 años cumplidos.`
        };
    }

    // Condición 2 (Reglamentaria): NO cumplir 24 años para el 13/09/2027 (máximo 23 años)
    if (edadAlIngreso >= 24) {
        return {
            valido: false,
            edadActual: edadActual,
            edadAlIngreso: edadAlIngreso,
            tipoFallo: 'MAXIMA_EDAD',
            error: `El aspirante cumplirá ${edadAlIngreso} años para el inicio de actividades (13/09/2027). El reglamento exige tener como máximo 23 años cumplidos (no cumplir 24 años para dicha fecha).`
        };
    }

    return {
        valido: true,
        edadActual: edadActual,
        edadAlIngreso: edadAlIngreso,
        error: null
    };
}

function bloquearFormularioPorEdad(motivo) {
    formularioBloqueadoPorEdad = true;
    const banner = document.getElementById('age-lock-banner');
    const bannerText = document.getElementById('age-lock-text');
    const formCard = document.getElementById('form-card-container');

    if (banner && bannerText) {
        bannerText.innerHTML = `
            <p><strong>Aviso Reglamentario Oficial:</strong> ${motivo}</p>
            <p style="margin-top:0.4rem; font-size:0.84rem;">
                📌 <em>El sistema ha bloqueado automáticamente los campos restantes del formulario según lo establecido en las Normas de Admisión Académica del IUAC. Para continuar, ingrese una fecha de nacimiento válida que cumpla el criterio reglamentario.</em>
            </p>
        `;
        banner.classList.add('visible');
    }

    if (formCard) formCard.classList.add('locked-by-age');

    // Deshabilitar campos interactivos
    document.querySelectorAll('.lockable-field input, .lockable-field select, .lockable-field textarea, .btn-nav').forEach(el => {
        el.disabled = true;
    });
}

function desbloquearFormularioPorEdad() {
    formularioBloqueadoPorEdad = false;
    const banner = document.getElementById('age-lock-banner');
    const formCard = document.getElementById('form-card-container');

    if (banner) banner.classList.remove('visible');
    if (formCard) formCard.classList.remove('locked-by-age');

    if (formularioBloqueadoPorCedula) return;

    // Habilitar campos interactivos
    document.querySelectorAll('.lockable-field input, .lockable-field select, .lockable-field textarea, .btn-nav').forEach(el => {
        el.disabled = false;
    });

    const ciudadSelect = document.getElementById('asp-ciu_alum');
    const estadoSelect = document.getElementById('asp-est_alum');
    if (ciudadSelect && (!estadoSelect || !estadoSelect.value)) {
        ciudadSelect.disabled = true;
    }
}

// ── 5.1 BLOQUEO AUTOMÁTICO CUANDO LA CÉDULA YA ESTÁ REGISTRADA (PUNTO 5) ─────
function bloquearFormularioPorCedulaRegistrada(cedula) {
    formularioBloqueadoPorCedula = true;
    const banner = document.getElementById('cedula-lock-banner');
    const formCard = document.getElementById('form-card-container');
    const fecNac = document.getElementById('asp-fec_nac_alum');
    const btnFoto = document.getElementById('btn-subir-foto');

    if (banner) {
        banner.classList.add('visible');
    }
    if (formCard) {
        formCard.classList.add('locked-by-cedula');
    }

    // Deshabilitar todos los demás campos y botones de navegación excepto el campo Cédula, Foto y el botón de búsqueda
    document.querySelectorAll('.lockable-field input, .lockable-field select, .lockable-field textarea, .btn-nav').forEach(el => {
        el.disabled = true;
    });
    if (fecNac) fecNac.disabled = true;
}

function desbloquearFormularioPorCedulaRegistrada() {
    if (!formularioBloqueadoPorCedula) return;
    formularioBloqueadoPorCedula = false;

    const banner = document.getElementById('cedula-lock-banner');
    const formCard = document.getElementById('form-card-container');
    const fecNac = document.getElementById('asp-fec_nac_alum');
    const btnFoto = document.getElementById('btn-subir-foto');

    if (banner) banner.classList.remove('visible');
    if (formCard) formCard.classList.remove('locked-by-cedula');
    if (fecNac) fecNac.disabled = false;
    if (btnFoto) btnFoto.disabled = false;

    if (formularioBloqueadoPorEdad) return;

    document.querySelectorAll('.lockable-field input, .lockable-field select, .lockable-field textarea, .btn-nav').forEach(el => {
        el.disabled = false;
    });

    const ciudadSelect = document.getElementById('asp-ciu_alum');
    const estadoSelect = document.getElementById('asp-est_alum');
    if (ciudadSelect && (!estadoSelect || !estadoSelect.value)) {
        ciudadSelect.disabled = true;
    }
}

// ── 5.2 MODAL Y BÚSQUEDA DIRECTA PARA DESCARGAR PLANILLA PDF (PUNTOS 2 Y 3) ──
function abrirModalRecuperarPlanilla(cedulaPrefill = '') {
    const modal = document.getElementById('modal-recuperar-planilla');
    const inputCed = document.getElementById('input-buscar-cedula');
    const errBox = document.getElementById('err-buscar-cedula');
    if (!modal) return;

    const cedActual = cedulaPrefill || document.getElementById('asp-ced_alum')?.value?.trim() || '';
    if (inputCed) {
        inputCed.value = cedActual.replace(/\D/g, '').slice(0, 8);
    }
    if (errBox) {
        errBox.textContent = '';
        errBox.classList.remove('visible');
    }
    modal.classList.add('active');
    setTimeout(() => {
        if (inputCed) inputCed.focus();
    }, 150);
}
window.abrirModalRecuperarPlanilla = abrirModalRecuperarPlanilla;

function initRecuperarPlanillaModal() {
    const modal = document.getElementById('modal-recuperar-planilla');
    const btnHero = document.getElementById('btn-abrir-busqueda-hero');
    const btnBanner = document.getElementById('btn-recuperar-desde-banner');
    const btnCerrar = document.getElementById('btn-cerrar-recuperar');
    const btnEjecutar = document.getElementById('btn-ejecutar-busqueda-planilla');
    const inputCed = document.getElementById('input-buscar-cedula');
    const errBox = document.getElementById('err-buscar-cedula');
    const inputFotoRec = document.getElementById('input-recuperar-foto');
    const btnSubirFotoRec = document.getElementById('btn-recuperar-subir-foto');
    const statusFotoRec = document.getElementById('status-recuperar-foto');
    let fotoRecuperacionBase64 = null;

    if (btnHero) {
        btnHero.addEventListener('click', () => abrirModalRecuperarPlanilla());
    }
    if (btnBanner) {
        btnBanner.addEventListener('click', () => {
            const ced = document.getElementById('asp-ced_alum')?.value?.trim() || '';
            abrirModalRecuperarPlanilla(ced);
        });
    }
    if (!modal) return;

    if (btnSubirFotoRec && inputFotoRec) {
        if (btnSubirFotoRec.tagName !== 'LABEL') {
            btnSubirFotoRec.addEventListener('click', () => inputFotoRec.click());
        }
        inputFotoRec.addEventListener('change', (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file) return;
            btnSubirFotoRec.textContent = '⏳ Optimizando y subiendo foto...';
            const reader = new FileReader();
            reader.onload = (ev) => {
                const img = new Image();
                img.onload = async () => {
                    const canvas = document.createElement('canvas');
                    let w = img.width, h = img.height;
                    const ratio = Math.min(320 / w, 400 / h, 1);
                    w = Math.round(w * ratio);
                    h = Math.round(h * ratio);
                    canvas.width = w;
                    canvas.height = h;
                    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                    fotoRecuperacionBase64 = canvas.toDataURL('image/jpeg', 0.72);
                    capturedPhotoBase64 = fotoRecuperacionBase64;
                    window.capturedPhotoBase64 = fotoRecuperacionBase64;

                    const previewBox = document.getElementById('preview-recuperar-foto-box');
                    const previewImg = document.getElementById('preview-recuperar-foto-img');
                    if (previewBox && previewImg) {
                        previewImg.src = fotoRecuperacionBase64;
                        previewBox.style.display = 'block';
                    }

                    btnSubirFotoRec.textContent = '🔄 Cambiar Fotografía Seleccionada';
                    inputFotoRec.value = '';

                    // Si ya ingresó la cédula en el campo de consulta, guardarla de inmediato en fotos_aspirantes y BD
                    const cedVal = (inputCed?.value || '').replace(/\D/g, '').trim();
                    if (cedVal && cedVal.length >= 6 && cedVal.length <= 8) {
                        try {
                            const res = await fetch(`${API_BASE}/api/aspirantes/actualizar-foto`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ ced_alum: cedVal, foto_base64: fotoRecuperacionBase64 })
                            });
                            const data = await res.json();
                            if (statusFotoRec) {
                                statusFotoRec.textContent = (res.ok && data.ok)
                                    ? `✓ Fotografía alojada en fotos_aspirantes/foto_${cedVal}.jpg y guardada en la BD.`
                                    : '✓ Fotografía lista para incluir en su planilla PDF.';
                                statusFotoRec.style.display = 'block';
                            }
                        } catch (_) {
                            if (statusFotoRec) {
                                statusFotoRec.textContent = '✓ Fotografía cargada. Se guardará al descargar la planilla.';
                                statusFotoRec.style.display = 'block';
                            }
                        }
                    } else if (statusFotoRec) {
                        statusFotoRec.textContent = '✓ Fotografía cargada. Ingrese su cédula arriba y presione Descargar.';
                        statusFotoRec.style.display = 'block';
                    }
                };
                img.src = ev.target.result;
            };
            reader.readAsDataURL(file);
        });
    }

    const cerrar = () => modal.classList.remove('active');
    if (btnCerrar) btnCerrar.addEventListener('click', cerrar);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) cerrar();
    });

    if (inputCed) {
        inputCed.addEventListener('input', (e) => {
            e.target.value = e.target.value.replace(/\D/g, '').slice(0, 8);
            if (errBox) {
                errBox.textContent = '';
                errBox.classList.remove('visible');
            }
        });
    }

    if (btnEjecutar) {
        btnEjecutar.addEventListener('click', async () => {
            const ced = (inputCed?.value || '').replace(/\D/g, '').trim();
            if (!ced || ced.length < 6 || ced.length > 8) {
                if (errBox) {
                    errBox.textContent = 'Por favor ingrese un número de cédula válido (entre 6 y 8 dígitos).';
                    errBox.classList.add('visible');
                }
                return;
            }

            btnEjecutar.disabled = true;
            const textoOriginal = btnEjecutar.innerHTML;
            btnEjecutar.innerHTML = '⏳ Verificando titular y consultando...';

            try {
                // 1. Si se usa desde el móvil y tiene huella activa, solicitar verificación biométrica del titular
                if (typeof window.verificarHuellaTitularMovil === 'function') {
                    const bioRes = await window.verificarHuellaTitularMovil(ced);
                    if (!bioRes.ok) {
                        if (errBox) {
                            errBox.textContent = bioRes.error;
                            errBox.classList.add('visible');
                        }
                        return;
                    }
                }

                // 1.1 Si el aspirante adjuntó una fotografía para actualizar su registro en la BD, guardarla primero
                if (fotoRecuperacionBase64) {
                    await fetch(`${API_BASE}/api/aspirantes/actualizar-foto`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ced_alum: ced, foto_base64: fotoRecuperacionBase64 })
                    });
                }

                // 2. Consultar datos del aspirante en el servidor
                const res = await fetch(`${API_BASE}/api/aspirantes/planilla/${ced}`);
                const data = await res.json();

                if (!res.ok || !data.ok || !data.aspirante) {
                    if (errBox) {
                        errBox.textContent = data.error || 'No se encontró ningún aspirante registrado con esta cédula.';
                        errBox.classList.add('visible');
                    }
                    return;
                }

                // 3. Cargar datos recuperados y disparar descarga directa del PDF de 1 página con QR y Foto
                const fotoFinal = fotoRecuperacionBase64 || data.aspirante.foto_base64 || null;
                ultimoRegistroAspirante = { ...data.aspirante, folio: data.folio, foto_base64: fotoFinal };
                window.ultimoRegistroAspirante = ultimoRegistroAspirante;
                capturedPhotoBase64 = fotoFinal;
                window.capturedPhotoBase64 = capturedPhotoBase64;

                cerrar();
                mostrarModalExito(data);

                if (typeof window.descargarPlanillaPDFOficial === 'function') {
                    await window.descargarPlanillaPDFOficial(ultimoRegistroAspirante);
                }
            } catch (err) {
                if (errBox) {
                    errBox.textContent = 'No se pudo conectar con el servidor en este momento. Intente nuevamente.';
                    errBox.classList.add('visible');
                }
            } finally {
                btnEjecutar.disabled = false;
                btnEjecutar.innerHTML = textoOriginal;
            }
        });
    }
}

// ── 6. HELPERS DE VALIDACIÓN VISUAL EN TIEMPO REAL ───────────────────────────
function setFieldValid(input, errId) {
    if (!input) return;
    input.classList.remove('is-invalid');
    input.classList.add('is-valid');
    const errBox = document.getElementById(errId);
    if (errBox) {
        errBox.textContent = '';
        errBox.classList.remove('visible');
    }
}

function setFieldInvalid(input, errId, message) {
    if (!input) return;
    input.classList.remove('is-valid');
    input.classList.add('is-invalid');
    const errBox = document.getElementById(errId);
    if (errBox) {
        errBox.textContent = message;
        errBox.classList.add('visible');
    }
}

function mostrarAvisoScroll(elementId) {
    const el = document.getElementById(elementId);
    if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (el.focus) el.focus();
    }
}

// ── 7. VALIDACIONES EN TIEMPO REAL PARA TODOS LOS CAMPOS ─────────────────────
let cedulaDisponible = false;
let checkCedulaTimeout = null;

const REGEX_LETRAS_Y_ESPACIOS = /^[a-zA-ZáéíóúÁÉÍÓÚñÑüÜ\s\.]+$/;
const REGEX_EMAIL = /^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$/;
const PREFIJOS_MOVILES = ['0412', '0414', '0424', '0416', '0426'];

function initRealtimeValidations() {
    const cedulaInput = document.getElementById('asp-ced_alum');
    const nombresInput = document.getElementById('asp-nom_alum');
    const apellidosInput = document.getElementById('asp-ape_alum');
    const fecNacInput = document.getElementById('asp-fec_nac_alum');
    const lugarNacInput = document.getElementById('asp-lugar_nac_alum');
    const telemovInput = document.getElementById('asp-telemov_alum');
    const telehabInput = document.getElementById('asp-telehabi_alum');
    const correoInput = document.getElementById('asp-correo_alum');
    const direcInput = document.getElementById('asp-direc_alum');
    const carreraSelect = document.getElementById('asp-carrera');
    const anoGradInput = document.getElementById('asp-ano_grad_alum');
    const instGradInput = document.getElementById('asp-inst_grad_alum');

    // 1. Cédula
    if (cedulaInput) {
        cedulaInput.addEventListener('input', (e) => {
            e.target.value = e.target.value.replace(/\D/g, '').slice(0, 8);
            const val = e.target.value.trim();
            clearTimeout(checkCedulaTimeout);
            const statusLabel = document.getElementById('asp-cedula-status');

            if (!val) {
                setFieldInvalid(cedulaInput, 'err-cedula', 'El número de cédula es obligatorio.');
                statusLabel.innerHTML = '';
                cedulaDisponible = false;
                desbloquearFormularioPorCedulaRegistrada();
            } else if (val.length < 6) {
                setFieldInvalid(cedulaInput, 'err-cedula', 'La cédula debe tener entre 6 y 8 dígitos.');
                statusLabel.innerHTML = '';
                cedulaDisponible = false;
                desbloquearFormularioPorCedulaRegistrada();
            } else {
                setFieldValid(cedulaInput, 'err-cedula');
                statusLabel.innerHTML = '<span style="color:#0284c7; font-size:0.75rem;">⏳ Comprobando disponibilidad...</span>';
                checkCedulaTimeout = setTimeout(() => verificarCedulaRemota(val), 350);
            }
        });
        const limpiarCedula = (e) => { e.target.value = e.target.value.trim(); };
        cedulaInput.addEventListener('blur', limpiarCedula);
        cedulaInput.addEventListener('change', limpiarCedula);
    }

    // 2. Nombres (Solo caracteres alfabéticos y espacios; sin espacios iniciales, dobles o finales)
    if (nombresInput) {
        nombresInput.addEventListener('input', (e) => {
            // Evitar espacios al inicio, caracteres raros y dobles espacios consecutivos
            e.target.value = e.target.value.replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑüÜ\s]/g, '')
                                          .replace(/^\s+/, '')
                                          .replace(/\s{2,}/g, ' ');
            const val = e.target.value.trim();
            if (!val) {
                setFieldInvalid(nombresInput, 'err-nombres', 'El campo Nombres es obligatorio.');
            } else if (val.length < 2) {
                setFieldInvalid(nombresInput, 'err-nombres', 'Mínimo 2 letras.');
            } else if (!REGEX_LETRAS_Y_ESPACIOS.test(val)) {
                setFieldInvalid(nombresInput, 'err-nombres', 'Solo se permiten letras y espacios.');
            } else {
                setFieldValid(nombresInput, 'err-nombres');
            }
        });

        // Al salir del campo o cambiar foco: eliminar automáticamente el espacio final agregado por teclados móviles
        const limpiarEspaciosNombres = (e) => {
            e.target.value = e.target.value.trim().replace(/\s{2,}/g, ' ');
        };
        nombresInput.addEventListener('blur', limpiarEspaciosNombres);
        nombresInput.addEventListener('change', limpiarEspaciosNombres);
    }

    // 3. Apellidos (Solo caracteres alfabéticos y espacios; sin espacios iniciales, dobles o finales)
    if (apellidosInput) {
        apellidosInput.addEventListener('input', (e) => {
            e.target.value = e.target.value.replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑüÜ\s]/g, '')
                                          .replace(/^\s+/, '')
                                          .replace(/\s{2,}/g, ' ');
            const val = e.target.value.trim();
            if (!val) {
                setFieldInvalid(apellidosInput, 'err-apellidos', 'El campo Apellidos es obligatorio.');
            } else if (val.length < 2) {
                setFieldInvalid(apellidosInput, 'err-apellidos', 'Mínimo 2 letras.');
            } else if (!REGEX_LETRAS_Y_ESPACIOS.test(val)) {
                setFieldInvalid(apellidosInput, 'err-apellidos', 'Solo se permiten letras y espacios.');
            } else {
                setFieldValid(apellidosInput, 'err-apellidos');
            }
        });

        const limpiarEspaciosApellidos = (e) => {
            e.target.value = e.target.value.trim().replace(/\s{2,}/g, ' ');
        };
        apellidosInput.addEventListener('blur', limpiarEspaciosApellidos);
        apellidosInput.addEventListener('change', limpiarEspaciosApellidos);
    }

    // 4. Fecha de Nacimiento y Bloqueo Reglamentario de Edad (Puntos 1 y 2)
    if (fecNacInput) {
        fecNacInput.addEventListener('change', () => {
            const fechaVal = fecNacInput.value;
            const edadInput = document.getElementById('asp-edad_alum');
            const resValidacion = validarEdadReglamentariaIUAC(fechaVal);

            if (!fechaVal) {
                setFieldInvalid(fecNacInput, 'err-fec_nac', 'La fecha de nacimiento es obligatoria.');
                if (edadInput) edadInput.value = '';
                desbloquearFormularioPorEdad();
                return;
            }

            if (edadInput && resValidacion.edadActual !== null) {
                edadInput.value = resValidacion.edadActual;
            }

            if (!resValidacion.valido) {
                setFieldInvalid(fecNacInput, 'err-fec_nac', resValidacion.error);
                bloquearFormularioPorEdad(resValidacion.error);
            } else {
                setFieldValid(fecNacInput, 'err-fec_nac');
                desbloquearFormularioPorEdad();
            }
        });
    }

    // 5. Lugar de Nacimiento (sin espacios iniciales ni finales)
    if (lugarNacInput) {
        lugarNacInput.addEventListener('input', (e) => {
            e.target.value = e.target.value.replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑüÜ\s]/g, '')
                                          .replace(/^\s+/, '')
                                          .replace(/\s{2,}/g, ' ');
            const val = e.target.value.trim();
            if (!val) {
                setFieldInvalid(lugarNacInput, 'err-lugar_nac', 'El lugar de nacimiento es obligatorio.');
            } else {
                setFieldValid(lugarNacInput, 'err-lugar_nac');
            }
        });
        const limpiarLugarNac = (e) => {
            e.target.value = e.target.value.trim().replace(/\s{2,}/g, ' ');
        };
        lugarNacInput.addEventListener('blur', limpiarLugarNac);
        lugarNacInput.addEventListener('change', limpiarLugarNac);
    }

    // 6. Teléfono Celular con máscara (0412-1234567)
    if (telemovInput) {
        telemovInput.addEventListener('input', (e) => {
            let digits = e.target.value.replace(/\D/g, '').slice(0, 11);
            if (digits.length > 4) {
                e.target.value = `${digits.slice(0, 4)}-${digits.slice(4)}`;
            } else {
                e.target.value = digits;
            }

            const raw = digits;
            if (!raw) {
                setFieldInvalid(telemovInput, 'err-telemov', 'El teléfono celular es obligatorio.');
            } else if (raw.length < 11) {
                setFieldInvalid(telemovInput, 'err-telemov', 'Debe tener 11 dígitos (ej: 0412-1234567).');
            } else {
                const prefix = raw.slice(0, 4);
                if (!PREFIJOS_MOVILES.includes(prefix)) {
                    setFieldInvalid(telemovInput, 'err-telemov', `Prefijo '${prefix}' no válido. Use 0412, 0414, 0424, 0416 o 0426.`);
                } else {
                    setFieldValid(telemovInput, 'err-telemov');
                }
            }
        });
        const limpiarTelemov = (e) => { e.target.value = e.target.value.trim(); };
        telemovInput.addEventListener('blur', limpiarTelemov);
        telemovInput.addEventListener('change', limpiarTelemov);
    }

    // 7. Teléfono Habitación (opcional pero validado si se escribe)
    if (telehabInput) {
        telehabInput.addEventListener('input', (e) => {
            let digits = e.target.value.replace(/\D/g, '').slice(0, 11);
            if (digits.length > 4) {
                e.target.value = `${digits.slice(0, 4)}-${digits.slice(4)}`;
            } else {
                e.target.value = digits;
            }

            if (digits.length > 0 && digits.length < 11) {
                setFieldInvalid(telehabInput, 'err-telehab', 'Debe contener 11 dígitos (ej: 0243-1234567).');
            } else {
                setFieldValid(telehabInput, 'err-telehab');
            }
        });
        const limpiarTelehab = (e) => { e.target.value = e.target.value.trim(); };
        telehabInput.addEventListener('blur', limpiarTelehab);
        telehabInput.addEventListener('change', limpiarTelehab);
    }

    // 8. Correo Electrónico (elimina automáticamente cualquier espacio)
    if (correoInput) {
        correoInput.addEventListener('input', (e) => {
            e.target.value = e.target.value.replace(/\s+/g, '').toLowerCase();
            const val = e.target.value.trim();
            if (!val) {
                setFieldInvalid(correoInput, 'err-correo', 'El correo electrónico es obligatorio.');
            } else if (!REGEX_EMAIL.test(val)) {
                setFieldInvalid(correoInput, 'err-correo', 'Formato de correo no válido (ej: aspirante@correo.com).');
            } else {
                setFieldValid(correoInput, 'err-correo');
            }
        });
        const limpiarCorreo = (e) => {
            e.target.value = e.target.value.trim().toLowerCase().replace(/\s+/g, '');
        };
        correoInput.addEventListener('blur', limpiarCorreo);
        correoInput.addEventListener('change', limpiarCorreo);
    }

    // 9. Dirección
    if (direcInput) {
        direcInput.addEventListener('input', (e) => {
            e.target.value = e.target.value.replace(/^\s+/, '').replace(/[ \t]{2,}/g, ' ');
            const val = e.target.value.trim();
            if (!val) {
                setFieldInvalid(direcInput, 'err-direccion', 'La dirección de habitación es obligatoria.');
            } else if (val.length < 8) {
                setFieldInvalid(direcInput, 'err-direccion', 'Por favor detalle su dirección completa (mínimo 8 caracteres).');
            } else {
                setFieldValid(direcInput, 'err-direccion');
            }
        });
        const limpiarDirec = (e) => {
            e.target.value = e.target.value.trim().replace(/[ \t]{2,}/g, ' ');
        };
        direcInput.addEventListener('blur', limpiarDirec);
        direcInput.addEventListener('change', limpiarDirec);
    }

    // 10. Carrera
    if (carreraSelect) {
        carreraSelect.addEventListener('change', () => {
            if (!carreraSelect.value) {
                setFieldInvalid(carreraSelect, 'err-carrera', 'Debe seleccionar una carrera de postulación.');
            } else {
                setFieldValid(carreraSelect, 'err-carrera');
            }
        });
    }

    // 11. Año de Graduación
    if (anoGradInput) {
        anoGradInput.addEventListener('input', () => {
            anoGradInput.value = anoGradInput.value.replace(/\D/g, '').slice(0, 4);
            const val = parseInt(anoGradInput.value, 10);
            const currentYear = new Date().getFullYear();
            if (!val || val < 1990 || val > (currentYear + 1)) {
                setFieldInvalid(anoGradInput, 'err-ano_grad', `Año válido entre 1990 y ${currentYear + 1}.`);
            } else {
                setFieldValid(anoGradInput, 'err-ano_grad');
            }
        });
        const limpiarAnoGrad = (e) => { e.target.value = e.target.value.trim(); };
        anoGradInput.addEventListener('blur', limpiarAnoGrad);
        anoGradInput.addEventListener('change', limpiarAnoGrad);
    }

    // 12. Plantel de Egreso
    if (instGradInput) {
        instGradInput.addEventListener('input', (e) => {
            e.target.value = e.target.value.replace(/^\s+/, '').replace(/\s{2,}/g, ' ');
            const val = instGradInput.value.trim();
            if (!val) {
                setFieldInvalid(instGradInput, 'err-inst_grad', 'Indique la institución de egreso.');
            } else {
                setFieldValid(instGradInput, 'err-inst_grad');
            }
        });
        const limpiarInstGrad = (e) => {
            e.target.value = e.target.value.trim().replace(/\s{2,}/g, ' ');
        };
        instGradInput.addEventListener('blur', limpiarInstGrad);
        instGradInput.addEventListener('change', limpiarInstGrad);
    }
}

async function verificarCedulaRemota(cedula) {
    const statusLabel = document.getElementById('asp-cedula-status');
    const input = document.getElementById('asp-ced_alum');

    try {
        const res = await fetch(`${API_BASE}/api/validar-cedula/${cedula}`);
        const data = await res.json();

        if (res.ok && data.ok) {
            if (data.exists) {
                cedulaDisponible = false;
                setFieldInvalid(input, 'err-cedula', '⚠️ Usted ya se encuentra inscrito en el sistema. Los demás campos han sido desactivados.');
                bloquearFormularioPorCedulaRegistrada(cedula);
                statusLabel.innerHTML = `
                    <div style="margin-top:8px;">
                        <button type="button" class="btn btn-primary" style="padding:0.5rem 1rem; font-size:0.84rem; width:100%;" onclick="abrirModalRecuperarPlanilla('${cedula}')">
                            🔍 Buscar y Descargar mi Planilla (PDF)
                        </button>
                    </div>
                `;
            } else {
                cedulaDisponible = true;
                desbloquearFormularioPorCedulaRegistrada();
                setFieldValid(input, 'err-cedula');
                statusLabel.innerHTML = '<span style="color:#10b981; font-size:0.75rem; font-weight:700;">✓ Cédula disponible para inscripción</span>';
            }
        }
    } catch (e) {
        cedulaDisponible = true;
        desbloquearFormularioPorCedulaRegistrada();
        statusLabel.innerHTML = '';
    }
}

// ── 8. VALIDACIÓN POR PASOS SIN USAR ALERT() (PUNTO 7) ────────────────────────
function validateCurrentStep(step) {
    let primerErrorElement = null;

    if (step === 1) {
        const cedula = document.getElementById('asp-ced_alum');
        const nombres = document.getElementById('asp-nom_alum');
        const apellidos = document.getElementById('asp-ape_alum');
        const fecNac = document.getElementById('asp-fec_nac_alum');
        const lugarNac = document.getElementById('asp-lugar_nac_alum');

        // Limpieza automática de espacios residuales al presionar Siguiente
        if (cedula) cedula.value = cedula.value.trim();
        if (nombres) nombres.value = nombres.value.trim().replace(/\s{2,}/g, ' ');
        if (apellidos) apellidos.value = apellidos.value.trim().replace(/\s{2,}/g, ' ');
        if (lugarNac) lugarNac.value = lugarNac.value.trim().replace(/\s{2,}/g, ' ');

        if (!cedula.value || cedula.value.length < 6) {
            setFieldInvalid(cedula, 'err-cedula', 'Cédula obligatoria (mínimo 6 dígitos).');
            if (!primerErrorElement) primerErrorElement = cedula;
        }

        if (!nombres.value || !REGEX_LETRAS_Y_ESPACIOS.test(nombres.value)) {
            setFieldInvalid(nombres, 'err-nombres', 'Nombres obligatorios (solo letras y espacios).');
            if (!primerErrorElement) primerErrorElement = nombres;
        }

        if (!apellidos.value || !REGEX_LETRAS_Y_ESPACIOS.test(apellidos.value)) {
            setFieldInvalid(apellidos, 'err-apellidos', 'Apellidos obligatorios (solo letras y espacios).');
            if (!primerErrorElement) primerErrorElement = apellidos;
        }

        if (!fecNac.value) {
            setFieldInvalid(fecNac, 'err-fec_nac', 'Fecha de nacimiento obligatoria.');
            if (!primerErrorElement) primerErrorElement = fecNac;
        } else {
            const checkEdad = validarEdadReglamentariaIUAC(fecNac.value);
            if (!checkEdad.valido) {
                setFieldInvalid(fecNac, 'err-fec_nac', checkEdad.error);
                bloquearFormularioPorEdad(checkEdad.error);
                if (!primerErrorElement) primerErrorElement = fecNac;
            }
        }

        if (!lugarNac.value) {
            setFieldInvalid(lugarNac, 'err-lugar_nac', 'Lugar de nacimiento obligatorio.');
            if (!primerErrorElement) primerErrorElement = lugarNac;
        }

    } else if (step === 2) {
        const estado = document.getElementById('asp-est_alum');
        const ciudad = document.getElementById('asp-ciu_alum');
        const direccion = document.getElementById('asp-direc_alum');
        const telemov = document.getElementById('asp-telemov_alum');
        const telehab = document.getElementById('asp-telehabi_alum');
        const correo = document.getElementById('asp-correo_alum');

        // Limpieza automática de espacios residuales en el Paso 2
        if (direccion) direccion.value = direccion.value.trim().replace(/[ \t]{2,}/g, ' ');
        if (telemov) telemov.value = telemov.value.trim();
        if (telehab) telehab.value = telehab.value.trim();
        if (correo) correo.value = correo.value.trim().toLowerCase().replace(/\s+/g, '');

        if (!estado.value) {
            setFieldInvalid(estado, 'err-estado', 'Seleccione un Estado.');
            if (!primerErrorElement) primerErrorElement = estado;
        }
        if (!ciudad.value) {
            setFieldInvalid(ciudad, 'err-ciudad', 'Seleccione una Ciudad.');
            if (!primerErrorElement) primerErrorElement = ciudad;
        }
        if (!direccion.value || direccion.value.length < 8) {
            setFieldInvalid(direccion, 'err-direccion', 'Detalle su dirección completa (mínimo 8 caracteres).');
            if (!primerErrorElement) primerErrorElement = direccion;
        }
        const movDigits = telemov.value.replace(/\D/g, '');
        if (movDigits.length !== 11 || !PREFIJOS_MOVILES.includes(movDigits.slice(0, 4))) {
            setFieldInvalid(telemov, 'err-telemov', 'Teléfono celular venezolano obligatorio (11 dígitos).');
            if (!primerErrorElement) primerErrorElement = telemov;
        }
        if (!correo.value || !REGEX_EMAIL.test(correo.value)) {
            setFieldInvalid(correo, 'err-correo', 'Correo electrónico no válido.');
            if (!primerErrorElement) primerErrorElement = correo;
        }
    }

    if (primerErrorElement) {
        mostrarAvisoScroll(primerErrorElement.id);
        return false;
    }

    return true;
}

// ── 9. ENVÍO SEGURO DEL FORMULARIO Y MODAL DE CONFIRMACIÓN ──────────────────
function initFormSubmit() {
    const form = document.getElementById('form-preinscripcion');
    const btnSubmit = document.getElementById('btn-step-submit');
    const spinner = document.getElementById('submit-spinner');
    const btnText = document.getElementById('submit-text');

    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        if (formularioBloqueadoPorEdad) {
            mostrarAvisoScroll('age-lock-banner');
            return;
        }

        // Validaciones del Paso 3
        const carrera = document.getElementById('asp-carrera');
        const anoGrad = document.getElementById('asp-ano_grad_alum');
        const instGrad = document.getElementById('asp-inst_grad_alum');
        let errorPaso3 = null;

        if (!carrera || !carrera.value) {
            setFieldInvalid(carrera, 'err-carrera', 'Debe seleccionar una carrera de postulación.');
            if (!errorPaso3) errorPaso3 = carrera;
        }

        const valAno = parseInt(anoGrad?.value || '0', 10);
        if (!valAno || valAno < 1990 || valAno > (new Date().getFullYear() + 1)) {
            setFieldInvalid(anoGrad, 'err-ano_grad', 'Año de graduación válido obligatorio.');
            if (!errorPaso3) errorPaso3 = anoGrad;
        }

        if (instGrad) instGrad.value = instGrad.value.trim().replace(/\s{2,}/g, ' ');
        const obsEl = document.getElementById('asp-observaciones');
        if (obsEl) obsEl.value = obsEl.value.trim().replace(/[ \t]{2,}/g, ' ');

        if (!instGrad?.value) {
            setFieldInvalid(instGrad, 'err-inst_grad', 'Indique la institución de egreso.');
            if (!errorPaso3) errorPaso3 = instGrad;
        }

        if (errorPaso3) {
            mostrarAvisoScroll(errorPaso3.id);
            return;
        }

        // Construir Payload sanitizado sin espacios residuales
        const payload = {
            website_url_hp: document.getElementById('website_url_hp')?.value || '',

            tipo_cedula: document.getElementById('asp-tipo_cedula')?.value || 'V',
            ced_alum: document.getElementById('asp-ced_alum')?.value?.trim(),
            nom_alum: document.getElementById('asp-nom_alum')?.value?.trim().replace(/\s{2,}/g, ' '),
            ape_alum: document.getElementById('asp-ape_alum')?.value?.trim().replace(/\s{2,}/g, ' '),
            fec_nac_alum: document.getElementById('asp-fec_nac_alum')?.value,
            sex_alum: document.getElementById('asp-sex_alum')?.value || 'M',
            est_civil_alum: document.getElementById('asp-est_civil_alum')?.value || 'Soltero/a',
            lugar_nac_alum: document.getElementById('asp-lugar_nac_alum')?.value?.trim().replace(/\s{2,}/g, ' ') || '',
            nacionalidad_alum: document.getElementById('asp-nacionalidad_alum')?.value || 'VENEZOLANA',

            pais_alum: document.getElementById('asp-pais_alum')?.value || 'Venezuela',
            est_alum: document.getElementById('asp-est_alum')?.value,
            ciu_alum: document.getElementById('asp-ciu_alum')?.value,
            direc_alum: document.getElementById('asp-direc_alum')?.value?.trim().replace(/[ \t]{2,}/g, ' '),
            telemov_alum: document.getElementById('asp-telemov_alum')?.value?.trim(),
            telehabi_alum: document.getElementById('asp-telehabi_alum')?.value?.trim(),
            correo_alum: document.getElementById('asp-correo_alum')?.value?.trim().toLowerCase().replace(/\s+/g, ''),

            carrera: carrera.value,
            niv_acad_alum: document.getElementById('asp-niv_acad_alum')?.value || 'Bachiller',
            inst_grad_alum: instGrad.value,
            ano_grad_alum: valAno,
            tipo_colegio: document.getElementById('asp-tipo_colegio')?.value || 'Público',
            observaciones: obsEl?.value || 'Preinscripción Web',
            foto_base64: capturedPhotoBase64 || null
        };

        ultimoRegistroAspirante = { ...payload };
        window.ultimoRegistroAspirante = ultimoRegistroAspirante;
        window.capturedPhotoBase64 = capturedPhotoBase64;

        btnSubmit.disabled = true;
        if (spinner) spinner.style.display = 'inline-block';
        if (btnText) btnText.textContent = 'Guardando registro...';

        try {
            const response = await fetch(`${API_BASE}/api/aspirantes/registrar`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const result = await response.json();

            if (response.ok && result.ok) {
                mostrarModalExito(result);
                form.reset();
            } else {
                const errBox = document.getElementById('err-carrera');
                if (errBox) {
                    errBox.textContent = result.error || 'Error en el registro';
                    errBox.classList.add('visible');
                    mostrarAvisoScroll('err-carrera');
                }
            }
        } catch (error) {
            console.error('Error de conexión:', error);
            const errBox = document.getElementById('err-carrera');
            if (errBox) {
                const mensajeExtra = (window.location.protocol === 'file:')
                    ? ' Ha abierto la página como archivo local (file://). Para conectar con el servidor abra http://127.0.0.1:5050 en su navegador.'
                    : ' Verifique que el servidor backend esté en ejecución.';
                errBox.textContent = '❌ Error de comunicación con el servidor:' + mensajeExtra;
                errBox.classList.add('visible');
                mostrarAvisoScroll('err-carrera');
            }
        } finally {
            btnSubmit.disabled = false;
            if (spinner) spinner.style.display = 'none';
            if (btnText) btnText.textContent = 'Confirmar y Enviar Preinscripción';
        }
    });
}

function mostrarModalExito(data) {
    const modal = document.getElementById('modal-exito');
    if (!modal) return;

    const tipoCed = ultimoRegistroAspirante.tipo_cedula || 'V';
    const numCed = Number(data.cedula || ultimoRegistroAspirante.ced_alum || 0).toLocaleString('es-VE');
    const nomCompleto = data.nombres || `${ultimoRegistroAspirante.nom_alum || ''} ${ultimoRegistroAspirante.ape_alum || ''}`.trim();
    const carreraCompleta = MAPA_CARRERAS[ultimoRegistroAspirante.carrera] || data.carrera || ultimoRegistroAspirante.carrera || '';
    const fechaHora = new Date().toLocaleDateString('es-VE', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: true
    });

    // 1. Llenar Comprobante Modal en pantalla (Datos centrados)
    document.getElementById('voucher-folio').textContent = data.folio || 'IUAC-2026-REG';
    document.getElementById('voucher-cedula').textContent = `${tipoCed} - ${numCed}`;
    document.getElementById('voucher-nombre').textContent = nomCompleto;
    document.getElementById('voucher-carrera').textContent = carreraCompleta;
    document.getElementById('voucher-fecha').textContent = fechaHora;

    // 2. Llenar Planilla Oficial de Impresión (Punto 4.5)
    llenarPlanillaImpresion(data, {
        tipoCed, numCed, nomCompleto, carreraCompleta, fechaHora
    });

    modal.classList.add('active');
}

function llenarPlanillaImpresion(data, info) {
    const setTxt = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val || '--';
    };

    setTxt('p-folio', data.folio || 'IUAC-2026-REG');
    setTxt('p-fecha', info.fechaHora);
    setTxt('p-cedula', `${info.tipoCed} - ${info.numCed}`);
    setTxt('p-nacionalidad', ultimoRegistroAspirante.nacionalidad_alum || 'VENEZOLANA');
    setTxt('p-sexo', ultimoRegistroAspirante.sex_alum === 'F' ? 'FEMENINO' : 'MASCULINO');
    setTxt('p-est-civil', ultimoRegistroAspirante.est_civil_alum || 'SOLTERO/A');
    setTxt('p-nombres', ultimoRegistroAspirante.nom_alum);
    setTxt('p-apellidos', ultimoRegistroAspirante.ape_alum);
    setTxt('p-fec-nac', ultimoRegistroAspirante.fec_nac_alum);
    setTxt('p-edad', document.getElementById('asp-edad_alum')?.value || '--');
    setTxt('p-lugar-nac', ultimoRegistroAspirante.lugar_nac_alum || '--');

    setTxt('p-estado', ultimoRegistroAspirante.est_alum);
    setTxt('p-ciudad', ultimoRegistroAspirante.ciu_alum);
    setTxt('p-pais', ultimoRegistroAspirante.pais_alum || 'Venezuela');
    setTxt('p-direccion', ultimoRegistroAspirante.direc_alum);
    setTxt('p-telemov', ultimoRegistroAspirante.telemov_alum);
    setTxt('p-telehab', ultimoRegistroAspirante.telehabi_alum || 'No registrado');
    setTxt('p-correo', ultimoRegistroAspirante.correo_alum);

    setTxt('p-carrera', info.carreraCompleta);
    setTxt('p-nivel', ultimoRegistroAspirante.niv_acad_alum);
    setTxt('p-ano-grad', ultimoRegistroAspirante.ano_grad_alum);
    setTxt('p-tipo-inst', ultimoRegistroAspirante.tipo_colegio);
    setTxt('p-plantel', ultimoRegistroAspirante.inst_grad_alum);
    setTxt('p-firma-ci', `${info.tipoCed} - ${info.numCed}`);
    setTxt('p-qr-ci', `${info.tipoCed} - ${info.numCed}`);
    setTxt('p-qr-folio', data.folio || ultimoRegistroAspirante.folio || 'IUAC-2026-REG');

    // Generar el código QR de la cédula en la parte inferior de la planilla
    const qrCanvas = document.getElementById('planilla-qr-canvas');
    if (qrCanvas && typeof window.dibujarQREnCanvas === 'function') {
        const cedRaw = String(data.cedula || ultimoRegistroAspirante.ced_alum || '').replace(/\D/g, '');
        const qrTexto = `IUAC-2026|CI:${info.tipoCed}-${cedRaw}|FOLIO:${data.folio || 'IUAC-2026'}|CARRERA:${ultimoRegistroAspirante.carrera || ''}|ASPIRANTE:${info.nomCompleto}`;
        window.dibujarQREnCanvas(qrCanvas, qrTexto, 140);
    }

    // Fotografía en la planilla oficial impresa
    const imgPlanilla = document.getElementById('planilla-foto-img');
    const placeholderPlanilla = document.getElementById('planilla-foto-placeholder');
    if (capturedPhotoBase64 && imgPlanilla && placeholderPlanilla) {
        imgPlanilla.src = capturedPhotoBase64;
        imgPlanilla.style.display = 'block';
        placeholderPlanilla.style.display = 'none';
    } else if (imgPlanilla && placeholderPlanilla) {
        imgPlanilla.style.display = 'none';
        placeholderPlanilla.style.display = 'flex';
    }
}

// ── DESCARGAR PLANILLA OFICIAL EN PDF DIRECTO AL DISPOSITIVO (CON QR) ────────
async function imprimirPlanillaOficial() {
    const btn = document.getElementById('btn-imprimir-planilla');
    const txtOriginal = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '⏳ Generando archivo PDF...';
    }
    try {
        if (typeof window.descargarPlanillaPDFOficial === 'function') {
            await window.descargarPlanillaPDFOficial(ultimoRegistroAspirante);
        }
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = txtOriginal || '📥 Descargar Planilla de Pre-Inscripción (PDF)';
        }
    }
}
