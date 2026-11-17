/**
 * react_ui_enhancer.js - Componente Reactivo de Interfaz y Animaciones de Botones (IUAC)
 * Implementa una barra reactiva de estado en vivo (progreso de campos, estado de fotografía
 * en carpeta fotos_aspirantes y paso activo) junto con efectos Ripple 3D en todos los botones.
 */

(function () {
    'use strict';

    // ── 1. MOTOR REACTIVO DE ESTADO PARA EL FORMULARIO IUAC ──────────────────
    const CAMPOS_CLAVE = [
        'asp-ced_alum',
        'asp-nom_alum',
        'asp-ape_alum',
        'asp-fec_nac_alum',
        'asp-lugar_nac_alum',
        'asp-est_alum',
        'asp-ciu_alum',
        'asp-direc_alum',
        'asp-telemov_alum',
        'asp-correo_alum',
        'asp-carrera',
        'asp-ano_grad_alum',
        'asp-inst_grad_alum'
    ];

    function calcularEstadoActual() {
        let completados = 0;
        CAMPOS_CLAVE.forEach((id) => {
            const el = document.getElementById(id);
            if (el && el.value && String(el.value).trim().length > 0 && !el.classList.contains('is-invalid')) {
                completados++;
            }
        });
        const tieneFoto = Boolean(window.capturedPhotoBase64);
        const total = CAMPOS_CLAVE.length;
        const porcentaje = Math.min(100, Math.round((completados / total) * 100));
        return { completados, total, porcentaje, tieneFoto };
    }

    function montarBarraReactivaIUAC() {
        const rootEl = document.getElementById('react-assistant-root');
        if (!rootEl) return;

        const render = () => {
            const { completados, total, porcentaje, tieneFoto } = calcularEstadoActual();
            const cedVal = (document.getElementById('asp-ced_alum')?.value || '').trim();
            const nomVal = (document.getElementById('asp-nom_alum')?.value || '').trim();
            const apeVal = (document.getElementById('asp-ape_alum')?.value || '').trim();
            const extVal = window.capturedPhotoExt || 'jpg';
            const nombrePersonalizado = (typeof window.construirNombreFotoPersonalizado === 'function')
                ? window.construirNombreFotoPersonalizado(cedVal, nomVal, apeVal, extVal)
                : `primer_nom_primer_ape-${cedVal || 'ced_aspirante'}.${extVal}`;
            const nombreArchivoFoto = `/fotos_aspirantes/${nombrePersonalizado}`;

            rootEl.innerHTML = `
                <div style="
                    background: linear-gradient(90deg, #1e1b4b 0%, #0f766e 60%, #312e81 100%);
                    color: #ecfeff;
                    padding: 0.7rem 1.4rem;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    flex-wrap: wrap;
                    gap: 0.75rem;
                    border-bottom: 2px solid #2dd4bf;
                    font-size: 0.82rem;
                ">
                    <div style="display:flex; align-items:center; gap:0.6rem;">
                        <span style="
                            background: rgba(45, 212, 191, 0.22);
                            border: 1px solid #5eead4;
                            color: #99f6e4;
                            padding: 0.18rem 0.6rem;
                            border-radius: 20px;
                            font-weight: 800;
                            font-size: 0.74rem;
                            letter-spacing: 0.4px;
                        ">⚛ UI REACTIVA</span>
                        <span style="font-weight:700; color:#e0e7ff;">
                            Avance de Ficha: <strong style="color:#5eead4;">${porcentaje}%</strong> (${completados}/${total} campos)
                        </span>
                    </div>

                    <div style="display:flex; align-items:center; gap:0.85rem; flex: 1; max-width: 340px; min-width: 200px;">
                        <div style="flex:1; height:8px; background:rgba(255,255,255,0.18); border-radius:10px; overflow:hidden;">
                            <div style="
                                width: ${porcentaje}%;
                                height: 100%;
                                background: linear-gradient(90deg, #2dd4bf 0%, #818cf8 100%);
                                border-radius: 10px;
                                transition: width 0.35s cubic-bezier(0.4, 0, 0.2, 1);
                            "></div>
                        </div>
                        <span style="
                            padding: 0.2rem 0.65rem;
                            border-radius: 14px;
                            font-weight: 800;
                            font-size: 0.75rem;
                            background: ${tieneFoto ? 'rgba(16, 185, 129, 0.28)' : 'rgba(255, 255, 255, 0.12)'};
                            border: 1px solid ${tieneFoto ? '#34d399' : 'rgba(255,255,255,0.25)'};
                            color: ${tieneFoto ? '#a7f3d0' : '#cbd5e1'};
                            white-space: nowrap;
                        " title="${tieneFoto ? 'Destino: ' + nombreArchivoFoto : 'Suba su fotografía tipo carnet'}">
                            ${tieneFoto ? '📷 Foto Lista' : '📷 Foto Opcional'}
                        </span>
                    </div>
                </div>
            `;
        };

        render();
        window.actualizarBarraReactivaIUAC = render;

        document.addEventListener('input', render);
        document.addEventListener('change', render);
    }

    // ── 2. EFECTO RIPPLE (ONDA REACTIVA) EN TODOS LOS BOTONES ────────────────
    function inicializarEfectoRippleBotones() {
        document.addEventListener('pointerdown', (e) => {
            const btn = e.target.closest('.btn, .btn-photo-action, .btn-carreras-hero, .btn-buscar-planilla-hero');
            if (!btn || btn.disabled) return;

            const rect = btn.getBoundingClientRect();
            const ripple = document.createElement('span');
            const size = Math.max(rect.width, rect.height);
            ripple.className = 'btn-ripple-wave';
            ripple.style.width = ripple.style.height = `${size}px`;
            ripple.style.left = `${e.clientX - rect.left - size / 2}px`;
            ripple.style.top = `${e.clientY - rect.top - size / 2}px`;

            btn.appendChild(ripple);
            setTimeout(() => {
                if (ripple.parentNode) ripple.parentNode.removeChild(ripple);
            }, 650);
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        montarBarraReactivaIUAC();
        inicializarEfectoRippleBotones();
    });
})();
