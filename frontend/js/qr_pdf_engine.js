/**
 * qr_pdf_engine.js - Motor Nativo de Código QR (ISO/IEC 18004), Verificación Biométrica Móvil (WebAuthn)
 * y Generación Directa de Planilla Oficial en formato PDF de 1 sola página (sin ventana de impresión).
 */

// ══════════════════════════════════════════════════════════════════════════════
// 1. CODIFICADOR NATIVO QR CODE (ISO/IEC 18004 - NIVEL L, MODO BYTE, V1-V5)
// ══════════════════════════════════════════════════════════════════════════════
const QR_VERSIONS_L = [
    null,
    { size: 21, totalCodewords: 26, dataCodewords: 19, ecCodewords: 7, align: [] },
    { size: 25, totalCodewords: 44, dataCodewords: 34, ecCodewords: 10, align: [6, 18] },
    { size: 29, totalCodewords: 70, dataCodewords: 55, ecCodewords: 15, align: [6, 22] },
    { size: 33, totalCodewords: 100, dataCodewords: 80, ecCodewords: 20, align: [6, 26] },
    { size: 37, totalCodewords: 134, dataCodewords: 108, ecCodewords: 26, align: [6, 30] }
];

// Tablas de cuerpo finito GF(256) con polinomio primitivo 0x11D
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(function initGaloisField() {
    let x = 1;
    for (let i = 0; i < 255; i++) {
        GF_EXP[i] = x;
        GF_LOG[x] = i;
        x <<= 1;
        if (x & 0x100) x ^= 0x11d;
    }
    for (let i = 255; i < 512; i++) {
        GF_EXP[i] = GF_EXP[i - 255];
    }
})();

function gfMul(a, b) {
    if (a === 0 || b === 0) return 0;
    return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGeneratorPoly(degree) {
    let poly = [1];
    for (let i = 0; i < degree; i++) {
        const next = new Array(poly.length + 1).fill(0);
        const factor = GF_EXP[i];
        for (let j = 0; j < poly.length; j++) {
            next[j] ^= poly[j];
            next[j + 1] ^= gfMul(poly[j], factor);
        }
        poly = next;
    }
    return poly;
}

function rsEncode(dataBytes, ecCount) {
    const gen = rsGeneratorPoly(ecCount);
    const msg = new Uint8Array(dataBytes.length + ecCount);
    msg.set(dataBytes, 0);
    for (let i = 0; i < dataBytes.length; i++) {
        const coef = msg[i];
        if (coef !== 0) {
            for (let j = 0; j < gen.length; j++) {
                msg[i + j] ^= gfMul(gen[j], coef);
            }
        }
    }
    return msg.slice(dataBytes.length);
}

function generarMatrizQR(texto) {
    // Codificar UTF-8 a bytes (máximo 104 bytes para caber siempre en V5-L de 1 bloque)
    const encoder = new TextEncoder();
    let utf8 = encoder.encode(String(texto || '').slice(0, 104));
    if (utf8.length > 104) utf8 = utf8.slice(0, 104);

    // Seleccionar versión mínima (1..5)
    let version = 5;
    for (let v = 1; v <= 5; v++) {
        if (utf8.length + 2 <= QR_VERSIONS_L[v].dataCodewords) {
            version = v;
            break;
        }
    }
    const spec = QR_VERSIONS_L[version];

    // Construir flujo de bits: Modo Byte (0100) + Longitud (8 bits) + Datos + Terminador
    const bits = [];
    const pushBits = (val, len) => {
        for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1);
    };

    pushBits(0b0100, 4);
    pushBits(utf8.length, 8);
    for (let i = 0; i < utf8.length; i++) pushBits(utf8[i], 8);

    const maxDataBits = spec.dataCodewords * 8;
    const termLen = Math.min(4, maxDataBits - bits.length);
    pushBits(0, termLen);
    while (bits.length % 8 !== 0) bits.push(0);

    const dataBytes = new Uint8Array(spec.dataCodewords);
    let byteIdx = 0;
    for (let i = 0; i < bits.length; i += 8) {
        let b = 0;
        for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
        dataBytes[byteIdx++] = b;
    }
    const padBytes = [0xec, 0x11];
    let padIdx = 0;
    while (byteIdx < spec.dataCodewords) {
        dataBytes[byteIdx++] = padBytes[padIdx % 2];
        padIdx++;
    }

    const ecBytes = rsEncode(dataBytes, spec.ecCodewords);
    const allCodewords = new Uint8Array(spec.totalCodewords);
    allCodewords.set(dataBytes, 0);
    allCodewords.set(ecBytes, dataBytes.length);

    // Inicializar matriz
    const N = spec.size;
    const modules = Array.from({ length: N }, () => new Int8Array(N)); // 0=blanco, 1=negro
    const isFunc = Array.from({ length: N }, () => new Uint8Array(N));

    const setFunc = (r, c, dark) => {
        if (r >= 0 && r < N && c >= 0 && c < N) {
            modules[r][c] = dark ? 1 : 0;
            isFunc[r][c] = 1;
        }
    };

    // Patrones de búsqueda (Finder 7x7 + separador)
    const placeFinder = (row, col) => {
        for (let dr = -1; dr <= 7; dr++) {
            for (let dc = -1; dc <= 7; dc++) {
                const r = row + dr, c = col + dc;
                if (r < 0 || r >= N || c < 0 || c >= N) continue;
                const inOuter = (dr >= 0 && dr <= 6 && (dc === 0 || dc === 6)) ||
                                (dc >= 0 && dc <= 6 && (dr === 0 || dr === 6));
                const inInner = (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4);
                setFunc(r, c, inOuter || inInner);
            }
        }
    };
    placeFinder(0, 0);
    placeFinder(0, N - 7);
    placeFinder(N - 7, 0);

    // Patrones de temporización (Timing)
    for (let i = 8; i < N - 8; i++) {
        setFunc(6, i, i % 2 === 0);
        setFunc(i, 6, i % 2 === 0);
    }

    // Patrón de alineación (V2-V5)
    if (spec.align.length > 0) {
        for (const ar of spec.align) {
            for (const ac of spec.align) {
                if ((ar === 6 && ac === 6) || (ar === 6 && ac === N - 7) || (ar === N - 7 && ac === 6)) continue;
                for (let dr = -2; dr <= 2; dr++) {
                    for (let dc = -2; dc <= 2; dc++) {
                        const dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
                        setFunc(ar + dr, ac + dc, dark);
                    }
                }
            }
        }
    }

    // Módulo oscuro fijo y reserva de áreas de formato
    setFunc(4 * version + 9, 8, true);
    for (let i = 0; i < 9; i++) {
        if (!isFunc[8][i]) setFunc(8, i, false);
        if (!isFunc[i][8]) setFunc(i, 8, false);
    }
    for (let i = 0; i < 8; i++) {
        if (!isFunc[8][N - 1 - i]) setFunc(8, N - 1 - i, false);
        if (!isFunc[N - 1 - i][8]) setFunc(N - 1 - i, 8, false);
    }

    // Colocar bits de datos en zig-zag de 2 columnas desde la derecha
    let bitPos = 0;
    const totalBits = allCodewords.length * 8;
    let upward = true;
    for (let right = N - 1; right >= 1; right -= 2) {
        if (right === 6) right = 5; // Saltar columna de timing vertical
        for (let vert = 0; vert < N; vert++) {
            const r = upward ? (N - 1 - vert) : vert;
            for (let j = 0; j < 2; j++) {
                const c = right - j;
                if (!isFunc[r][c]) {
                    let dark = false;
                    if (bitPos < totalBits) {
                        const byteVal = allCodewords[bitPos >> 3];
                        dark = ((byteVal >> (7 - (bitPos & 7))) & 1) === 1;
                        bitPos++;
                    }
                    // Aplicar Máscara 0: (r + c) % 2 === 0
                    if ((r + c) % 2 === 0) dark = !dark;
                    modules[r][c] = dark ? 1 : 0;
                }
            }
        }
        upward = !upward;
    }

    // Escribir bits de información de formato para Nivel L (01) + Máscara 0 (000) => 0x77C4
    const formatBits = 0x77c4;
    const getFmtBit = (i) => ((formatBits >> i) & 1) === 1;

    // Alrededor de esquina superior izquierda
    for (let i = 0; i <= 5; i++) setFunc(8, i, getFmtBit(i));
    setFunc(8, 7, getFmtBit(6));
    setFunc(8, 8, getFmtBit(7));
    setFunc(7, 8, getFmtBit(8));
    for (let i = 9; i < 15; i++) setFunc(14 - i, 8, getFmtBit(i));

    // Esquina superior derecha e inferior izquierda
    for (let i = 0; i < 8; i++) setFunc(8, N - 1 - i, getFmtBit(i));
    for (let i = 8; i < 15; i++) setFunc(N - 15 + i, 8, getFmtBit(i));

    return modules;
}

