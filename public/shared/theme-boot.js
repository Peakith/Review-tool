// Studio Review heeft één vaste donkere stijl (sinds 0.9.0). Oude themakeuzes uit eerdere versies
// (Licht/Systeem, bewaard in deze browser) worden opgeruimd en hebben geen effect meer.
(function () {
  document.documentElement.setAttribute('data-theme', 'dark');
  try { window.localStorage.removeItem('rt-theme'); } catch (e) { /* geen opslag: niets op te ruimen */ }
}());
