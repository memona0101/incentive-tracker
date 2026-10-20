// Runs before first paint (classic script) so there's no light/dark flash.
(function () {
  var saved = null;
  try { saved = localStorage.getItem('it-theme'); } catch (e) { /* storage blocked */ }
  var dark = saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
})();
