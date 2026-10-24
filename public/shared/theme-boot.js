// Zet het thema vóór de eerste weergave, zodat de pagina niet eerst in het verkeerde thema verschijnt.
// Voorkeur: van de server (teamaccount, data-theme-pref) of uit deze browser (bezoekers), anders donker.
(function () {
  try {
    var root = document.documentElement;
    var pref = root.getAttribute('data-theme-pref') || window.localStorage.getItem('rt-theme') || 'dark';
    var light = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    root.setAttribute('data-theme', pref === 'system' ? (light ? 'light' : 'dark') : pref === 'light' ? 'light' : 'dark');
  } catch (e) { /* geen opslag beschikbaar: donker */ }
}());
