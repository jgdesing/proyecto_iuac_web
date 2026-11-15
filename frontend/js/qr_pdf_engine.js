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

function dibujarQREnCanvas(canvas, texto, pixelSize = 180) {
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
        const img = new Image();
        if (!src.startsWith('data:')) {
            img.crossOrigin = 'anonymous';
        }
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = src;
    });
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
        dibujarQREnCanvas(domQrCanvas, qrPayload, 140);
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

    // Cargar logo IUAC y foto del aspirante (desde foto_base64, foto_alum en BD o captura en memoria)
    const srcFoto = reg.foto_base64 ||
                    (typeof reg.foto_alum === 'string' && reg.foto_alum.startsWith('data:image/') ? reg.foto_alum : null) ||
                    window.capturedPhotoBase64 ||
                    null;

    const [logoImg, fotoImg] = await Promise.all([
        cargarImagenPromesa('img/logo_iuac.png'),
        cargarImagenPromesa(srcFoto)
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
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2.5;
    ctx.strokeRect(fotoX, fotoY, fotoW, fotoH);

    if (fotoImg) {
        ctx.drawImage(fotoImg, fotoX + 2, fotoY + 2, fotoW - 4, fotoH - 4);
    } else {
        ctx.fillStyle = '#64748b';
        ctx.font = 'bold 14px Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('FOTO TIPO', fotoX + fotoW / 2, fotoY + 82);
        ctx.fillText('CARNET', fotoX + fotoW / 2, fotoY + 102);
    }

    // Textos centrales del encabezado
    const centerX = W / 2 - 10;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 16px Arial, sans-serif';
    ctx.fillText('REPÚBLICA BOLIVARIANA DE VENEZUELA', centerX, y + 20);
    ctx.font = 'bold 14px Arial, sans-serif';
    ctx.fillStyle = '#334155';
    ctx.fillText('MINISTERIO DEL PODER POPULAR PARA EL TRANSPORTE', centerX, y + 40);
    ctx.fillText('INSTITUTO NACIONAL DE AERONÁUTICA CIVIL (INAC)', centerX, y + 59);

    ctx.fillStyle = '#000000';
    ctx.font = '900 21px Arial, sans-serif';
    ctx.fillText('INSTITUTO UNIVERSITARIO DE AERONÁUTICA CIVIL', centerX, y + 86);
    ctx.font = 'italic bold 17px Arial, sans-serif';
    ctx.fillText('"MAYOR (AV) MIGUEL RODRÍGUEZ"', centerX, y + 109);

    // Subtítulo Departamento
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(centerX - 240, y + 118);
    ctx.lineTo(centerX + 240, y + 118);
    ctx.moveTo(centerX - 240, y + 140);
    ctx.lineTo(centerX + 240, y + 140);
    ctx.stroke();
    ctx.font = 'bold 14.5px Arial, sans-serif';
    ctx.fillStyle = '#0f172a';
    ctx.fillText('DEPARTAMENTO DE CAPTACIÓN, SELECCIÓN Y ADMISIÓN', centerX, y + 134);

    // Banda gris de título del documento
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(centerX - 335, y + 148, 670, 26);
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 15px Arial, sans-serif';
    ctx.fillText('PLANILLA OFICIAL DE PREINSCRIPCIÓN DE ASPIRANTES — CONVOCATORIA 2026-2027', centerX, y + 166);

    y += 192;

    // Línea divisoria superior
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(M, y);
    ctx.lineTo(W - M, y);
    ctx.stroke();
    y += 10;

    // Barra de Control Azul Oscuro
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(M, y, contentW, 34);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 15px Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`N° FOLIO: ${folio}`, M + 14, y + 22);
    ctx.textAlign = 'center';
    ctx.fillText(`FECHA EMISIÓN: ${fechaEmision}`, W / 2, y + 22);
    ctx.textAlign = 'right';
    ctx.fillText('CONDICIÓN: PREINSCRITO EN LÍNEA', W - M - 14, y + 22);
    y += 46;

    // Helper para dibujar secciones y celdas de tabla
    const drawSectionHeader = (titulo) => {
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(M, y, contentW, 28);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 14.5px Arial, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(titulo, M + 10, y + 19);
        y += 30;
    };

    const drawTableRow = (cols, rowH = 54, bg = '#ffffff') => {
        let curX = M;
        for (const col of cols) {
            const cellW = Math.round(contentW * col.w);
            ctx.fillStyle = col.bg || bg;
            ctx.fillRect(curX, y, cellW, rowH);
            ctx.strokeStyle = '#475569';
            ctx.lineWidth = 1.4;
            ctx.strokeRect(curX, y, cellW, rowH);

            ctx.textAlign = 'left';
            ctx.fillStyle = '#334155';
            ctx.font = 'bold 12.5px Arial, sans-serif';
            ctx.fillText(col.label, curX + 10, y + 18);

            ctx.fillStyle = col.valColor || '#000000';
            ctx.font = col.valFont || 'bold 15.5px Arial, sans-serif';
            const valStr = String(col.value || '--');
            ctx.fillText(valStr.slice(0, 82), curX + 10, y + 41);

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
        { w: 0.25, label: 'ESTADO CIVIL:', value: reg.est_civil_alum || 'Soltero/a' }
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
        { w: 0.50, label: 'LUGAR DE NACIMIENTO:', value: reg.lugar_nac_alum || '--' }
    ]);
    y += 12;

    // SECCIÓN 2: DATOS DE UBICACIÓN RESIDENCIAL Y CONTACTO
    drawSectionHeader('2. DATOS DE UBICACIÓN RESIDENCIAL Y CONTACTO');
    drawTableRow([
        { w: 0.33, label: 'ESTADO:', value: reg.est_alum || '--' },
        { w: 0.33, label: 'CIUDAD / MUNICIPIO:', value: reg.ciu_alum || '--' },
        { w: 0.34, label: 'PAÍS:', value: reg.pais_alum || 'Venezuela' }
    ]);
    drawTableRow([
        { w: 1.00, label: 'DIRECCIÓN DE HABITACIÓN:', value: reg.direc_alum || '--' }
    ]);
    drawTableRow([
        { w: 0.33, label: 'TELÉFONO MÓVIL:', value: reg.telemov_alum || '--' },
        { w: 0.33, label: 'TELÉFONO HABITACIÓN:', value: reg.telehabi_alum || 'No registrado' },
        { w: 0.34, label: 'CORREO ELECTRÓNICO:', value: reg.correo_alum || '--' }
    ]);
    y += 12;

    // SECCIÓN 3: ANTECEDENTES ACADÉMICOS Y CARRERA
    drawSectionHeader('3. ANTECEDENTES ACADÉMICOS Y ESPECIALIDAD DE POSTULACIÓN');
    drawTableRow([
        {
            w: 1.00,
            label: 'ESPECIALIDAD AERONÁUTICA DE POSTULACIÓN:',
            value: carreraTexto,
            bg: '#f1f5f9',
            valColor: '#0369a1',
            valFont: '900 18px Arial, sans-serif'
        }
    ], 58);
    drawTableRow([
        { w: 0.33, label: 'NIVEL ACADÉMICO:', value: reg.niv_acad_alum || 'Bachiller' },
        { w: 0.33, label: 'AÑO DE GRADUACIÓN:', value: String(reg.ano_grad_alum || '--') },
        { w: 0.34, label: 'TIPO DE INSTITUCIÓN:', value: reg.tipo_colegio || 'Público' }
    ]);
    drawTableRow([
        { w: 1.00, label: 'PLANTEL O INSTITUCIÓN DE EGRESO:', value: reg.inst_grad_alum || '--' }
    ]);
    y += 12;

    // SECCIÓN 4: RECAUDOS EXIGIDOS
    drawSectionHeader('4. RECAUDOS EXIGIDOS PARA LA CONSIGNACIÓN EN EL DEPARTAMENTO DE CAPTACIÓN');
    const recBoxH = 88;
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(M, y, contentW, recBoxH);
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1.4;
    ctx.strokeRect(M, y, contentW, recBoxH);

    ctx.fillStyle = '#0f172a';
    ctx.font = '13.5px Arial, sans-serif';
    ctx.textAlign = 'left';
    const col1X = M + 12;
    const col2X = M + Math.round(contentW / 2) + 10;
    ctx.fillText('[  ] 02 Fotocopias legibles de la C.I. ampliada a color.', col1X, y + 24);
    ctx.fillText('[  ] Calificaciones Certificadas de 1° a 4° o 5° año (original y copia).', col1X, y + 50);
    ctx.fillText('[  ] Copia legible de la Partida de Nacimiento.', col1X, y + 76);

    ctx.fillText('[  ] Fondo negro y copia del Título de Bachiller o Constancia de 5° Año.', col2X, y + 24);
    ctx.fillText('[  ] 02 Fotos tipo carnet en fondo blanco (recientes y formales).', col2X, y + 50);
    ctx.fillText('[  ] Comprobante de Registro del Sistema Nacional de Ingreso (SNI).', col2X, y + 76);
    y += recBoxH + 12;

    // SECCIÓN 5: DECLARACIÓN JURADA Y FIRMAS
    ctx.fillStyle = '#1e293b';
    ctx.font = 'italic 13px Arial, sans-serif';
    ctx.fillText('"Declaro bajo fe de juramento que todos los datos contenidos en esta planilla son fidedignos y que cumplo con la totalidad de los requisitos', M, y + 14);
    ctx.fillText('de admisión reglamentarios exigidos por el Instituto Universitario de Aeronáutica Civil (IUAC)."', M, y + 32);
    y += 44;

    const firmaW = Math.round((contentW - 28) / 2);
    const firmaH = 140;
    // Caja Firma Aspirante (Izquierda)
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1.6;
    ctx.strokeRect(M, y, firmaW, firmaH);

    ctx.beginPath();
    ctx.moveTo(M + 40, y + 82);
    ctx.lineTo(M + firmaW - 125, y + 82);
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 14px Arial, sans-serif';
    ctx.fillText('FIRMA DEL ASPIRANTE', M + (firmaW - 100) / 2, y + 102);
    ctx.font = '13px Arial, sans-serif';
    ctx.fillText(`C.I.: ${cedFormateada}`, M + (firmaW - 100) / 2, y + 122);

    // Casilla Huella Pulgar Derecho
    const huellaX = M + firmaW - 102;
    const huellaY = y + 14;
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = '#64748b';
    ctx.strokeRect(huellaX, huellaY, 88, 112);
    ctx.setLineDash([]);
    ctx.fillStyle = '#64748b';
    ctx.font = '11px Arial, sans-serif';
    ctx.fillText('Huella Pulgar', huellaX + 44, huellaY + 52);
    ctx.fillText('Derecho', huellaX + 44, huellaY + 68);

    // Caja Revisado y Recibido Por (Derecha)
    const revX = M + firmaW + 28;
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1.6;
    ctx.strokeRect(revX, y, firmaW, firmaH);

    ctx.beginPath();
    ctx.moveTo(revX + 60, y + 72);
    ctx.lineTo(revX + firmaW - 60, y + 72);
    ctx.stroke();

    ctx.fillStyle = '#000000';
    ctx.font = 'bold 14px Arial, sans-serif';
    ctx.fillText('REVISADO Y RECIBIDO POR:', revX + firmaW / 2, y + 92);
    ctx.font = '12.5px Arial, sans-serif';
    ctx.fillText('Depto. de Captación, Selección y Admisión IUAC', revX + firmaW / 2, y + 110);
    ctx.fillStyle = '#64748b';
    ctx.font = 'bold 11.5px Arial, sans-serif';
    ctx.fillText('SELLO INSTITUCIONAL / FECHA', revX + firmaW / 2, y + 129);

    y += firmaH + 16;

    // 6. FRANJA INFERIOR DE VERIFICACIÓN CON CÓDIGO QR DE LA CÉDULA DEL ASPIRANTE
    const qrFooterH = 148;
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(M, y, contentW, qrFooterH);
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1.8;
    ctx.strokeRect(M, y, contentW, qrFooterH);

    // Generar QR en canvas auxiliar e incrustarlo en la parte inferior
    const qrTempCanvas = document.createElement('canvas');
    dibujarQREnCanvas(qrTempCanvas, qrPayload, 132);
    ctx.drawImage(qrTempCanvas, M + 12, y + 8, 132, 132);

    // Texto explicativo junto al QR en el pie de la planilla
    const qrTextX = M + 162;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 15px Arial, sans-serif';
    ctx.fillText('CÓDIGO QR DE VERIFICACIÓN OFICIAL DE CÉDULA E INSCRIPCIÓN — IUAC', qrTextX, y + 32);

    ctx.fillStyle = '#0369a1';
    ctx.font = 'bold 15px Arial, sans-serif';
    ctx.fillText(`TITULAR: ${cedFormateada}  |  ${(reg.nom_alum || '')} ${(reg.ape_alum || '')}`.trim(), qrTextX, y + 58);

    ctx.fillStyle = '#334155';
    ctx.font = 'bold 13.5px Arial, sans-serif';
    ctx.fillText(`FOLIO OFICIAL: ${folio}   •   ESPECIALIDAD: ${carreraTexto}`, qrTextX, y + 84);

    ctx.fillStyle = '#475569';
    ctx.font = '12.5px Arial, sans-serif';
    ctx.fillText('Escanee este código QR al presentar su planilla en el Departamento de Captación para verificar los datos del titular.', qrTextX, y + 110);
    ctx.fillText('Documento electrónico oficial generado en una (01) sola página por el Portal de Preinscripción del IUAC.', qrTextX, y + 130);

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

window.generarMatrizQR = generarMatrizQR;
window.dibujarQREnCanvas = dibujarQREnCanvas;
window.descargarPlanillaPDFOficial = descargarPlanillaPDFOficial;
window.verificarHuellaTitularMovil = verificarHuellaTitularMovil;