function dibujarQREnCanvas(canvas, texto, pixelSize = 180, conLogo = false, callback = null) {
    if (!canvas) return null;
    const matrix = generarMatrizQR(texto);
    const N = matrix.length;
    const quietZone = 3;
    const totalModules = N + quietZone * 2;
    canvas.width = pixelSize;
    canvas.height = pixelSize;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, pixelSize, pixelSize);

    const scale = pixelSize / totalModules;
    ctx.fillStyle = '#000000';
    for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
            if (matrix[r][c]) {
                const x = Math.floor((c + quietZone) * scale);
                const y = Math.floor((r + quietZone) * scale);
                const w = Math.ceil((c + quietZone + 1) * scale) - x;
                const h = Math.ceil((r + quietZone + 1) * scale) - y;
                ctx.fillRect(x, y, w, h);
            }
        }
    }

    if (conLogo) {
        const logoSize = Math.round(pixelSize * 0.22);
        const cx = pixelSize / 2;
        const cy = pixelSize / 2;
        const radius = Math.round((logoSize / 2) + 4);

        const pintarLogo = (img) => {
            try {
                ctx.save();
                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.arc(cx, cy, radius, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = '#0f172a';
                ctx.lineWidth = 1.5;
                ctx.stroke();

                ctx.drawImage(img, cx - (logoSize / 2), cy - (logoSize / 2), logoSize, logoSize);
                ctx.restore();
            } catch (err) {
                console.warn('No se pudo superponer el logo en el QR:', err);
            }
            if (typeof callback === 'function') callback(canvas);
        };

        const imgLogo = new Image();
        imgLogo.crossOrigin = 'anonymous';
        imgLogo.onload = () => { pintarLogo(imgLogo); };
        imgLogo.onerror = () => {
            if (typeof callback === 'function') callback(canvas);
        };
        imgLogo.src = 'img/logo_iuac.png';
        if (imgLogo.complete && imgLogo.naturalWidth > 0) {
            pintarLogo(imgLogo);
        }
    } else {
        if (typeof callback === 'function') callback(canvas);
    }

    return canvas;
}

