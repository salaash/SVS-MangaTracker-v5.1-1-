// S.V.S Manga Tracker — auto chapter updater
(function () {
  let lastUrl = location.href;

  function notify() {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    try { chrome.runtime.sendMessage({ type: 'TAB_NAVIGATED', url: location.href }); } catch {}
  }

  // Intercept SPA navigation
  const _push = history.pushState.bind(history);
  const _replace = history.replaceState.bind(history);
  history.pushState = function (...a) { _push(...a); setTimeout(notify, 400); };
  history.replaceState = function (...a) { _replace(...a); setTimeout(notify, 400); };
  window.addEventListener('popstate', () => setTimeout(notify, 400));
})();
