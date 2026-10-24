'use strict';

/**
 * Alle bestanden die bij een versie horen naast het origineel: automatische thumbnail, een zelf
 * gekozen frame en (fase D) afspeelversies. Gebruikt voor opslaggebruik, definitief verwijderen
 * en back-ups, zodat geen enkel bijbestand vergeten wordt.
 */
function sideFiles(db, ver) {
  const out = [];
  if (ver.has_poster) out.push({ key: `${ver.stored_name}.jpg`, kind: 'thumbnail', optional: !!ver.custom_poster });
  if (ver.custom_poster) out.push({ key: `${ver.stored_name}.custom.jpg`, kind: 'thumbnail' });
  // Afspeelversies (kwaliteiten): per niveau één mediabestand en één afspeellijst.
  for (const v of db.prepare('SELECT level FROM version_variants WHERE version_id = ?').all(ver.id)) {
    out.push({ key: `${ver.stored_name}.v${v.level}.m4s`, kind: 'variant' });
    out.push({ key: `${ver.stored_name}.v${v.level}.m3u8`, kind: 'variant' });
  }
  return out;
}

module.exports = { sideFiles };
