/* ==============================================================================
   IUAC — SELECTOR DE TEMA DE COLOR (Rojo predeterminado · Azul claro · Ocre claro)
   Compartido por index.html y admin.html. La elección se guarda en localStorage.
   NOTA: el tema se aplica antes de pintar mediante un pequeño script inline en <head>.
   ============================================================================== */
(function () {
    'use strict';

    var STORAGE_KEY = 'iuac_tema_color';
    var TEMAS = ['rojo', 'azul', 'ocre'];
    var PREDETERMINADO = 'rojo';
    var THEME_COLOR_META = { rojo: '#212121', azul: '#212121', ocre: '#212121' };

    function leerTema() {
        try {
            var t = localStorage.getItem(STORAGE_KEY);
            return TEMAS.indexOf(t) !== -1 ? t : PREDETERMINADO;
        } catch (e) {
            return PREDETERMINADO;
        }
    }

    function aplicarTema(tema) {
        if (TEMAS.indexOf(tema) === -1) tema = PREDETERMINADO;
        if (tema === PREDETERMINADO) {
            document.documentElement.removeAttribute('data-theme');
        } else {
            document.documentElement.setAttribute('data-theme', tema);
        }
        try { localStorage.setItem(STORAGE_KEY, tema); } catch (e) { /* modo privado */ }

        var meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', THEME_COLOR_META[tema]);

        var botones = document.querySelectorAll('.theme-btn[data-theme-value]');
        for (var i = 0; i < botones.length; i++) {
            var activo = botones[i].getAttribute('data-theme-value') === tema;
            botones[i].classList.toggle('active', activo);
            botones[i].setAttribute('aria-pressed', activo ? 'true' : 'false');
        }
    }

    window.IUACTema = { aplicar: aplicarTema, actual: leerTema };

    document.addEventListener('DOMContentLoaded', function () {
        aplicarTema(leerTema());
        document.addEventListener('click', function (ev) {
            var btn = ev.target.closest ? ev.target.closest('.theme-btn[data-theme-value]') : null;
            if (btn) aplicarTema(btn.getAttribute('data-theme-value'));
        });
    });
})();
