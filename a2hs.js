// Ajout à l'écran d'accueil (mobile uniquement).
// Android/Chrome : on garde l'événement du navigateur et on l'ouvre au clic.
// iPhone/iPad : aucune API, on affiche seulement une aide.
// Les pages placent un bloc .a2hs-block (caché par défaut) et appellent majBoutonA2hs().
(function () {
  const ua = navigator.userAgent;
  const estIos = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const estMobile = estIos || /Android/.test(ua);
  let evt = null;

  const style = document.createElement('style');
  style.textContent = [
    '.a2hs-block { margin-top: 10px; text-align: center; }',
    '.btn-a2hs { width: 100%; padding: 13px; background: #fff8f5; color: #c4622d; font-size: 0.95rem; font-weight: 700; border: 1.5px solid #f0d8cc; border-radius: 12px; cursor: pointer; transition: background 0.15s; }',
    '.btn-a2hs:hover { background: #f0d8cc; }',
    '.a2hs-aide { padding: 13px; background: #fff8f5; color: #1a1714; font-size: 0.95rem; font-weight: 600; border: 1.5px solid #f0d8cc; border-radius: 12px; }'
  ].join('\n');
  document.head.appendChild(style);

  function estInstalle() {
    return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  }

  function disponible() {
    return estMobile && !estInstalle() && (!!evt || estIos);
  }

  window.majBoutonA2hs = function () {
    document.querySelectorAll('.a2hs-block').forEach(function (el) {
      el.style.display = disponible() ? 'block' : 'none';
    });
  };

  window.cliquerA2hs = async function () {
    if (typeof umami !== 'undefined') umami.track('a2hs-clique', { plateforme: evt ? 'android' : 'ios' });
    if (evt) {
      const e = evt;
      evt = null;
      e.prompt();
      await e.userChoice.catch(function () {});
      window.majBoutonA2hs();
    } else {
      document.querySelectorAll('.btn-a2hs').forEach(function (el) { el.style.display = 'none'; });
      document.querySelectorAll('.a2hs-aide').forEach(function (el) { el.style.display = 'block'; });
    }
  };

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    evt = e;
    window.majBoutonA2hs();
  });

  window.addEventListener('appinstalled', function () {
    evt = null;
    if (typeof umami !== 'undefined') umami.track('a2hs-installe');
    window.majBoutonA2hs();
  });

  document.addEventListener('DOMContentLoaded', window.majBoutonA2hs);
})();