// ══════════════════════════════════════════════════════════════════════════════
// 2. CONVERSOR DIRECTO DE CANVAS A ARCHIVO PDF 1.4 DE 1 SOLA PÁGINA (CARTA)
// ══════════════════════════════════════════════════════════════════════════════
function crearBlobPDFDesdeJPEGDataURL(jpegDataUrl, imgWidthPx, imgHeightPx) {
    const base64Data = jpegDataUrl.split(',')[1];
    const binaryStr = atob(base64Data);
    const jpegBytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
        jpegBytes[i] = binaryStr.charCodeAt(i);
    }

    // Tamaño Carta (Letter) en puntos tipográficos (1/72 pulgada): 612 x 792 pt
    const pageW = 612;
    const pageH = 792;
    const contentStream = `q\n${pageW} 0 0 ${pageH} 0 0 cm\n/Im0 Do\nQ\n`;

    const chunks = [];
    const offsets = [];
    let currentOffset = 0;
    const encoder = new TextEncoder();

    const addStr = (str) => {
        const bytes = encoder.encode(str);
        chunks.push(bytes);
        currentOffset += bytes.length;
    };
    const addBytes = (bytes) => {
        chunks.push(bytes);
        currentOffset += bytes.length;
    };
    const markObj = (id) => {
        offsets[id] = currentOffset;
    };

    addStr('%PDF-1.4\n%\xFF\xFF\xFF\xFF\n');

    // Objeto 1: Catálogo
    markObj(1);
    addStr('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

    // Objeto 2: Árbol de Páginas (Estrictamente 1 sola página)
    markObj(2);
    addStr('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');

    // Objeto 3: Página única tamaño Carta
    markObj(3);
    addStr(`3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /XObject << /Im0 4 0 R >> >> /MediaBox [0 0 ${pageW} ${pageH}] /Contents 5 0 R >>\nendobj\n`);

    // Objeto 4: Imagen JPEG de alta resolución de la planilla
    markObj(4);
    addStr(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${imgWidthPx} /Height ${imgHeightPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`);
    addBytes(jpegBytes);
    addStr('\nendstream\nendobj\n');

    // Objeto 5: Stream de dibujo en la página
    markObj(5);
    addStr(`5 0 obj\n<< /Length ${contentStream.length} >>\nstream\n${contentStream}endstream\nendobj\n`);

    // Tabla XREF
    const xrefOffset = currentOffset;
    addStr('xref\n0 6\n0000000000 65535 f \n');
    for (let i = 1; i <= 5; i++) {
        const offStr = String(offsets[i]).padStart(10, '0');
        addStr(`${offStr} 00000 n \n`);
    }

    // Trailer
    addStr(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);

    return new Blob(chunks, { type: 'application/pdf' });
}

// ══════════════════════════════════════════════════════════════════════════════
// 3. RENDERIZADOR GRÁFICO DE LA PLANILLA OFICIAL IUAC (1 PÁGINA + QR CÉDULA)
// ══════════════════════════════════════════════════════════════════════════════
function cargarImagenPromesa(src) {
    return new Promise((resolve) => {
        if (!src || typeof src !== 'string') return resolve(null);
        let srcFinal = src.trim();

        // Si es una cadena Base64 pura sin prefijo data:
        if (!srcFinal.startsWith('data:') && !srcFinal.startsWith('/') && !srcFinal.startsWith('http') && srcFinal.length > 50) {
            const esPng = srcFinal.startsWith('iVBORw');
            srcFinal = (esPng ? 'data:image/png;base64,' : 'data:image/jpeg;base64,') + srcFinal;
        }

        // Si es Data URI (Base64), cargar directo sin red (imposible que manche el Canvas)
        if (srcFinal.startsWith('data:')) {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => resolve(null);
            img.src = srcFinal;
            return;
        }

        // Si es URL del servidor (/fotos_aspirantes/...), descargar con fetch como Blob
        // y convertir con FileReader a Data URL local para que el Canvas NUNCA se vuelva 'tainted'
        fetch(srcFinal, { mode: 'cors' })
            .then(res => {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.blob();
            })
            .then(blob => {
                const reader = new FileReader();
                reader.onload = () => {
                    const imgBlob = new Image();
                    imgBlob.onload = () => resolve(imgBlob);
                    imgBlob.onerror = () => resolve(null);
                    imgBlob.src = reader.result;
                };
                reader.onerror = () => resolve(null);
                reader.readAsDataURL(blob);
            })
            .catch(() => {
                // Fallback directo con crossOrigin anónimo
                const img = new Image();
                img.crossOrigin = 'anonymous';
                img.onload = () => resolve(img);
                img.onerror = () => resolve(null);
                img.src = srcFinal;
            });
    });
}

async function obtenerImagenFotoCarnet(reg) {
    const r = reg || window.ultimoRegistroAspirante || {};

    // 1. Probar variables en memoria directa (máxima prioridad, fidelidad y nitidez)
    const fuentesDirectas = [
        r.foto_base64,
        window.capturedPhotoBase64,
        window.ultimoRegistroAspirante?.foto_base64,
        (typeof r.foto_alum === 'string' && r.foto_alum.length > 50 && !r.foto_alum.endsWith('.jpg') && !r.foto_alum.endsWith('.png')) ? r.foto_alum : null
    ].filter(Boolean);

    for (const src of fuentesDirectas) {
        try {
            const img = await cargarImagenPromesa(src);
            if (img && (img.naturalWidth > 0 || img.width > 0)) return img;
        } catch (_) {}
    }

    // 2. Probar elementos imagen ya montados en el DOM
    const domSelectors = [
        '#planilla-foto-img',
        '#photo-preview-img',
        '#preview-recuperar-foto-img',
        '#asp-foto-preview'
    ];
    for (const sel of domSelectors) {
        const el = document.querySelector(sel);
        if (el && el.tagName === 'IMG' && el.src) {
            try {
                const img = await cargarImagenPromesa(el.src);
                if (img && (img.naturalWidth > 0 || img.width > 0)) return img;
            } catch (_) {}
        }
    }

    // 3. Probar rutas físicas del servidor (/fotos_aspirantes/...)
    const cedDigits = String(r.ced_alum || '').replace(/\D/g, '');
    const rutasAProbar = [];
    if (r.ruta_foto_archivo) rutasAProbar.push(r.ruta_foto_archivo);
    if (r.enlace_foto) rutasAProbar.push(r.enlace_foto);
    if (r.foto_alum && (r.foto_alum.endsWith('.jpg') || r.foto_alum.endsWith('.png'))) {
        rutasAProbar.push(r.foto_alum.startsWith('/') ? r.foto_alum : `/fotos_aspirantes/${r.foto_alum}`);
    }
    if (cedDigits) {
        if (typeof window.construirNombreFotoPersonalizado === 'function') {
            rutasAProbar.push(`/fotos_aspirantes/${window.construirNombreFotoPersonalizado(cedDigits, r.nom_alum, r.ape_alum, 'jpg')}`);
            rutasAProbar.push(`/fotos_aspirantes/${window.construirNombreFotoPersonalizado(cedDigits, r.nom_alum, r.ape_alum, 'png')}`);
        }
        rutasAProbar.push(`/fotos_aspirantes/aspirante-${cedDigits}.jpg`);
        rutasAProbar.push(`/fotos_aspirantes/aspirante-${cedDigits}.png`);
        rutasAProbar.push(`/fotos_aspirantes/foto_${cedDigits}.jpg`);
    }

    for (const ruta of rutasAProbar) {
        try {
            const img = await cargarImagenPromesa(ruta);
            if (img && (img.naturalWidth > 0 || img.width > 0)) return img;
        } catch (_) {}
    }

    return null;
}

async function descargarPlanillaPDFOficial(datosPlanilla) {
    const reg = datosPlanilla || window.ultimoRegistroAspirante || {};
    const tipoCed = reg.tipo_cedula || 'V';
    const cedNumRaw = String(reg.ced_alum || '').replace(/\D/g, '');
    const cedFormateada = cedNumRaw ? `${tipoCed} - ${Number(cedNumRaw).toLocaleString('es-VE')}` : '--';
    const folio = reg.folio || `IUAC-2026-${cedNumRaw || 'REG'}`;
    const fechaEmision = reg.fecha_registro || new Date().toLocaleDateString('es-VE', {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true
    });

    const mapaCarreras = window.MAPA_CARRERAS || {};
    const carreraTexto = mapaCarreras[reg.carrera] || reg.carrera || '--';

    // Texto de verificación incrustado en el QR de la cédula
    const qrPayload = `IUAC-2026|CI:${tipoCed}-${cedNumRaw}|FOLIO:${folio}|CARRERA:${reg.carrera || ''}|ASPIRANTE:${(reg.nom_alum || '')} ${(reg.ape_alum || '')}`.trim();

    // Actualizar también el QR en el DOM (#planilla-qr-canvas)
    const domQrCanvas = document.getElementById('planilla-qr-canvas');
    if (domQrCanvas) {
        dibujarQREnCanvas(domQrCanvas, qrPayload, 140, true);
    }

    // Lienzo de alta definición proporción Carta exacta (1224 x 1584 px = 2x de 612x792 pt)
    const W = 1224;
    const H = 1584;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    // Fondo blanco puro
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);

    const M = 56; // Margen lateral (56px)
    const contentW = W - M * 2;
    let y = 46;

    // Cargar logo IUAC y foto del aspirante
    const [logoImg, fotoImg] = await Promise.all([
        cargarImagenPromesa('img/logo_iuac.png'),
        obtenerImagenFotoCarnet(reg)
    ]);

    // 1. ENCABEZADO INSTITUCIONAL
    if (logoImg) {
        ctx.drawImage(logoImg, M, y + 6, 135, 135);
    }

    // Recuadro de Fotografía Tipo Carnet (derecha)
    const fotoW = 148;
    const fotoH = 180;
    const fotoX = W - M - fotoW;
    const fotoY = y;
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(fotoX, fotoY, fotoW, fotoH);
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 2.5;
    ctx.strokeRect(fotoX, fotoY, fotoW, fotoH);

    if (fotoImg) {
        ctx.drawImage(fotoImg, fotoX + 2, fotoY + 2, fotoW - 4, fotoH - 4);
    } else {
        ctx.fillStyle = '#6b6b6b';
        ctx.font = 'bold 14px Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('FOTO TIPO', fotoX + fotoW / 2, fotoY + 82);
        ctx.fillText('CARNET', fotoX + fotoW / 2, fotoY + 102);
    }

    // Textos centrales del encabezado
    const centerX = W / 2 - 10;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#1a1a1a';
    ctx.font = 'bold 16px Arial, sans-serif';
    ctx.fillText('REPÚBLICA BOLIVARIANA DE VENEZUELA', centerX, y + 20);
    ctx.font = 'bold 14px Arial, sans-serif';
    ctx.fillStyle = '#3a3a3a';
    ctx.fillText('MINISTERIO DEL PODER POPULAR PARA EL TRANSPORTE', centerX, y + 40);
    ctx.fillText('INSTITUTO NACIONAL DE AERONÁUTICA CIVIL (INAC)', centerX, y + 59);

    ctx.fillStyle = '#000000';
    ctx.font = '900 21px Arial, sans-serif';
    ctx.fillText('INSTITUTO UNIVERSITARIO DE AERONÁUTICA CIVIL', centerX, y + 86);
    ctx.font = 'italic bold 17px Arial, sans-serif';
    ctx.fillText('"MAYOR (AV) MIGUEL RODRÍGUEZ"', centerX, y + 109);

    // Subtítulo Departamento
    ctx.strokeStyle = '#3a3a3a';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(centerX - 260, y + 118);
    ctx.lineTo(centerX + 260, y + 118);
    ctx.moveTo(centerX - 260, y + 140);
    ctx.lineTo(centerX + 260, y + 140);
    ctx.stroke();
    ctx.font = 'bold 14.5px Arial, sans-serif';
    ctx.fillStyle = '#1a1a1a';
    ctx.fillText('DEPARTAMENTO DE CAPTACIÓN, SELECCIÓN Y ACREDITACIÓN', centerX, y + 134);

    // Banda de título del documento
    ctx.fillStyle = '#dce7f5';
    ctx.fillRect(centerX - 340, y + 148, 680, 26);
    ctx.fillStyle = '#0f2d59';
    ctx.font = 'bold 15px Arial, sans-serif';
    ctx.fillText('PLANILLA OFICIAL DE PREINSCRIPCIÓN DE ASPIRANTES — CONVOCATORIA 2026-2027', centerX, y + 166);

    y += 192;

    // Línea divisoria superior
    ctx.strokeStyle = '#0f2d59';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(M, y);
    ctx.lineTo(W - M, y);
    ctx.stroke();
    y += 10;

    // Barra de Control (Nuevo color de fondo Azul Marino Institucional IUAC)
    ctx.fillStyle = '#16365c';
    ctx.fillRect(M, y, contentW, 38);
    ctx.strokeStyle = '#0f2642';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(M, y, contentW, 38);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 15.5px Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`N° FOLIO: ${folio}`, M + 16, y + 25);
    ctx.textAlign = 'center';
    ctx.fillText(`FECHA EMISIÓN: ${fechaEmision}`, W / 2, y + 25);
    ctx.textAlign = 'right';
    ctx.fillText('CONDICIÓN: PREINSCRITO EN LÍNEA', W - M - 16, y + 25);
    y += 50;

    // Helper para dibujar secciones (Puntos 1, 2 y 3 con nuevo color de fondo Azul Aeronáutico Institucional)
    const drawSectionHeader = (titulo) => {
        ctx.fillStyle = '#214d7e';
        ctx.fillRect(M, y, contentW, 32);
        // Acento lateral izquierdo institucional
        ctx.fillStyle = '#38bdf8';
        ctx.fillRect(M, y, 7, 32);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 15.5px Arial, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(titulo, M + 16, y + 22);
        y += 34;
    };

    const drawTableRow = (cols, rowH = 58, bg = '#ffffff') => {
        let curX = M;
        for (const col of cols) {
            const cellW = Math.round(contentW * col.w);
            ctx.fillStyle = col.bg || bg;
            ctx.fillRect(curX, y, cellW, rowH);
            ctx.strokeStyle = '#64748b';
            ctx.lineWidth = 1.4;
            ctx.strokeRect(curX, y, cellW, rowH);

            ctx.textAlign = 'left';
            ctx.fillStyle = '#334155';
            ctx.font = 'bold 13px Arial, sans-serif';
            ctx.fillText(col.label, curX + 12, y + 20);

            ctx.fillStyle = col.valColor || '#000000';
            ctx.font = col.valFont || 'bold 16.5px Arial, sans-serif';
            const valStr = String(col.value || '--');
            ctx.fillText(valStr.slice(0, 82), curX + 12, y + 44);

            curX += cellW;
        }
        y += rowH;
    };

    // SECCIÓN 1: DATOS DE IDENTIFICACIÓN Y PERSONALES
    drawSectionHeader('1. DATOS DE IDENTIFICACIÓN Y PERSONALES DEL ASPIRANTE');
    const sexoTexto = (reg.sex_alum === 'F') ? 'FEMENINO' : 'MASCULINO';
    drawTableRow([
        { w: 0.25, label: 'CÉDULA DE IDENTIDAD:', value: cedFormateada },
        { w: 0.25, label: 'NACIONALIDAD:', value: reg.nacionalidad_alum || 'VENEZOLANA' },
        { w: 0.25, label: 'GÉNERO:', value: sexoTexto },
        { w: 0.25, label: 'ESTADO CIVIL:', value: (reg.est_civil_alum || 'SOLTERO/A').toUpperCase() }
    ]);
    drawTableRow([
        { w: 0.50, label: 'NOMBRES COMPLETOS:', value: reg.nom_alum || '--' },
        { w: 0.50, label: 'APELLIDOS COMPLETOS:', value: reg.ape_alum || '--' }
    ]);

    let edadCalc = reg.edad_alum;
    if (!edadCalc && reg.fec_nac_alum) {
        const parts = String(reg.fec_nac_alum).split('-');
        if (parts.length === 3) {
            const b = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
            const hoy = new Date();
            edadCalc = hoy.getFullYear() - b.getFullYear() - ((hoy.getMonth() < b.getMonth() || (hoy.getMonth() === b.getMonth() && hoy.getDate() < b.getDate())) ? 1 : 0);
        }
    }
    drawTableRow([
        { w: 0.25, label: 'FECHA DE NACIMIENTO:', value: reg.fec_nac_alum || '--' },
        { w: 0.25, label: 'EDAD:', value: edadCalc ? `${edadCalc} años` : '--' },
        { w: 0.50, label: 'LUGAR DE NACIMIENTO:', value: (reg.lugar_nac_alum || '--').toUpperCase() }
    ]);

    const esMenor = (edadCalc && edadCalc < 18) || Boolean(reg.nom_repres);
    // Fila adicional de Representante Legal si el aspirante es menor de edad
    if (esMenor) {
        drawTableRow([
            { w: 0.50, label: 'CONDICIÓN LEGAL DEL ASPIRANTE:', value: 'MENOR DE EDAD (REQUIERE REPRESENTANTE)', bg: '#fffbeb', valColor: '#9a3412' },
            { w: 0.50, label: 'FOTOCOPIA CÉDULA REPRESENTANTE:', value: 'CONSIGNADA / ALOJADA EN SISTEMA IUAC', bg: '#fffbeb', valColor: '#1e293b' }
        ], 52);
    }
    y += 14;

    // SECCIÓN 2: DATOS DE UBICACIÓN RESIDENCIAL Y CONTACTO
    drawSectionHeader('2. DATOS DE UBICACIÓN RESIDENCIAL Y CONTACTO');
    drawTableRow([
        { w: 0.33, label: 'ESTADO:', value: (reg.est_alum || '--').toUpperCase() },
        { w: 0.33, label: 'CIUDAD / MUNICIPIO:', value: (reg.ciu_alum || '--').toUpperCase() },
        { w: 0.34, label: 'PAÍS:', value: (reg.pais_alum || 'VENEZUELA').toUpperCase() }
    ]);
    drawTableRow([
        { w: 1.00, label: 'DIRECCIÓN DE HABITACIÓN:', value: reg.direc_alum || '--' }
    ]);
    drawTableRow([
        { w: 0.33, label: 'TELÉFONO MÓVIL:', value: reg.telemov_alum || '--' },
        { w: 0.33, label: 'TELÉFONO HABITACIÓN:', value: reg.telehabi_alum || 'No registrado' },
        { w: 0.34, label: 'CORREO ELECTRÓNICO:', value: reg.correo_alum || '--' }
    ]);
    y += 14;

    // SECCIÓN 3: ANTECEDENTES ACADÉMICOS Y CARRERA
    drawSectionHeader('3. ANTECEDENTES ACADÉMICOS Y ESPECIALIDAD DE POSTULACIÓN');
    drawTableRow([
        {
            w: 1.00,
            label: 'ESPECIALIDAD AERONÁUTICA DE POSTULACIÓN:',
            value: carreraTexto,
            bg: '#edf4fc',
            valColor: '#0f2d59',
            valFont: '900 19px Arial, sans-serif'
        }
    ], 62);
    drawTableRow([
        { w: 0.33, label: 'NIVEL ACADÉMICO:', value: (reg.niv_acad_alum || 'BACHILLER').toUpperCase() },
        { w: 0.33, label: 'AÑO DE GRADUACIÓN:', value: String(reg.ano_grad_alum || '--') },
        { w: 0.34, label: 'TIPO DE INSTITUCIÓN:', value: (reg.tipo_colegio || 'PÚBLICO').toUpperCase() }
    ]);
    drawTableRow([
        { w: 1.00, label: 'PLANTEL O INSTITUCIÓN DE EGRESO:', value: reg.inst_grad_alum || '--' }
    ]);
    y += 18;

    // DECLARACIÓN JURADA (Aumento de +9px en las letras: de 13px a 22px para ocupar armónicamente el espacio en la hoja Carta)
    ctx.fillStyle = '#1e293b';
    ctx.font = 'italic bold 21.5px Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('"Declaro bajo fe de juramento que todos los datos contenidos en esta planilla son fidedignos', M, y + 22);
    ctx.fillText('y que cumplo con la totalidad de los requisitos de admisión reglamentarios exigidos', M, y + 50);
    ctx.fillText('por el Instituto Universitario de Aeronáutica Civil (IUAC)."', M, y + 78);
    y += (esMenor ? 92 : 98);

    // RECUADROS DE FIRMAS (Mayor altura y mayor tamaño de letras)
    const firmaW = Math.round((contentW - 28) / 2);
    const firmaH = esMenor ? 184 : 210;

    // Caja Firma Aspirante (Izquierda)
    ctx.strokeStyle = '#0f2d59';
    ctx.lineWidth = 2;
    ctx.strokeRect(M, y, firmaW, firmaH);

    const areaFirmaIzqW = firmaW - 140;
    const lineaFirmaIzqY = y + firmaH - 72;
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(M + 34, lineaFirmaIzqY);
    ctx.lineTo(M + areaFirmaIzqW - 14, lineaFirmaIzqY);
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 18.5px Arial, sans-serif';
    ctx.fillText('FIRMA DEL ASPIRANTE', M + (areaFirmaIzqW + 20) / 2, lineaFirmaIzqY + 26);
    ctx.font = 'bold 17px Arial, sans-serif';
    ctx.fillText(`C.I.: ${cedFormateada}`, M + (areaFirmaIzqW + 20) / 2, lineaFirmaIzqY + 50);

    // Casilla Huella Pulgar Derecho (Más alta y letras más grandes)
    const huellaW = 118;
    const huellaH = firmaH - 28;
    const huellaX = M + firmaW - huellaW - 16;
    const huellaY = y + 14;
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1.6;
    ctx.strokeRect(huellaX, huellaY, huellaW, huellaH);
    ctx.setLineDash([]);
    ctx.fillStyle = '#475569';
    ctx.font = 'bold 14.5px Arial, sans-serif';
    ctx.fillText('Huella Pulgar', huellaX + huellaW / 2, huellaY + huellaH / 2 - 6);
    ctx.fillText('Derecho', huellaX + huellaW / 2, huellaY + huellaH / 2 + 14);

    // Caja Revisado y Recibido Por (Derecha)
    const revX = M + firmaW + 28;
    ctx.strokeStyle = '#0f2d59';
    ctx.lineWidth = 2;
    ctx.strokeRect(revX, y, firmaW, firmaH);

    const lineaFirmaDerY = y + firmaH - 86;
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(revX + 54, lineaFirmaDerY);
    ctx.lineTo(revX + firmaW - 54, lineaFirmaDerY);
    ctx.stroke();

    ctx.fillStyle = '#000000';
    ctx.font = 'bold 18.5px Arial, sans-serif';
    ctx.fillText('REVISADO Y RECIBIDO POR:', revX + firmaW / 2, lineaFirmaDerY + 25);
    ctx.font = 'bold 15.5px Arial, sans-serif';
    ctx.fillStyle = '#1e293b';
    ctx.fillText('Depto. de Captación, Selección y Acreditación IUAC', revX + firmaW / 2, lineaFirmaDerY + 49);
    ctx.fillStyle = '#475569';
    ctx.font = 'bold 14.5px Arial, sans-serif';
    ctx.fillText('SELLO INSTITUCIONAL / FECHA', revX + firmaW / 2, lineaFirmaDerY + 72);

    y += firmaH + (esMenor ? 18 : 22);

    // FRANJA INFERIOR DE VERIFICACIÓN CON CÓDIGO QR AMPLIADO Y LETRAS MÁS GRANDES
    const qrFooterH = esMenor ? 210 : 230;
    ctx.fillStyle = '#f1f6fc';
    ctx.fillRect(M, y, contentW, qrFooterH);
    ctx.strokeStyle = '#16365c';
    ctx.lineWidth = 2.2;
    ctx.strokeRect(M, y, contentW, qrFooterH);

    // Generar QR ampliado en canvas auxiliar e incrustarlo en la parte inferior
    const qrSize = esMenor ? 182 : 198;
    const qrPadY = Math.round((qrFooterH - qrSize) / 2);
    const qrTempCanvas = document.createElement('canvas');
    dibujarQREnCanvas(qrTempCanvas, qrPayload, qrSize);
    ctx.drawImage(qrTempCanvas, M + 18, y + qrPadY, qrSize, qrSize);

    // Texto explicativo con letras aumentadas junto al QR en el pie de la planilla
    const qrTextX = M + qrSize + 36;
    const acuseRecibo = reg.acuse_recibo || (window.ultimoSmsData && window.ultimoSmsData.acuse_recibo) || 'ACK-IUAC-REGISTRADO';
    const telMovil = reg.telemov_alum || 'Teléfono Registrado';

    ctx.textAlign = 'left';
    ctx.fillStyle = '#0f2d59';
    ctx.font = '900 18.5px Arial, sans-serif';
    ctx.fillText('CÓDIGO QR DE VERIFICACIÓN OFICIAL DE CÉDULA E INSCRIPCIÓN — IUAC', qrTextX, y + 36);

    ctx.fillStyle = '#000000';
    ctx.font = 'bold 18.5px Arial, sans-serif';
    ctx.fillText(`TITULAR: ${cedFormateada}  |  ${((reg.nom_alum || '') + ' ' + (reg.ape_alum || '')).trim().toUpperCase()}`, qrTextX, y + 68);

    ctx.fillStyle = '#1e293b';
    ctx.font = 'bold 16px Arial, sans-serif';
    ctx.fillText(`FOLIO: ${folio}   •   ESPECIALIDAD: ${carreraTexto}`, qrTextX, y + 100);

    ctx.fillStyle = '#166534';
    ctx.font = 'bold 15.5px Arial, sans-serif';
    ctx.fillText(`ACUSE RECIBO SMS: ${acuseRecibo}   •   NOTIFICADO A: ${telMovil}`, qrTextX, y + 132);

    ctx.fillStyle = '#334155';
    ctx.font = 'bold 14.5px Arial, sans-serif';
    ctx.fillText('Escanee el código QR en Captación para validar los datos del titular y el acuse de recibo institucional.', qrTextX, y + 166);
    ctx.fillText('Documento electrónico oficial generado en una (01) sola página por el Portal de Admisión IUAC.', qrTextX, y + 192);

    // Exportar como archivo PDF real de 1 sola página y descargarlo con nombre personalizado por aspirante (ced_alum)
    const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.92);
    const pdfBlob = crearBlobPDFDesdeJPEGDataURL(jpegDataUrl, W, H);
    const nombreArchivo = `planilla_pre-inscripcion-${cedNumRaw || 'aspirante'}.pdf`;

    const blobUrl = URL.createObjectURL(pdfBlob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = nombreArchivo;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 15000);
}

// ══════════════════════════════════════════════════════════════════════════════
// 4. VERIFICACIÓN BIOMÉTRICA MÓVIL (HUELLA DACTILAR / WEBAUTHN PLATFORM)
// ══════════════════════════════════════════════════════════════════════════════
async function verificarHuellaTitularMovil(cedulaStr) {
    // Detectar si es un dispositivo móvil o tablet con pantalla táctil
    const esMovil = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '') || (navigator.maxTouchPoints > 1);
    if (!esMovil) {
        return { ok: true, metodo: 'pc_escritorio' };
    }

    // Verificar si el navegador móvil tiene WebAuthn y sensor biométrico/huella configurado
    if (!window.PublicKeyCredential || typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable !== 'function') {
        return { ok: true, metodo: 'movil_sin_soporte_webauthn' };
    }

    let tieneBiometriaActiva = false;
    try {
        tieneBiometriaActiva = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch (e) {
        tieneBiometriaActiva = false;
    }

    // Si el teléfono no tiene huella configurada, permitir continuar sin bloquear al estudiante
    if (!tieneBiometriaActiva) {
        return { ok: true, metodo: 'movil_sin_huella_configurada' };
    }

    // Si el móvil SÍ tiene reconocimiento de huella/biometría activo, solicitar verificación del titular
    try {
        const challenge = new Uint8Array(32);
        window.crypto.getRandomValues(challenge);
        const userId = new TextEncoder().encode(`IUAC-${cedulaStr}`);

        await navigator.credentials.create({
            publicKey: {
                challenge: challenge,
                rp: {
                    name: 'IUAC - Portal Oficial de Preinscripción'
                },
                user: {
                    id: userId,
                    name: `V-${cedulaStr}`,
                    displayName: `Aspirante C.I. V-${cedulaStr}`
                },
                pubKeyCredParams: [
                    { type: 'public-key', alg: -7 },   // ES256
                    { type: 'public-key', alg: -257 }  // RS256
                ],
                authenticatorSelection: {
                    authenticatorAttachment: 'platform',
                    userVerification: 'required',
                    residentKey: 'discouraged'
                },
                timeout: 45000,
                attestation: 'none'
            }
        });

        return { ok: true, metodo: 'huella_verificada' };
    } catch (err) {
        // Si el usuario cancela explícitamente el lector de huella o falla la autenticación
        if (err && (err.name === 'NotAllowedError' || err.name === 'AbortError')) {
            return {
                ok: false,
                error: '🔒 Verificación de huella cancelada o no superada. Debe confirmar su identidad con la huella o desbloqueo del dispositivo para acceder a los datos de la planilla.'
            };
        }
        // Si el navegador rechaza por dominio local (ej. HTTP sin SSL en pruebas), permitir paso
        return { ok: true, metodo: 'fallback_entorno' };
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// 6. IMPRESIÓN Y DESCARGA DE CÉDULA EN CÓDIGO QR CON LOGO CENTRAL IUAC
// ══════════════════════════════════════════════════════════════════════════════
function imprimirTarjetaQRCedula(datos) {
    const reg = datos || window.ultimoRegistroAspirante || {};
    const cedula = reg.ced_alum || (document.getElementById('voucher-cedula') ? document.getElementById('voucher-cedula').textContent.replace(/[^\d]/g, '') : '');
    const tipoCed = reg.tipo_cedula || 'V';
    const nombre = (reg.nom_alum && reg.ape_alum) ? `${reg.nom_alum} ${reg.ape_alum}` : (document.getElementById('voucher-nombre') ? document.getElementById('voucher-nombre').textContent : 'Aspirante IUAC');
    const carreraCod = reg.carrera || '';
    const carreraNom = (window.MAPA_CARRERAS && window.MAPA_CARRERAS[carreraCod]) || (document.getElementById('voucher-carrera') ? document.getElementById('voucher-carrera').textContent : carreraCod);
    const folio = reg.folio || (document.getElementById('voucher-folio') ? document.getElementById('voucher-folio').textContent : `IUAC-2026-${cedula}`);
    const fecha = reg.fecha_registro || new Date().toLocaleDateString('es-VE');

    // Actualizar datos de la tarjeta / carnet en el modal
    const elCi = document.getElementById('carnet-ci');
    if (elCi) elCi.textContent = `${tipoCed}-${cedula}`;
    const elNom = document.getElementById('carnet-nombre');
    if (elNom) elNom.textContent = nombre;
    const elCar = document.getElementById('carnet-carrera');
    if (elCar) elCar.textContent = carreraNom;
    const elFol = document.getElementById('carnet-folio');
    if (elFol) elFol.textContent = folio;
    const elFec = document.getElementById('carnet-fecha');
    if (elFec) elFec.textContent = `${reg.est_alum || 'Aragua'} • ${fecha}`;

    // Payload de verificación oficial para la cédula QR
    const qrTexto = `IUAC-OFICIAL|CI:${tipoCed}-${cedula}|FOLIO:${folio}|ASPIRANTE:${nombre}|CARRERA:${carreraNom}|ESTADO:${reg.est_alum || 'VE'}`;

    const canvas = document.getElementById('carnet-qr-canvas');
    if (canvas) {
        dibujarQREnCanvas(canvas, qrTexto, 220, true);
    }

    const modal = document.getElementById('modal-carnet-qr');
    if (modal) {
        modal.style.display = 'flex';
    }
}

function imprimirCarnetQROficial() {
    const canvas = document.getElementById('carnet-qr-canvas');
    const qrDataUrl = canvas ? canvas.toDataURL('image/png') : '';
    const ci = document.getElementById('carnet-ci')?.textContent || '';
    const nombre = document.getElementById('carnet-nombre')?.textContent || '';
    const carrera = document.getElementById('carnet-carrera')?.textContent || '';
    const folio = document.getElementById('carnet-folio')?.textContent || '';
    const fecha = document.getElementById('carnet-fecha')?.textContent || '';

    const ventana = window.open('', '_blank', 'width=520,height=680');
    if (!ventana) {
        alert('Por favor permita ventanas emergentes para imprimir la cédula QR.');
        return;
    }

    ventana.document.write(`
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Cédula QR de Preinscripción IUAC - ${ci}</title>
    <style>
        body {
            font-family: Arial, Helvetica, sans-serif;
            margin: 0;
            padding: 24px;
            display: flex;
            justify-content: center;
            align-items: center;
            background: #ffffff;
            color: #0f172a;
        }
        .carnet-box {
            width: 360px;
            border: 2.5px solid #0f172a;
            border-radius: 12px;
            padding: 18px;
            text-align: center;
            box-sizing: border-box;
            background: #fff;
        }
        .header-sub {
            font-size: 7.5pt;
            font-weight: bold;
            color: #475569;
            text-transform: uppercase;
            line-height: 1.25;
        }
        .header-main {
            font-size: 10pt;
            font-weight: 900;
            color: #0f172a;
            margin-top: 4px;
        }
        .badge {
            display: inline-block;
            background: #b91c1c;
            color: #ffffff;
            font-size: 8pt;
            font-weight: 800;
            padding: 2px 8px;
            border-radius: 4px;
            margin-top: 4px;
            letter-spacing: 0.5px;
        }
        .qr-wrap {
            margin: 12px auto;
            width: 200px;
            height: 200px;
        }
        .qr-wrap img {
            width: 200px;
            height: 200px;
            border: 2px solid #0f172a;
            border-radius: 8px;
            display: block;
        }
        .table-data {
            width: 100%;
            background: #f8fafc;
            border: 1px solid #cbd5e1;
            border-radius: 6px;
            padding: 8px 10px;
            font-size: 8.5pt;
            line-height: 1.45;
            text-align: left;
            box-sizing: border-box;
        }
        .row {
            display: flex;
            justify-content: space-between;
            margin-bottom: 3px;
        }
        .row span { color: #64748b; font-weight: bold; }
        .row strong { color: #0f172a; text-align: right; }
        .footer-note {
            font-size: 7.2pt;
            color: #64748b;
            margin-top: 8px;
            font-style: italic;
        }
        @media print {
            body { padding: 0; }
            .no-print { display: none; }
        }
    </style>
</head>
<body>
    <div class="carnet-box">
        <div class="header-sub">
            República Bolivariana de Venezuela<br>
            Ministerio del Poder Popular para el Transporte
        </div>
        <div class="header-main">INSTITUTO UNIVERSITARIO DE AERONÁUTICA CIVIL</div>
        <div class="badge">CÉDULA QR DE PREINSCRIPCIÓN OFICIAL</div>

        <div class="qr-wrap">
            <img src="${qrDataUrl}" alt="Cédula QR IUAC">
        </div>

        <div class="table-data">
            <div class="row"><span>CÉDULA:</span><strong>${ci}</strong></div>
            <div class="row"><span>ASPIRANTE:</span><strong>${nombre}</strong></div>
            <div class="row"><span>CARRERA:</span><strong style="color:#b91c1c;">${carrera}</strong></div>
            <div class="row"><span>FOLIO:</span><strong>${folio}</strong></div>
            <div class="row"><span>EMISIÓN:</span><span>${fecha}</span></div>
        </div>

        <div class="footer-note">
            Presente este código QR al momento de consignar sus documentos ante el IUAC para su verificación inmediata.
        </div>

        <div class="no-print" style="margin-top:14px;">
            <button onclick="window.print()" style="background:#b91c1c; color:#fff; border:none; padding:8px 16px; border-radius:6px; font-weight:bold; cursor:pointer;">
                🖨️ Imprimir Ahora
            </button>
        </div>
    </div>
    <script>
        setTimeout(() => { window.print(); }, 400);
    </script>
</body>
</html>
    `);
    ventana.document.close();
}

function descargarCarnetQRPNG() {
    const canvas = document.getElementById('carnet-qr-canvas');
    if (!canvas) return;
    const ci = document.getElementById('carnet-ci')?.textContent?.replace(/[^\w]/g, '_') || 'IUAC';
    const link = document.createElement('a');
    link.download = `Cedula_QR_IUAC_${ci}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
}

window.generarMatrizQR = generarMatrizQR;
window.dibujarQREnCanvas = dibujarQREnCanvas;
window.descargarPlanillaPDFOficial = descargarPlanillaPDFOficial;
window.verificarHuellaTitularMovil = verificarHuellaTitularMovil;
window.imprimirTarjetaQRCedula = imprimirTarjetaQRCedula;
window.imprimirCarnetQROficial = imprimirCarnetQROficial;
window.descargarCarnetQRPNG = descargarCarnetQRPNG;
