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
let capturedRepresDocBase64 = null;
let capturedRepresDocExt = 'jpg';
let capturedAspiranteCedulaBase64 = null;
let capturedAspiranteCedulaExt = 'jpg';
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
    initAspiranteCedulaDocCapture();
    initRepresentanteDocCapture();
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
            <a href="http://127.0.0.1:5050" target="_blank" style="color:var(--t-dark); font-weight:bold; text-decoration:underline;">http://127.0.0.1:5050</a> o desde el móvil a <strong>http://10.40.111.19:5050</strong>.
        `;
        document.body.insertBefore(warningBanner, document.body.firstChild);
    }
}

// ── CAPTURA Y VALIDACIÓN DE FOTOGRAFÍA (2 BOTONES: SUBIR .JPG/.PNG Y ACTIVAR CÁMARA) ──
const TAMANO_MAX_ARCHIVO_FOTO = 5 * 1024 * 1024; // Máximo 5 MB permitidos para archivo .JPG o .PNG
let streamCamaraActiva = null;
let modoLenteCamara = 'user'; // 'user' (frontal/laptop) o 'environment' (trasera móvil)
let callbackCapturaCamara = null;
let capturedPhotoExt = 'jpg';
window.capturedPhotoExt = capturedPhotoExt;

function normalizarTokenNombreJS(texto, fallback) {
    if (!texto || !String(texto).trim()) return fallback;
    const primera = String(texto).trim().split(/\s+/)[0];
    const sinAcentos = primera.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const limpio = sinAcentos.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    return limpio || fallback;
}

function construirNombreFotoPersonalizado(cedStr, nomStr, apeStr, ext = 'jpg') {
    const cedDigits = String(cedStr || '').replace(/\D/g, '') || 'ced_aspirante';
    const primerNom = normalizarTokenNombreJS(nomStr, 'primer_nom');
    const primerApe = normalizarTokenNombreJS(apeStr, 'primer_ape');
    const extClean = (String(ext || 'jpg').toLowerCase().replace('.', '') === 'png') ? 'png' : 'jpg';
    return `${primerNom}_${primerApe}-${cedDigits}.${extClean}`;
}
window.construirNombreFotoPersonalizado = construirNombreFotoPersonalizado;

function detenerStreamCamara() {
    if (streamCamaraActiva) {
        streamCamaraActiva.getTracks().forEach(track => track.stop());
        streamCamaraActiva = null;
    }
    const videoEl = document.getElementById('video-camara-vivo');
    if (videoEl) {
        videoEl.srcObject = null;
    }
}

async function iniciarStreamEnModalCamara() {
    const videoEl = document.getElementById('video-camara-vivo');
    const errCam = document.getElementById('err-camara-vivo');
    if (!videoEl) return false;

    detenerStreamCamara();
    if (errCam) {
        errCam.textContent = '';
        errCam.classList.remove('visible');
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        return false;
    }

    try {
        streamCamaraActiva = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: { ideal: modoLenteCamara },
                width: { ideal: 640 },
                height: { ideal: 800 }
            },
            audio: false
        });
        videoEl.srcObject = streamCamaraActiva;
        videoEl.style.transform = (modoLenteCamara === 'user') ? 'scaleX(-1)' : 'none';
        await videoEl.play().catch(() => { });
        return true;
    } catch (err) {
        // Reintentar con cualquier cámara disponible (ej. webcam USB de PC de escritorio)
        try {
            streamCamaraActiva = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
            videoEl.srcObject = streamCamaraActiva;
            videoEl.style.transform = 'scaleX(-1)';
            await videoEl.play().catch(() => { });
            return true;
        } catch (err2) {
            if (errCam) {
                errCam.textContent = 'No se pudo acceder a la cámara del dispositivo. Verifique los permisos del navegador o utilice el botón "Subir Archivo (.JPG / .PNG)".';
                errCam.classList.add('visible');
            }
            return false;
        }
    }
}

async function abrirVisorCamaraDispositivo(onFotoCapturada, inputFallbackEl) {
    const modalCam = document.getElementById('modal-camara-vivo');
    callbackCapturaCamara = onFotoCapturada;

    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia && modalCam) {
        modalCam.classList.add('active');
        const ok = await iniciarStreamEnModalCamara();
        if (!ok && inputFallbackEl) {
            modalCam.classList.remove('active');
            detenerStreamCamara();
            inputFallbackEl.click();
        }
    } else if (inputFallbackEl) {
        inputFallbackEl.click();
    }
}

function initModalCamaraVivo() {
    const modalCam = document.getElementById('modal-camara-vivo');
    const btnCerrar = document.getElementById('btn-cerrar-camara-vivo');
    const btnCapturar = document.getElementById('btn-capturar-foto-vivo');
    const btnGirar = document.getElementById('btn-cambiar-lente-vivo');
    const videoEl = document.getElementById('video-camara-vivo');

    if (!modalCam) return;

    const cerrarCamara = () => {
        detenerStreamCamara();
        modalCam.classList.remove('active');
    };

    if (btnCerrar) btnCerrar.addEventListener('click', cerrarCamara);
    modalCam.addEventListener('click', (e) => {
        if (e.target === modalCam) cerrarCamara();
    });

    if (btnGirar) {
        btnGirar.addEventListener('click', async () => {
            modoLenteCamara = (modoLenteCamara === 'user') ? 'environment' : 'user';
            await iniciarStreamEnModalCamara();
        });
    }

    if (btnCapturar && videoEl) {
        btnCapturar.addEventListener('click', () => {
            if (!streamCamaraActiva || !videoEl.videoWidth) return;

            const vw = videoEl.videoWidth;
            const vh = videoEl.videoHeight;
            const targetRatio = 320 / 400; // Proporción carnet 4:5
            let cropW = vw;
            let cropH = vh;

            if (vw / vh > targetRatio) {
                cropW = Math.round(vh * targetRatio);
            } else {
                cropH = Math.round(vw / targetRatio);
            }
            const sx = Math.round((vw - cropW) / 2);
            const sy = Math.round((vh - cropH) / 2);

            const canvas = document.createElement('canvas');
            canvas.width = 320;
            canvas.height = 400;
            const ctx = canvas.getContext('2d');

            if (modoLenteCamara === 'user') {
                ctx.translate(320, 0);
                ctx.scale(-1, 1);
            }
            ctx.drawImage(videoEl, sx, sy, cropW, cropH, 0, 0, 320, 400);

            const dataUrl = canvas.toDataURL('image/jpeg', 0.72);
            cerrarCamara();

            if (typeof callbackCapturaCamara === 'function') {
                callbackCapturaCamara(dataUrl);
            }
        });
    }
}

function validarArchivoImagenJpgPng(file, errElement) {
    if (!file) return false;
    const nombre = (file.name || '').toLowerCase();
    const tipo = (file.type || '').toLowerCase();
    const esJpgOPng = tipo === 'image/jpeg' || tipo === 'image/jpg' || tipo === 'image/png' || /\.(jpe?g|png)$/i.test(nombre);

    if (!esJpgOPng) {
        if (errElement) {
            errElement.textContent = '⚠️ Formato no permitido. Solo se admiten archivos .JPG o .PNG.';
            errElement.classList.add('visible');
        }
        return false;
    }

    if (file.size > TAMANO_MAX_ARCHIVO_FOTO) {
        const pesoMB = (file.size / (1024 * 1024)).toFixed(2);
        if (errElement) {
            errElement.textContent = `⚠️ El archivo seleccionado (${pesoMB} MB) excede el tamaño máximo requerido de 5 MB.`;
            errElement.classList.add('visible');
        }
        return false;
    }

    if (errElement) {
        errElement.textContent = '';
        errElement.classList.remove('visible');
    }
    return true;
}

function initPhotoCapture() {
    initModalCamaraVivo();

    const fileInput = document.getElementById('asp-foto_alum');
    const fileInputCamFallback = document.getElementById('asp-foto-camara-fallback');
    const btnSubir = document.getElementById('btn-subir-foto');
    const btnActivarCamara = document.getElementById('btn-activar-camara-principal');
    const btnQuitar = document.getElementById('btn-quitar-foto');
    const imgPreview = document.getElementById('photo-preview-img');
    const iconPlaceholder = document.getElementById('photo-placeholder-icon');
    const errFoto = document.getElementById('err-foto');
    const statusFotoPrincipal = document.getElementById('status-foto-principal');

    if (!fileInput || !btnSubir) return;

    const aplicarFotoEnFormularioPrincipal = async (dataUrlBase64, extFormato = 'jpg') => {
        capturedPhotoBase64 = dataUrlBase64;
        capturedPhotoExt = (extFormato === 'png') ? 'png' : 'jpg';
        window.capturedPhotoBase64 = capturedPhotoBase64;
        window.capturedPhotoExt = capturedPhotoExt;

        if (imgPreview) {
            imgPreview.src = capturedPhotoBase64;
            imgPreview.style.display = 'block';
        }
        if (iconPlaceholder) iconPlaceholder.style.display = 'none';
        if (btnQuitar) btnQuitar.style.display = 'inline-block';
        btnSubir.textContent = '📂 Cambiar Archivo (.JPG / .PNG)';
        if (errFoto) errFoto.classList.remove('visible');

        if (typeof window.actualizarBarraReactivaIUAC === 'function') {
            window.actualizarBarraReactivaIUAC();
        }

        const cedActual = (document.getElementById('asp-ced_alum')?.value || '').replace(/\D/g, '').trim();
        const nomActual = (document.getElementById('asp-nom_alum')?.value || '').trim();
        const apeActual = (document.getElementById('asp-ape_alum')?.value || '').trim();
        const nombreEsperado = construirNombreFotoPersonalizado(cedActual, nomActual, apeActual, capturedPhotoExt);

        if (cedActual && /^\d{8}$/.test(cedActual)) {
            try {
                const res = await fetch(`${API_BASE}/api/aspirantes/actualizar-foto`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        ced_alum: cedActual,
                        nom_alum: nomActual,
                        ape_alum: apeActual,
                        foto_ext: capturedPhotoExt,
                        foto_base64: capturedPhotoBase64
                    })
                });
                const data = await res.json();
                if (res.ok && data.ok && statusFotoPrincipal) {
                    statusFotoPrincipal.textContent = `✓ Guardada en ${data.archivo || ('/fotos_aspirantes/' + nombreEsperado)}`;
                    statusFotoPrincipal.style.display = 'block';
                }
            } catch (_) { }
        } else if (statusFotoPrincipal) {
            statusFotoPrincipal.textContent = `✓ Fotografía lista (/fotos_aspirantes/${nombreEsperado})`;
            statusFotoPrincipal.style.display = 'block';
        }
    };

    const procesarArchivoSeleccionado = (file) => {
        if (!validarArchivoImagenJpgPng(file, errFoto)) {
            fileInput.value = '';
            if (fileInputCamFallback) fileInputCamFallback.value = '';
            return;
        }

        const esPng = (file.type && file.type.toLowerCase() === 'image/png') || /\.png$/i.test(file.name || '');
        const extElegida = esPng ? 'png' : 'jpg';

        btnSubir.textContent = '⏳ Optimizando foto...';
        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = async () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;
                const maxW = 320;
                const maxH = 400;
                if (width > maxW || height > maxH) {
                    const ratio = Math.min(maxW / width, maxH / height);
                    width = Math.round(width * ratio);
                    height = Math.round(height * ratio);
                }
                canvas.width = width;
                canvas.height = height;
                canvas.getContext('2d').drawImage(img, 0, 0, width, height);

                const base64Opt = canvas.toDataURL('image/jpeg', 0.72);
                fileInput.value = '';
                if (fileInputCamFallback) fileInputCamFallback.value = '';
                await aplicarFotoEnFormularioPrincipal(base64Opt, extElegida);
            };
            img.onerror = () => {
                if (errFoto) {
                    errFoto.textContent = 'Error al procesar la imagen seleccionada. Intente con otro archivo .JPG o .PNG.';
                    errFoto.classList.add('visible');
                }
                btnSubir.textContent = '📂 Subir Archivo (.JPG / .PNG)';
                fileInput.value = '';
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    };

    fileInput.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) procesarArchivoSeleccionado(file);
    });

    if (fileInputCamFallback) {
        fileInputCamFallback.addEventListener('change', (e) => {
            const file = e.target.files && e.target.files[0];
            if (file) procesarArchivoSeleccionado(file);
        });
    }

    if (btnActivarCamara) {
        btnActivarCamara.addEventListener('click', () => {
            abrirVisorCamaraDispositivo(aplicarFotoEnFormularioPrincipal, fileInputCamFallback);
        });
    }

    if (btnQuitar) {
        btnQuitar.addEventListener('click', () => {
            fileInput.value = '';
            if (fileInputCamFallback) fileInputCamFallback.value = '';
            capturedPhotoBase64 = null;
            window.capturedPhotoBase64 = null;
            if (imgPreview) {
                imgPreview.src = '';
                imgPreview.style.display = 'none';
            }
            if (iconPlaceholder) iconPlaceholder.style.display = 'block';
            btnQuitar.style.display = 'none';
            btnSubir.textContent = '📂 Subir Archivo (.JPG / .PNG)';
            if (statusFotoPrincipal) statusFotoPrincipal.style.display = 'none';
            if (errFoto) errFoto.classList.remove('visible');
            if (typeof window.actualizarBarraReactivaIUAC === 'function') {
                window.actualizarBarraReactivaIUAC();
            }
        });
    }
}

// ── CAPTURA Y SUBIDA DE CÉDULA DEL ASPIRANTE (OBLIGATORIA PARA TODOS) ───────────
function initAspiranteCedulaDocCapture() {
    const inputDoc = document.getElementById('input-file-cedula-aspirante');
    const btnEscanearDoc = document.getElementById('btn-escanear-cedula-aspirante');
    const btnQuitarDoc = document.getElementById('btn-quitar-cedula-aspirante');
    const previewBox = document.getElementById('preview-cedula-aspirante-box');
    const previewImg = document.getElementById('preview-cedula-aspirante-img');
    const previewPdf = document.getElementById('preview-cedula-aspirante-pdf');
    const statusDoc = document.getElementById('status-cedula-aspirante');
    const errDoc = document.getElementById('err-cedula-aspirante-doc');

    const aplicarDocAspirante = (base64Data, ext = 'jpg') => {
        capturedAspiranteCedulaBase64 = base64Data;
        capturedAspiranteCedulaExt = ext;
        window.capturedAspiranteCedulaBase64 = capturedAspiranteCedulaBase64;
        window.capturedAspiranteCedulaExt = capturedAspiranteCedulaExt;

        if (previewBox) previewBox.style.display = 'block';
        if (ext === 'pdf') {
            if (previewImg) previewImg.style.display = 'none';
            if (previewPdf) previewPdf.style.display = 'flex';
        } else {
            if (previewPdf) previewPdf.style.display = 'none';
            if (previewImg) {
                previewImg.src = base64Data;
                previewImg.style.display = 'block';
            }
        }
        if (btnQuitarDoc) btnQuitarDoc.style.display = 'inline-block';
        if (statusDoc) {
            statusDoc.textContent = '✓ Documento de identidad del aspirante cargado correctamente.';
            statusDoc.style.display = 'block';
        }
        if (errDoc) {
            errDoc.textContent = '';
            errDoc.classList.remove('visible');
        }
    };

    if (inputDoc) {
        inputDoc.addEventListener('change', (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file) return;

            const name = file.name.toLowerCase();
            const esPdf = file.type === 'application/pdf' || name.endsWith('.pdf');
            const esImg = file.type.startsWith('image/') || /\.(jpe?g|png)$/i.test(name);

            if (!esPdf && !esImg) {
                if (errDoc) {
                    errDoc.textContent = 'Formato no permitido. Solo se admiten archivos .JPG, .PNG o .PDF.';
                    errDoc.classList.add('visible');
                }
                inputDoc.value = '';
                return;
            }

            if (file.size > 5 * 1024 * 1024) {
                if (errDoc) {
                    errDoc.textContent = 'El documento excede el tamaño máximo permitido de 5 MB.';
                    errDoc.classList.add('visible');
                }
                inputDoc.value = '';
                return;
            }

            const reader = new FileReader();
            reader.onload = (evt) => {
                const ext = esPdf ? 'pdf' : (name.endsWith('.png') ? 'png' : 'jpg');
                aplicarDocAspirante(evt.target.result, ext);
            };
            reader.readAsDataURL(file);
        });
    }

    if (btnEscanearDoc) {
        btnEscanearDoc.addEventListener('click', () => {
            abrirVisorCamaraDispositivo((b64) => {
                aplicarDocAspirante(b64, 'jpg');
            });
        });
    }

    if (btnQuitarDoc) {
        btnQuitarDoc.addEventListener('click', () => {
            if (inputDoc) inputDoc.value = '';
            capturedAspiranteCedulaBase64 = null;
            window.capturedAspiranteCedulaBase64 = null;
            if (previewImg) {
                previewImg.src = '';
                previewImg.style.display = 'none';
            }
            if (previewPdf) previewPdf.style.display = 'none';
            if (previewBox) previewBox.style.display = 'none';
            btnQuitarDoc.style.display = 'none';
            if (statusDoc) statusDoc.style.display = 'none';
            if (errDoc) errDoc.classList.remove('visible');
        });
    }
}

// ── CAPTURA Y SUBIDA DE CÉDULA DEL REPRESENTANTE (PARA MENORES DE EDAD) ─────
function initRepresentanteDocCapture() {
    const inputDoc = document.getElementById('input-file-repres-cedula');
    const btnEscanearDoc = document.getElementById('btn-escanear-repres-cedula');
    const btnQuitarDoc = document.getElementById('btn-quitar-repres-cedula');
    const previewBox = document.getElementById('preview-repres-cedula-box');
    const previewImg = document.getElementById('preview-repres-cedula-img');
    const previewPdf = document.getElementById('preview-repres-cedula-pdf');
    const statusDoc = document.getElementById('status-repres-cedula');
    const errDoc = document.getElementById('err-repres-cedula-doc');

    const aplicarDocRepresentante = (base64Data, ext = 'jpg') => {
        capturedRepresDocBase64 = base64Data;
        capturedRepresDocExt = ext;
        window.capturedRepresDocBase64 = capturedRepresDocBase64;
        window.capturedRepresDocExt = capturedRepresDocExt;

        if (previewBox) previewBox.style.display = 'block';
        if (ext === 'pdf') {
            if (previewImg) previewImg.style.display = 'none';
            if (previewPdf) previewPdf.style.display = 'flex';
        } else {
            if (previewPdf) previewPdf.style.display = 'none';
            if (previewImg) {
                previewImg.src = base64Data;
                previewImg.style.display = 'block';
            }
        }
        if (btnQuitarDoc) btnQuitarDoc.style.display = 'inline-block';
        if (statusDoc) {
            statusDoc.textContent = '✓ Documento de identidad del representante cargado correctamente';
            statusDoc.style.display = 'block';
        }
        if (errDoc) {
            errDoc.textContent = '';
            errDoc.classList.remove('visible');
        }
    };

    if (inputDoc) {
        inputDoc.addEventListener('change', (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file) return;

            const name = file.name.toLowerCase();
            const esPdf = file.type === 'application/pdf' || name.endsWith('.pdf');
            const esImg = file.type.startsWith('image/') || /\.(jpe?g|png)$/i.test(name);

            if (!esPdf && !esImg) {
                if (errDoc) {
                    errDoc.textContent = 'Formato no permitido. Solo se admiten archivos .JPG, .PNG o .PDF.';
                    errDoc.classList.add('visible');
                }
                inputDoc.value = '';
                return;
            }

            if (file.size > 8 * 1024 * 1024) {
                if (errDoc) {
                    errDoc.textContent = 'El archivo excede el tamaño máximo permitido de 8 MB.';
                    errDoc.classList.add('visible');
                }
                inputDoc.value = '';
                return;
            }

            const reader = new FileReader();
            reader.onload = (evt) => {
                const ext = esPdf ? 'pdf' : (name.endsWith('.png') ? 'png' : 'jpg');
                aplicarDocRepresentante(evt.target.result, ext);
            };
            reader.readAsDataURL(file);
        });
    }

    if (btnEscanearDoc) {
        btnEscanearDoc.addEventListener('click', () => {
            abrirVisorCamaraDispositivo((b64) => {
                aplicarDocRepresentante(b64, 'jpg');
            });
        });
    }

    if (btnQuitarDoc) {
        btnQuitarDoc.addEventListener('click', () => {
            if (inputDoc) inputDoc.value = '';
            capturedRepresDocBase64 = null;
            window.capturedRepresDocBase64 = null;
            if (previewImg) {
                previewImg.src = '';
                previewImg.style.display = 'none';
            }
            if (previewPdf) previewPdf.style.display = 'none';
            if (previewBox) previewBox.style.display = 'none';
            btnQuitarDoc.style.display = 'none';
            if (statusDoc) statusDoc.style.display = 'none';
            if (errDoc) errDoc.classList.remove('visible');
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

    // Evaluar y resaltar en verde los campos válidos del paso activo
    if (typeof evaluarCamposPasoActual === 'function') {
        evaluarCamposPasoActual(step);
    }

    const card = document.querySelector('.form-card');
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── 4. CARGA DINÁMICA DE ESTADOS Y CIUDADES ──────────────────────────────────
function initGeoSelectors() {
    const estadoSelect = document.getElementById('asp-est_alum');
    const ciudadSelect = document.getElementById('asp-ciu_alum');
    const lugarNacSelect = document.getElementById('asp-lugar_nac_alum');

    const estados = Object.keys(window.VENEZUELA_GEO || {}).sort();

    // 4.1 Poblar Combobox de Lugar de Nacimiento (24 Entidades + Dep. Federales + Exterior)
    if (lugarNacSelect) {
        lugarNacSelect.innerHTML = '<option value="">Seleccione un Estado...</option>';
        estados.forEach(est => {
            const opt = document.createElement('option');
            opt.value = est;
            opt.textContent = est;
            lugarNacSelect.appendChild(opt);
        });
        const optDep = document.createElement('option');
        optDep.value = 'Dependencias Federales';
        optDep.textContent = 'Dependencias Federales';
        lugarNacSelect.appendChild(optDep);

        const optExt = document.createElement('option');
        optExt.value = 'En el Exterior';
        optExt.textContent = 'En el Exterior';
        lugarNacSelect.appendChild(optExt);

        lugarNacSelect.addEventListener('change', () => {
            if (lugarNacSelect.value) {
                setFieldValid(lugarNacSelect, 'err-lugar_nac');
            } else {
                setFieldInvalid(lugarNacSelect, 'err-lugar_nac', 'Lugar de nacimiento obligatorio.');
            }
        });
    }

    if (!estadoSelect || !ciudadSelect) return;

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
    const btnCamaraRec = document.getElementById('btn-activar-camara-recuperar');
    const statusFotoRec = document.getElementById('status-recuperar-foto');
    const errFotoRec = document.getElementById('err-recuperar-foto');
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

    const aplicarFotoEnModalRecuperacion = async (base64Img, extFormato = 'jpg') => {
        fotoRecuperacionBase64 = base64Img;
        capturedPhotoBase64 = fotoRecuperacionBase64;
        capturedPhotoExt = (extFormato === 'png') ? 'png' : 'jpg';
        window.capturedPhotoBase64 = fotoRecuperacionBase64;
        window.capturedPhotoExt = capturedPhotoExt;

        const previewBox = document.getElementById('preview-recuperar-foto-box');
        const previewImg = document.getElementById('preview-recuperar-foto-img');
        if (previewBox && previewImg) {
            previewImg.src = fotoRecuperacionBase64;
            previewBox.style.display = 'block';
        }
        if (btnSubirFotoRec) {
            btnSubirFotoRec.textContent = '📂 Cambiar Archivo (.JPG / .PNG)';
        }
        if (errFotoRec) {
            errFotoRec.textContent = '';
            errFotoRec.classList.remove('visible');
        }

        const cedVal = (inputCed?.value || '').replace(/\D/g, '').trim();
        if (cedVal && /^\d{8}$/.test(cedVal)) {
            try {
                const res = await fetch(`${API_BASE}/api/aspirantes/actualizar-foto`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        ced_alum: cedVal,
                        foto_ext: capturedPhotoExt,
                        foto_base64: fotoRecuperacionBase64
                    })
                });
                const data = await res.json();
                if (statusFotoRec) {
                    statusFotoRec.textContent = (res.ok && data.ok)
                        ? `✓ Fotografía alojada en ${data.archivo || ('/fotos_aspirantes/aspirante-' + cedVal + '.' + capturedPhotoExt)} y guardada en la BD.`
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
            statusFotoRec.textContent = '✓ Fotografía lista. Ingrese su cédula arriba y presione Descargar.';
            statusFotoRec.style.display = 'block';
        }
    };

    if (btnSubirFotoRec && inputFotoRec) {
        if (btnSubirFotoRec.tagName !== 'LABEL') {
            btnSubirFotoRec.addEventListener('click', () => inputFotoRec.click());
        }
        inputFotoRec.addEventListener('change', (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file) return;
            if (!validarArchivoImagenJpgPng(file, errFotoRec)) {
                inputFotoRec.value = '';
                return;
            }
            const esPng = (file.type && file.type.toLowerCase() === 'image/png') || /\.png$/i.test(file.name || '');
            const extElegida = esPng ? 'png' : 'jpg';

            btnSubirFotoRec.textContent = '⏳ Optimizando foto...';
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
                    const b64 = canvas.toDataURL('image/jpeg', 0.72);
                    inputFotoRec.value = '';
                    await aplicarFotoEnModalRecuperacion(b64, extElegida);
                };
                img.src = ev.target.result;
            };
            reader.readAsDataURL(file);
        });
    }

    if (btnCamaraRec) {
        btnCamaraRec.addEventListener('click', () => {
            abrirVisorCamaraDispositivo(
                aplicarFotoEnModalRecuperacion,
                document.getElementById('asp-foto-camara-fallback')
            );
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
            if (!ced || !/^\d{8}$/.test(ced)) {
                if (errBox) {
                    errBox.textContent = 'Por favor ingrese un número de cédula válido de 8 dígitos numéricos (solo dígitos, ej: 30123456).';
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
                        body: JSON.stringify({
                            ced_alum: ced,
                            foto_ext: capturedPhotoExt || 'jpg',
                            foto_base64: fotoRecuperacionBase64
                        })
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
    input.classList.remove('field-error-highlight');
    if (errId) {
        const errBox = document.getElementById(errId);
        if (errBox) {
            errBox.textContent = '';
            errBox.classList.remove('visible');
        }
    }
    // Si no quedan campos con is-invalid en el paso activo, ocultar alerta
    const activePane = document.querySelector('.step-pane.active');
    if (activePane && !activePane.querySelector('.is-invalid')) {
        limpiarAvisoErrorPaso();
    }
}

function setFieldInvalid(input, errId, message) {
    if (!input) return;
    input.classList.remove('is-valid');
    input.classList.add('is-invalid');
    if (errId) {
        const errBox = document.getElementById(errId);
        if (errBox) {
            errBox.textContent = message;
            errBox.classList.add('visible');
        }
    }
}

function mostrarAvisoScroll(elementId) {
    const el = document.getElementById(elementId);
    if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (el.focus && typeof el.focus === 'function') el.focus();
    }
}

function mostrarErrorDePaso(el, stepNum, stepName, fieldLabel, message) {
    if (!el) return;

    // 1. Navegar a la pestaña/paso donde ocurre el error si no estamos en ella
    if (currentStep !== stepNum) {
        goToStep(stepNum);
    }

    // 2. Marcar visualmente la pestaña en el Stepper con indicador de error
    document.querySelectorAll('.step-node').forEach(node => {
        const s = parseInt(node.getAttribute('data-step'), 10);
        if (s === stepNum) {
            node.classList.add('has-error');
        } else {
            node.classList.remove('has-error');
        }
    });

    // 3. Activar y actualizar el banner informativo de error por paso
    const alertBox = document.getElementById('step-error-alert');
    const alertTitle = document.getElementById('step-error-alert-title');
    const alertText = document.getElementById('step-error-alert-text');
    if (alertBox && alertTitle && alertText) {
        alertTitle.innerHTML = `⚠️ Error en <strong>${stepName}</strong>`;
        alertText.innerHTML = `Por favor complete o corrija el campo <strong>"${fieldLabel}"</strong>: ${message}`;
        alertBox.style.display = 'flex';
    }

    // 4. Desplazar la pantalla suavemente y centrar el campo con error
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('field-error-highlight');
    setTimeout(() => {
        el.classList.remove('field-error-highlight');
    }, 3000);

    setTimeout(() => {
        if (el.focus && typeof el.focus === 'function') {
            try { el.focus(); } catch (err) {}
        }
    }, 250);
}

function limpiarAvisoErrorPaso() {
    const alertBox = document.getElementById('step-error-alert');
    if (alertBox) alertBox.style.display = 'none';
    document.querySelectorAll('.step-node').forEach(node => {
        node.classList.remove('has-error');
    });
}

// ── 7. VALIDACIONES EN TIEMPO REAL PARA TODOS LOS CAMPOS ─────────────────────
let cedulaDisponible = false;
let checkCedulaTimeout = null;

const REGEX_LETRAS_Y_ESPACIOS = /^[a-zA-ZáéíóúÁÉÍÓÚñÑüÜ\s\.]+$/;
const REGEX_EMAIL = /^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$/;
const PREFIJOS_MOVILES = ['0412', '0414', '0424', '0416', '0426'];

function evaluarCampoEnTiempoReal(el, forzarError = false) {
    if (!el || !el.id) return true;
    const id = el.id;

    if (id === 'asp-ced_alum') {
        const val = el.value.trim();
        if (!val) {
            if (forzarError) setFieldInvalid(el, 'err-cedula', 'El número de cédula es obligatorio.');
            return false;
        }
        if (val.length < 8) {
            if (forzarError || val.length > 0) setFieldInvalid(el, 'err-cedula', 'La cédula debe contener exactamente 8 dígitos (solo números).');
            return false;
        }
        if (cedulaDisponible) {
            setFieldValid(el, 'err-cedula');
            return true;
        }
        return false;
    }

    if (id === 'asp-tipo_cedula') {
        if (el.value) { setFieldValid(el); return true; }
        return false;
    }

    if (id === 'asp-nom_alum') {
        el.value = el.value.replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑüÜ\s]/g, '')
            .replace(/^\s+/, '')
            .replace(/\s{2,}/g, ' ');
        const val = el.value.trim();
        if (!val) {
            if (forzarError) setFieldInvalid(el, 'err-nombres', 'El campo Nombres es obligatorio.');
            return false;
        }
        if (val.length < 2) {
            if (forzarError) setFieldInvalid(el, 'err-nombres', 'Mínimo 2 letras.');
            return false;
        }
        if (!REGEX_LETRAS_Y_ESPACIOS.test(val)) {
            setFieldInvalid(el, 'err-nombres', 'Solo se permiten letras y espacios.');
            return false;
        }
        setFieldValid(el, 'err-nombres');
        return true;
    }

    if (id === 'asp-ape_alum') {
        el.value = el.value.replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑüÜ\s]/g, '')
            .replace(/^\s+/, '')
            .replace(/\s{2,}/g, ' ');
        const val = el.value.trim();
        if (!val) {
            if (forzarError) setFieldInvalid(el, 'err-apellidos', 'El campo Apellidos es obligatorio.');
            return false;
        }
        if (val.length < 2) {
            if (forzarError) setFieldInvalid(el, 'err-apellidos', 'Mínimo 2 letras.');
            return false;
        }
        if (!REGEX_LETRAS_Y_ESPACIOS.test(val)) {
            setFieldInvalid(el, 'err-apellidos', 'Solo se permiten letras y espacios.');
            return false;
        }
        setFieldValid(el, 'err-apellidos');
        return true;
    }

    if (id === 'asp-fec_nac_alum') {
        const val = el.value;
        const edadInput = document.getElementById('asp-edad_alum');
        if (!val) {
            if (forzarError) setFieldInvalid(el, 'err-fec_nac', 'La fecha de nacimiento es obligatoria.');
            if (edadInput) { edadInput.value = ''; edadInput.classList.remove('is-valid'); }
            return false;
        }
        const res = validarEdadReglamentariaIUAC(val);
        if (edadInput && res.edadActual !== null) {
            edadInput.value = res.edadActual;
        }
        const seccionMenor = document.getElementById('seccion-representante-menor');
        if (seccionMenor) {
            seccionMenor.style.display = (res.edadActual !== null && res.edadActual < 18) ? 'block' : 'none';
        }
        if (!res.valido) {
            setFieldInvalid(el, 'err-fec_nac', res.error);
            if (edadInput) edadInput.classList.remove('is-valid');
            bloquearFormularioPorEdad(res.error);
            return false;
        }
        setFieldValid(el, 'err-fec_nac');
        if (edadInput) setFieldValid(edadInput);
        desbloquearFormularioPorEdad();
        return true;
    }

    if (id === 'asp-edad_alum') {
        const val = parseInt(el.value || '0', 10);
        if (val >= 15 && val <= 40) {
            setFieldValid(el);
            return true;
        }
        return false;
    }

    if (id === 'asp-sex_alum') {
        if (el.value === 'M' || el.value === 'F') {
            setFieldValid(el, 'err-sexo');
            return true;
        }
        if (forzarError) setFieldInvalid(el, 'err-sexo', 'Seleccione un género.');
        return false;
    }

    if (id === 'asp-est_civil_alum') {
        if (el.value) {
            setFieldValid(el, 'err-est_civil');
            return true;
        }
        if (forzarError) setFieldInvalid(el, 'err-est_civil', 'Seleccione su estado civil.');
        return false;
    }

    if (id === 'asp-lugar_nac_alum') {
        const val = el.value.trim();
        if (val) {
            setFieldValid(el, 'err-lugar_nac');
            return true;
        }
        if (forzarError) setFieldInvalid(el, 'err-lugar_nac', 'El lugar de nacimiento es obligatorio.');
        return false;
    }

    if (id === 'asp-nacionalidad_alum') {
        if (el.value && el.value.trim()) {
            setFieldValid(el);
            return true;
        }
        return false;
    }

    if (id === 'asp-pais_alum') {
        if (el.value && el.value.trim()) {
            setFieldValid(el);
            return true;
        }
        return false;
    }

    if (id === 'asp-est_alum') {
        if (el.value) {
            setFieldValid(el, 'err-estado');
            return true;
        }
        if (forzarError) setFieldInvalid(el, 'err-estado', 'Seleccione un Estado.');
        return false;
    }

    if (id === 'asp-ciu_alum') {
        if (el.value) {
            setFieldValid(el, 'err-ciudad');
            return true;
        }
        if (forzarError) setFieldInvalid(el, 'err-ciudad', 'Seleccione una Ciudad.');
        return false;
    }

    if (id === 'asp-direc_alum') {
        el.value = el.value.replace(/^\s+/, '').replace(/[ 	]{2,}/g, ' ');
        const val = el.value.trim();
        if (!val) {
            if (forzarError) setFieldInvalid(el, 'err-direccion', 'La dirección de habitación es obligatoria.');
            return false;
        }
        if (val.length < 8) {
            if (forzarError) setFieldInvalid(el, 'err-direccion', 'Por favor detalle su dirección completa (mínimo 8 caracteres).');
            return false;
        }
        setFieldValid(el, 'err-direccion');
        return true;
    }

    if (id === 'asp-telemov_alum') {
        const digits = el.value.replace(/\D/g, '');
        if (!digits) {
            if (forzarError) setFieldInvalid(el, 'err-telemov', 'El teléfono celular es obligatorio.');
            return false;
        }
        if (digits.length !== 11) {
            if (forzarError) setFieldInvalid(el, 'err-telemov', 'Debe contener 11 dígitos (ej: 0412-1234567).');
            return false;
        }
        const prefix = digits.slice(0, 4);
        if (!PREFIJOS_MOVILES.includes(prefix)) {
            setFieldInvalid(el, 'err-telemov', `Prefijo '${prefix}' no válido. Use 0412, 0414, 0424, 0416 o 0426.`);
            return false;
        }
        setFieldValid(el, 'err-telemov');
        return true;
    }

    if (id === 'asp-telehabi_alum') {
        const val = el.value.trim();
        if (!val) {
            setFieldValid(el, 'err-telehab');
            return true;
        }
        const digits = val.replace(/\D/g, '');
        if (digits.length < 10 || digits.length > 11) {
            if (forzarError) setFieldInvalid(el, 'err-telehab', 'Teléfono no válido (debe contener 10 u 11 dígitos).');
            return false;
        }
        setFieldValid(el, 'err-telehab');
        return true;
    }

    if (id === 'asp-correo_alum') {
        el.value = el.value.replace(/\s+/g, '').toLowerCase();
        const val = el.value.trim();
        if (!val) {
            if (forzarError) setFieldInvalid(el, 'err-correo', 'El correo electrónico es obligatorio.');
            return false;
        }
        if (!REGEX_EMAIL.test(val)) {
            if (forzarError) setFieldInvalid(el, 'err-correo', 'Formato de correo no válido (ej: aspirante@correo.com).');
            return false;
        }
        setFieldValid(el, 'err-correo');
        return true;
    }

    if (id === 'asp-carrera') {
        if (el.value) {
            setFieldValid(el, 'err-carrera');
            return true;
        }
        if (forzarError) setFieldInvalid(el, 'err-carrera', 'Debe seleccionar una carrera de postulación.');
        return false;
    }

    if (id === 'asp-niv_acad_alum') {
        if (el.value) { setFieldValid(el); return true; }
        return false;
    }

    if (id === 'asp-ano_grad_alum') {
        const val = parseInt(el.value || '0', 10);
        const maxYear = new Date().getFullYear() + 1;
        if (!val || val < 1990 || val > maxYear) {
            if (forzarError) setFieldInvalid(el, 'err-ano_grad', `Año válido entre 1990 y ${maxYear}.`);
            return false;
        }
        setFieldValid(el, 'err-ano_grad');
        return true;
    }

    if (id === 'asp-inst_grad_alum') {
        el.value = el.value.replace(/^\s+/, '').replace(/\s{2,}/g, ' ');
        const val = el.value.trim();
        if (!val) {
            if (forzarError) setFieldInvalid(el, 'err-inst_grad', 'Indique la institución de egreso.');
            return false;
        }
        setFieldValid(el, 'err-inst_grad');
        return true;
    }

    if (id === 'asp-tipo_colegio') {
        if (el.value) { setFieldValid(el); return true; }
        return false;
    }

    if (id === 'asp-observaciones') {
        el.value = el.value.replace(/^\s+/, '').replace(/[ 	]{2,}/g, ' ');
        const val = el.value.trim();
        if (!val || val.length < 2) {
            if (forzarError) setFieldInvalid(el, 'err-observaciones', 'Observaciones obligatorias (escriba "Ninguna" si no posee observaciones adicionales).');
            return false;
        }
        setFieldValid(el, 'err-observaciones');
        return true;
    }

    return true;
}

function evaluarCamposPasoActual(step) {
    const pane = document.getElementById(`step-pane-${step}`);
    if (!pane) return;
    const inputs = pane.querySelectorAll('input, select, textarea');
    inputs.forEach(input => {
        if (input.value && String(input.value).trim().length > 0) {
            evaluarCampoEnTiempoReal(input, false);
        }
    });
}

function initRealtimeValidations() {
    const cedulaInput = document.getElementById('asp-ced_alum');
    const nombresInput = document.getElementById('asp-nom_alum');
    const apellidosInput = document.getElementById('asp-ape_alum');
    const fecNacInput = document.getElementById('asp-fec_nac_alum');
    const lugarNacInput = document.getElementById('asp-lugar_nac_alum');
    const sexInput = document.getElementById('asp-sex_alum');
    const estCivilInput = document.getElementById('asp-est_civil_alum');
    const telemovInput = document.getElementById('asp-telemov_alum');
    const telehabInput = document.getElementById('asp-telehabi_alum');
    const correoInput = document.getElementById('asp-correo_alum');
    const direcInput = document.getElementById('asp-direc_alum');
    const carreraSelect = document.getElementById('asp-carrera');
    const anoGradInput = document.getElementById('asp-ano_grad_alum');
    const instGradInput = document.getElementById('asp-inst_grad_alum');
    const tipoCedulaSelect = document.getElementById('asp-tipo_cedula');
    const nacInput = document.getElementById('asp-nacionalidad_alum');
    const paisInput = document.getElementById('asp-pais_alum');
    const nivAcadSelect = document.getElementById('asp-niv_acad_alum');
    const tipoColegioSelect = document.getElementById('asp-tipo_colegio');
    const obsInput = document.getElementById('asp-observaciones');

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
            } else if (val.length < 8) {
                setFieldInvalid(cedulaInput, 'err-cedula', 'La cédula debe contener exactamente 8 dígitos (solo números).');
                statusLabel.innerHTML = '';
                cedulaDisponible = false;
                desbloquearFormularioPorCedulaRegistrada();
            } else {
                setFieldValid(cedulaInput, 'err-cedula');
                statusLabel.innerHTML = '<span style="color:var(--t-dark); font-size:0.75rem;">⏳ Comprobando disponibilidad...</span>';
                checkCedulaTimeout = setTimeout(() => verificarCedulaRemota(val), 350);
            }
        });
        cedulaInput.addEventListener('blur', (e) => {
            e.target.value = e.target.value.trim();
            evaluarCampoEnTiempoReal(cedulaInput, false);
        });
    }

    // 2. Nombres
    if (nombresInput) {
        nombresInput.addEventListener('input', () => {
            evaluarCampoEnTiempoReal(nombresInput, false);
        });
        nombresInput.addEventListener('blur', () => {
            evaluarCampoEnTiempoReal(nombresInput, false);
        });
    }

    // 3. Apellidos
    if (apellidosInput) {
        apellidosInput.addEventListener('input', () => {
            evaluarCampoEnTiempoReal(apellidosInput, false);
        });
        apellidosInput.addEventListener('blur', () => {
            evaluarCampoEnTiempoReal(apellidosInput, false);
        });
    }

    // 4. Fecha de Nacimiento y Bloqueo Reglamentario de Edad
    if (fecNacInput) {
        fecNacInput.addEventListener('change', () => {
            evaluarCampoEnTiempoReal(fecNacInput, false);
        });
        fecNacInput.addEventListener('blur', () => {
            evaluarCampoEnTiempoReal(fecNacInput, false);
        });
    }

    // 5. Selectores de Género y Estado Civil
    if (sexInput) {
        sexInput.addEventListener('change', () => evaluarCampoEnTiempoReal(sexInput, false));
        sexInput.addEventListener('blur', () => evaluarCampoEnTiempoReal(sexInput, false));
    }
    if (estCivilInput) {
        estCivilInput.addEventListener('change', () => evaluarCampoEnTiempoReal(estCivilInput, false));
        estCivilInput.addEventListener('blur', () => evaluarCampoEnTiempoReal(estCivilInput, false));
    }

    // 6. Lugar de Nacimiento
    if (lugarNacInput) {
        lugarNacInput.addEventListener('change', () => evaluarCampoEnTiempoReal(lugarNacInput, false));
        lugarNacInput.addEventListener('blur', () => evaluarCampoEnTiempoReal(lugarNacInput, false));
    }

    // 7. Teléfono Celular
    if (telemovInput) {
        telemovInput.addEventListener('input', (e) => {
            let digits = e.target.value.replace(/\D/g, '').slice(0, 11);
            if (digits.length > 4) {
                e.target.value = `${digits.slice(0, 4)}-${digits.slice(4)}`;
            } else {
                e.target.value = digits;
            }
            evaluarCampoEnTiempoReal(telemovInput, false);
        });
        telemovInput.addEventListener('blur', () => {
            telemovInput.value = telemovInput.value.trim();
            evaluarCampoEnTiempoReal(telemovInput, false);
        });
    }

    // 8. Teléfono Habitación (Opcional)
    if (telehabInput) {
        telehabInput.addEventListener('input', (e) => {
            let digits = e.target.value.replace(/\D/g, '').slice(0, 11);
            if (digits.length > 4) {
                e.target.value = `${digits.slice(0, 4)}-${digits.slice(4)}`;
            } else {
                e.target.value = digits;
            }
            evaluarCampoEnTiempoReal(telehabInput, false);
        });
        telehabInput.addEventListener('blur', () => {
            telehabInput.value = telehabInput.value.trim();
            evaluarCampoEnTiempoReal(telehabInput, false);
        });
    }

    // 9. Correo Electrónico
    if (correoInput) {
        correoInput.addEventListener('input', () => {
            evaluarCampoEnTiempoReal(correoInput, false);
        });
        correoInput.addEventListener('blur', () => {
            evaluarCampoEnTiempoReal(correoInput, false);
        });
    }

    // 10. Dirección
    if (direcInput) {
        direcInput.addEventListener('input', () => {
            evaluarCampoEnTiempoReal(direcInput, false);
        });
        direcInput.addEventListener('blur', () => {
            evaluarCampoEnTiempoReal(direcInput, false);
        });
    }

    // 11. Carrera
    if (carreraSelect) {
        carreraSelect.addEventListener('change', () => evaluarCampoEnTiempoReal(carreraSelect, false));
        carreraSelect.addEventListener('blur', () => evaluarCampoEnTiempoReal(carreraSelect, false));
    }

    // 12. Año de Graduación
    if (anoGradInput) {
        anoGradInput.addEventListener('input', (e) => {
            e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4);
            evaluarCampoEnTiempoReal(anoGradInput, false);
        });
        anoGradInput.addEventListener('blur', () => {
            anoGradInput.value = anoGradInput.value.trim();
            evaluarCampoEnTiempoReal(anoGradInput, false);
        });
    }

    // 13. Plantel de Egreso
    if (instGradInput) {
        instGradInput.addEventListener('input', () => {
            evaluarCampoEnTiempoReal(instGradInput, false);
        });
        instGradInput.addEventListener('blur', () => {
            evaluarCampoEnTiempoReal(instGradInput, false);
        });
    }

    // 14. Observaciones
    if (obsInput) {
        obsInput.addEventListener('input', () => {
            evaluarCampoEnTiempoReal(obsInput, false);
        });
        obsInput.addEventListener('blur', () => {
            evaluarCampoEnTiempoReal(obsInput, false);
        });
    }

    // 15. Pre-evaluar campos iniciales con valor por defecto
    setTimeout(() => {
        evaluarCamposPasoActual(1);
    }, 200);
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
        } else {
            cedulaDisponible = false;
            setFieldInvalid(input, 'err-cedula', data.error || 'La cédula debe contener exactamente 8 dígitos numéricos.');
            statusLabel.innerHTML = '';
        }
    } catch (e) {
        cedulaDisponible = true;
        desbloquearFormularioPorCedulaRegistrada();
        statusLabel.innerHTML = '';
    }
}

// ── 8. VALIDACIÓN POR PASOS CON UBICACIÓN EXACTA DE ERRORES ──────────────────
function validateCurrentStep(step) {
    limpiarAvisoErrorPaso();

    if (step === 1) {
        const cedula = document.getElementById('asp-ced_alum');
        const nombres = document.getElementById('asp-nom_alum');
        const apellidos = document.getElementById('asp-ape_alum');
        const fecNac = document.getElementById('asp-fec_nac_alum');
        const edadInput = document.getElementById('asp-edad_alum');
        const sexInput = document.getElementById('asp-sex_alum');
        const estCivilInput = document.getElementById('asp-est_civil_alum');
        const lugarNac = document.getElementById('asp-lugar_nac_alum');
        const nacInput = document.getElementById('asp-nacionalidad_alum');

        // Cédula
        const valCed = (cedula?.value || '').trim();
        if (!valCed || valCed.length !== 8 || !/^\d{8}$/.test(valCed)) {
            setFieldInvalid(cedula, 'err-cedula', 'Cédula obligatoria de exactamente 8 dígitos numéricos.');
            mostrarErrorDePaso(cedula, 1, 'Paso 1: Datos Personales e Identificación', 'Cédula de Identidad', 'La cédula debe contener exactamente 8 dígitos numéricos.');
            return false;
        }

        // Nombres
        const valNom = (nombres?.value || '').trim().replace(/\s{2,}/g, ' ');
        if (nombres) nombres.value = valNom;
        if (!valNom || valNom.length < 2 || !REGEX_LETRAS_Y_ESPACIOS.test(valNom)) {
            setFieldInvalid(nombres, 'err-nombres', 'Nombres obligatorios (solo letras y espacios, mín. 2 caracteres).');
            mostrarErrorDePaso(nombres, 1, 'Paso 1: Datos Personales e Identificación', 'Nombres Completos', 'Ingrese sus nombres completos sin números ni caracteres especiales.');
            return false;
        }
        setFieldValid(nombres, 'err-nombres');

        // Apellidos
        const valApe = (apellidos?.value || '').trim().replace(/\s{2,}/g, ' ');
        if (apellidos) apellidos.value = valApe;
        if (!valApe || valApe.length < 2 || !REGEX_LETRAS_Y_ESPACIOS.test(valApe)) {
            setFieldInvalid(apellidos, 'err-apellidos', 'Apellidos obligatorios (solo letras y espacios, mín. 2 caracteres).');
            mostrarErrorDePaso(apellidos, 1, 'Paso 1: Datos Personales e Identificación', 'Apellidos Completos', 'Ingrese sus apellidos completos sin números ni caracteres especiales.');
            return false;
        }
        setFieldValid(apellidos, 'err-apellidos');

        // Fecha de Nacimiento y Validación de Edad
        if (!fecNac || !fecNac.value) {
            setFieldInvalid(fecNac, 'err-fec_nac', 'La fecha de nacimiento es obligatoria.');
            mostrarErrorDePaso(fecNac, 1, 'Paso 1: Datos Personales e Identificación', 'Fecha de Nacimiento', 'Debe indicar su fecha de nacimiento.');
            return false;
        }
        const checkEdad = validarEdadReglamentariaIUAC(fecNac.value);
        if (!checkEdad.valido) {
            setFieldInvalid(fecNac, 'err-fec_nac', checkEdad.error);
            bloquearFormularioPorEdad(checkEdad.error);
            mostrarErrorDePaso(fecNac, 1, 'Paso 1: Datos Personales e Identificación', 'Fecha de Nacimiento', checkEdad.error);
            return false;
        }
        setFieldValid(fecNac, 'err-fec_nac');
        if (edadInput) {
            edadInput.value = checkEdad.edadActual;
            setFieldValid(edadInput);
        }

        // Género
        if (!sexInput || !sexInput.value) {
            setFieldInvalid(sexInput, 'err-sexo', 'Seleccione un género.');
            mostrarErrorDePaso(sexInput, 1, 'Paso 1: Datos Personales e Identificación', 'Género', 'Debe seleccionar un género.');
            return false;
        }
        setFieldValid(sexInput, 'err-sexo');

        // Estado Civil
        if (!estCivilInput || !estCivilInput.value) {
            setFieldInvalid(estCivilInput, 'err-est_civil', 'Seleccione su estado civil.');
            mostrarErrorDePaso(estCivilInput, 1, 'Paso 1: Datos Personales e Identificación', 'Estado Civil', 'Debe seleccionar su estado civil.');
            return false;
        }
        setFieldValid(estCivilInput, 'err-est_civil');

        // Lugar de Nacimiento
        const valLugar = (lugarNac?.value || '').trim();
        if (!valLugar) {
            setFieldInvalid(lugarNac, 'err-lugar_nac', 'Lugar de nacimiento obligatorio.');
            mostrarErrorDePaso(lugarNac, 1, 'Paso 1: Datos Personales e Identificación', 'Lugar de Nacimiento', 'Debe seleccionar un Estado de la República o "En el Exterior".');
            return false;
        }
        setFieldValid(lugarNac, 'err-lugar_nac');

        if (nacInput) setFieldValid(nacInput);

        // Fotografía Carnet (100% Obligatoria)
        if (!capturedPhotoBase64) {
            const errFoto = document.getElementById('err-foto');
            if (errFoto) {
                errFoto.textContent = 'La fotografía tipo carnet es obligatoria. Por favor suba un archivo o active su cámara.';
                errFoto.classList.add('visible');
            }
            const btnFoto = document.getElementById('btn-subir-foto') || document.querySelector('.photo-capture-card');
            mostrarErrorDePaso(btnFoto, 1, 'Paso 1: Datos Personales e Identificación', 'Fotografía Carnet', 'Debe subir un archivo o capturar su fotografía tipo carnet.');
            return false;
        }

        // Documento de Identidad del Aspirante (100% Obligatorio para todos)
        if (!capturedAspiranteCedulaBase64) {
            const errCedDoc = document.getElementById('err-cedula-aspirante-doc');
            if (errCedDoc) {
                errCedDoc.textContent = 'Es obligatorio adjuntar o escanear la fotografía/documento de su cédula de identidad.';
                errCedDoc.classList.add('visible');
            }
            const btnCedDoc = document.getElementById('btn-subir-cedula-aspirante') || document.getElementById('seccion-cedula-aspirante');
            mostrarErrorDePaso(btnCedDoc, 1, 'Paso 1: Datos Personales e Identificación', 'Documento de Identidad (Cédula)', 'Es obligatorio adjuntar o escanear su cédula de identidad (.JPG, .PNG o .PDF).');
            return false;
        }

        // Menor de 18 años: Representante legal
        const edadVal = parseInt(edadInput?.value || '99', 10);
        if (edadVal < 18) {
            if (!capturedRepresDocBase64) {
                const errDoc = document.getElementById('err-repres-cedula-doc');
                if (errDoc) {
                    errDoc.textContent = 'Por ser menor de edad, es obligatorio adjuntar o escanear la cédula de su representante legal.';
                    errDoc.classList.add('visible');
                }
                const btnRep = document.getElementById('btn-subir-repres-cedula') || document.getElementById('seccion-representante-menor');
                mostrarErrorDePaso(btnRep, 1, 'Paso 1: Datos Personales e Identificación', 'Cédula del Representante Legal', 'Por ser menor de edad, debe adjuntar la cédula de su representante legal.');
                return false;
            }
        }

    } else if (step === 2) {
        const paisInput = document.getElementById('asp-pais_alum');
        const estado = document.getElementById('asp-est_alum');
        const ciudad = document.getElementById('asp-ciu_alum');
        const direccion = document.getElementById('asp-direc_alum');
        const telemov = document.getElementById('asp-telemov_alum');
        const telehab = document.getElementById('asp-telehabi_alum');
        const correo = document.getElementById('asp-correo_alum');

        if (paisInput) setFieldValid(paisInput);

        if (!estado || !estado.value) {
            setFieldInvalid(estado, 'err-estado', 'Seleccione un Estado.');
            mostrarErrorDePaso(estado, 2, 'Paso 2: Residencia y Canales de Contacto', 'Estado de Residencia', 'Seleccione el Estado donde reside.');
            return false;
        }
        setFieldValid(estado, 'err-estado');

        if (!ciudad || !ciudad.value) {
            setFieldInvalid(ciudad, 'err-ciudad', 'Seleccione una Ciudad.');
            mostrarErrorDePaso(ciudad, 2, 'Paso 2: Residencia y Canales de Contacto', 'Ciudad de Residencia', 'Seleccione la Ciudad donde reside.');
            return false;
        }
        setFieldValid(ciudad, 'err-ciudad');

        const valDirec = (direccion?.value || '').trim().replace(/[ 	]{2,}/g, ' ');
        if (direccion) direccion.value = valDirec;
        if (!valDirec || valDirec.length < 8) {
            setFieldInvalid(direccion, 'err-direccion', 'Detalle su dirección completa (mínimo 8 caracteres).');
            mostrarErrorDePaso(direccion, 2, 'Paso 2: Residencia y Canales de Contacto', 'Dirección de Habitación', 'Detalle su dirección completa de residencia (mínimo 8 caracteres).');
            return false;
        }
        setFieldValid(direccion, 'err-direccion');

        const movDigits = (telemov?.value || '').replace(/\D/g, '');
        if (movDigits.length !== 11 || !PREFIJOS_MOVILES.includes(movDigits.slice(0, 4))) {
            setFieldInvalid(telemov, 'err-telemov', 'Teléfono celular venezolano obligatorio (11 dígitos).');
            mostrarErrorDePaso(telemov, 2, 'Paso 2: Residencia y Canales de Contacto', 'Teléfono Celular', 'Ingrese su número celular venezolano con formato válido (0412, 0414, 0424, 0416 o 0426).');
            return false;
        }
        setFieldValid(telemov, 'err-telemov');

        // Teléfono habitación / secundario (Opcional)
        if (telehab && telehab.value && telehab.value.trim().length > 0) {
            const habDigits = telehab.value.replace(/\D/g, '');
            if (habDigits.length < 10 || habDigits.length > 11) {
                setFieldInvalid(telehab, 'err-telehab', 'Teléfono no válido (debe contener 10 u 11 dígitos).');
                mostrarErrorDePaso(telehab, 2, 'Paso 2: Residencia y Canales de Contacto', 'Teléfono Habitación / Secundario', 'Debe contener 10 u 11 dígitos.');
                return false;
            }
            setFieldValid(telehab, 'err-telehab');
        } else if (telehab) {
            setFieldValid(telehab, 'err-telehab');
        }

        const valCorreo = (correo?.value || '').trim().toLowerCase().replace(/\s+/g, '');
        if (correo) correo.value = valCorreo;
        if (!valCorreo || !REGEX_EMAIL.test(valCorreo)) {
            setFieldInvalid(correo, 'err-correo', 'Correo electrónico no válido.');
            mostrarErrorDePaso(correo, 2, 'Paso 2: Residencia y Canales de Contacto', 'Correo Electrónico', 'Ingrese un correo electrónico válido (ejemplo: aspirante@correo.com).');
            return false;
        }
        setFieldValid(correo, 'err-correo');

    } else if (step === 3) {
        const carrera = document.getElementById('asp-carrera');
        const nivAcadSelect = document.getElementById('asp-niv_acad_alum');
        const anoGrad = document.getElementById('asp-ano_grad_alum');
        const instGrad = document.getElementById('asp-inst_grad_alum');
        const tipoColegioSelect = document.getElementById('asp-tipo_colegio');
        const obsEl = document.getElementById('asp-observaciones');

        if (!carrera || !carrera.value) {
            setFieldInvalid(carrera, 'err-carrera', 'Debe seleccionar una carrera de postulación.');
            mostrarErrorDePaso(carrera, 3, 'Paso 3: Academia y Carrera de Postulación', 'Carrera de Postulación', 'Debe seleccionar la carrera o PNF a la que desea postularse.');
            return false;
        }
        setFieldValid(carrera, 'err-carrera');

        if (nivAcadSelect) setFieldValid(nivAcadSelect);

        const valAno = parseInt(anoGrad?.value || '0', 10);
        const maxYear = new Date().getFullYear() + 1;
        if (!valAno || valAno < 1990 || valAno > maxYear) {
            setFieldInvalid(anoGrad, 'err-ano_grad', `Año válido entre 1990 y ${maxYear}.`);
            mostrarErrorDePaso(anoGrad, 3, 'Paso 3: Academia y Carrera de Postulación', 'Año de Graduación', `Ingrese un año de graduación válido entre 1990 y ${maxYear}.`);
            return false;
        }
        setFieldValid(anoGrad, 'err-ano_grad');

        const valInst = (instGrad?.value || '').trim().replace(/\s{2,}/g, ' ');
        if (instGrad) instGrad.value = valInst;
        if (!valInst || valInst.length < 2) {
            setFieldInvalid(instGrad, 'err-inst_grad', 'Indique la institución de egreso.');
            mostrarErrorDePaso(instGrad, 3, 'Paso 3: Academia y Carrera de Postulación', 'Plantel / Institución de Egreso', 'Indique el nombre del colegio, liceo o institución donde egresó.');
            return false;
        }
        setFieldValid(instGrad, 'err-inst_grad');

        if (tipoColegioSelect) setFieldValid(tipoColegioSelect);

        const valObs = (obsEl?.value || '').trim().replace(/[ 	]{2,}/g, ' ');
        if (obsEl) obsEl.value = valObs;
        if (!valObs || valObs.length < 2) {
            setFieldInvalid(obsEl, 'err-observaciones', 'Observaciones obligatorias (escriba "Ninguna" si no posee).');
            mostrarErrorDePaso(obsEl, 3, 'Paso 3: Academia y Carrera de Postulación', 'Observaciones', 'Campo obligatorio (escriba "Ninguna" si no posee observaciones).');
            return false;
        }
        setFieldValid(obsEl, 'err-observaciones');
    }

    limpiarAvisoErrorPaso();
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

        // Validación integral por pasos (Paso 1, Paso 2, Paso 3) con reporte exacto
        if (!validateCurrentStep(1)) return;
        if (!validateCurrentStep(2)) return;
        if (!validateCurrentStep(3)) return;

        const carrera = document.getElementById('asp-carrera');
        const instGrad = document.getElementById('asp-inst_grad_alum');
        const anoGrad = document.getElementById('asp-ano_grad_alum');
        const obsEl = document.getElementById('asp-observaciones');
        const valAno = parseInt(anoGrad?.value || '0', 10);
        const valEdad = parseInt(document.getElementById('asp-edad_alum')?.value || '0', 10);

        // Construir Payload sanitizado sin espacios residuales (100% de los campos obligatorios)
        const payload = {
            website_url_hp: document.getElementById('website_url_hp')?.value || '',

            tipo_cedula: document.getElementById('asp-tipo_cedula')?.value || 'V',
            ced_alum: document.getElementById('asp-ced_alum')?.value?.trim(),
            nom_alum: document.getElementById('asp-nom_alum')?.value?.trim().replace(/\s{2,}/g, ' '),
            ape_alum: document.getElementById('asp-ape_alum')?.value?.trim().replace(/\s{2,}/g, ' '),
            fec_nac_alum: document.getElementById('asp-fec_nac_alum')?.value,
            edad_alum: valEdad,
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
            observaciones: obsEl?.value || 'Ninguna',
            foto_ext: capturedPhotoExt || 'jpg',
            foto_base64: capturedPhotoBase64 || null,
            cedula_doc_base64: capturedAspiranteCedulaBase64 || null,
            cedula_doc_ext: capturedAspiranteCedulaExt || 'jpg'
        };

        // Si es menor de 18 años, incluir recaudos obligatorios del representante legal
        if (valEdad < 18) {
            payload.repres_doc_base64 = capturedRepresDocBase64 || null;
            payload.repres_doc_ext = capturedRepresDocExt || 'jpg';
            payload.ced_repres = 'Adjunta';
            payload.nom_repres = 'Representante Legal';
            payload.parentesco_repres = 'Representante Legal';
            payload.telemov_repres = payload.telemov_alum || '';
        }

        ultimoRegistroAspirante = {
            ...payload,
            foto_base64: capturedPhotoBase64,
            cedula_doc_base64: capturedAspiranteCedulaBase64,
            repres_doc_base64: capturedRepresDocBase64
        };
        window.ultimoRegistroAspirante = ultimoRegistroAspirante;
        window.capturedPhotoBase64 = capturedPhotoBase64;
        window.capturedAspiranteCedulaBase64 = capturedAspiranteCedulaBase64;

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

    // 1.1 Poblar Acuse de Recibo y Notificación SMS Instantáneo
    const smsData = data.sms_notificacion || {};
    window.ultimoSmsData = smsData;
    const acuseCode = smsData.acuse_recibo || `ACK-IUAC-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.random().toString(16).slice(2, 8).toUpperCase()}`;
    const telNotificado = smsData.telefono || ultimoRegistroAspirante.telemov_alum || '--';
    ultimoRegistroAspirante.acuse_recibo = acuseCode;
    ultimoRegistroAspirante.folio = data.folio || ultimoRegistroAspirante.folio;

    const elSmsAcuse = document.getElementById('voucher-sms-acuse');
    if (elSmsAcuse) elSmsAcuse.textContent = acuseCode;

    const elSmsTel = document.getElementById('voucher-sms-telefono');
    if (elSmsTel) elSmsTel.textContent = telNotificado;

    const elSmsDlr = document.getElementById('voucher-sms-dlr');
    if (elSmsDlr) elSmsDlr.textContent = `${acuseCode} (CONFIRMADO)`;

    const elSmsPreview = document.getElementById('voucher-sms-preview');
    if (elSmsPreview) {
        elSmsPreview.textContent = smsData.texto || `IUAC: Preinscripción completada con éxito. Folio: ${data.folio || 'IUAC-2026-REG'}, Cédula: ${tipoCed}-${numCed}. Especialidad: ${carreraCompleta}. Conserve este SMS como Acuse Oficial de Recibo.`;
    }

    const btnSmsMovil = document.getElementById('btn-abrir-sms-movil');
    if (btnSmsMovil) {
        const esMovil = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
        if (smsData.sms_uri || esMovil) {
            btnSmsMovil.href = smsData.sms_uri || `sms:${telNotificado.replace(/[^\d+]/g, '')}?body=${encodeURIComponent(elSmsPreview?.textContent || '')}`;
            btnSmsMovil.style.display = 'inline-flex';
        } else {
            btnSmsMovil.style.display = 'none';
        }
    }

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
    setTxt('p-qr-sms', ultimoRegistroAspirante.acuse_recibo || (window.ultimoSmsData && window.ultimoSmsData.acuse_recibo) || 'ACK-IUAC-REG');

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
        btn.innerHTML = '⏳ Generando archivo PDF con fotografía...';
    }
    try {
        if (!ultimoRegistroAspirante) {
            ultimoRegistroAspirante = {};
        }
        if (!ultimoRegistroAspirante.foto_base64 && (capturedPhotoBase64 || window.capturedPhotoBase64)) {
            ultimoRegistroAspirante.foto_base64 = capturedPhotoBase64 || window.capturedPhotoBase64;
        }
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

// ── CONTROL DEL ACORDEÓN DE INSTRUCTIVOS Y DESCARGAS OFICIALES (PDF) ─────────
function toggleAcordeonDescargas() {
    const btn = document.getElementById('btn-toggle-descargas');
    const panel = document.getElementById('accordion-descargas-panel');
    if (!btn || !panel) return;
    const isExpanded = btn.classList.contains('active');
    if (isExpanded) {
        btn.classList.remove('active');
        btn.setAttribute('aria-expanded', 'false');
        panel.style.display = 'none';
    } else {
        btn.classList.add('active');
        btn.setAttribute('aria-expanded', 'true');
        panel.style.display = 'block';
    }
}
window.toggleAcordeonDescargas = toggleAcordeonDescargas;
