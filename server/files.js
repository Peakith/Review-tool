'use strict';
const fsp = require('node:fs/promises');
const path = require('node:path');
const { HttpError } = require('./status');

/**
 * Bijlagen (briefing en referenties) en logo's. Alleen deze typen zijn toegestaan; de inhoud
 * wordt gecontroleerd aan de hand van de eerste bytes (niet alleen de extensie), en bestanden
 * worden nooit als HTML of script geserveerd (zie safeFileHeaders).
 */
const MB = 1024 ** 2;
const ATTACHMENT_TYPES = {
  pdf: { mime: 'application/pdf', group: 'document', maxBytes: 100 * MB },
  png: { mime: 'image/png', group: 'image', maxBytes: 30 * MB },
  jpg: { mime: 'image/jpeg', group: 'image', maxBytes: 30 * MB },
  jpeg: { mime: 'image/jpeg', group: 'image', maxBytes: 30 * MB },
  webp: { mime: 'image/webp', group: 'image', maxBytes: 30 * MB },
  gif: { mime: 'image/gif', group: 'image', maxBytes: 30 * MB },
  // Referentievideo's: grens is de algemene uploadgrens (MAX_UPLOAD_GB).
  mp4: { mime: 'video/mp4', group: 'video', maxBytes: null },
  m4v: { mime: 'video/mp4', group: 'video', maxBytes: null },
  mov: { mime: 'video/quicktime', group: 'video', maxBytes: null },
  webm: { mime: 'video/webm', group: 'video', maxBytes: null },
};
const LOGO_TYPES = ['png', 'jpg', 'jpeg', 'webp'];
const LOGO_MAX_BYTES = 2 * MB;

const GROUP_LABELS = { document: 'PDF', image: 'afbeelding', video: 'video' };
const ALLOWED_TEXT = 'PDF, afbeelding (PNG, JPG, WebP, GIF) of video (MP4, MOV, WebM)';

const attachmentExt = (filename) => {
  const ext = path.extname(String(filename || '')).slice(1).toLowerCase();
  return ATTACHMENT_TYPES[ext] ? ext : null;
};

/** Controleert type en grootte vóór de upload begint. */
function checkAttachment(filename, size, maxUploadBytes) {
  const ext = attachmentExt(filename);
  if (!ext) throw new HttpError(400, `Dit bestandstype is niet toegestaan als bijlage. Toegestaan: ${ALLOWED_TEXT}.`);
  const type = ATTACHMENT_TYPES[ext];
  const max = type.maxBytes || maxUploadBytes;
  if (size > max) throw new HttpError(413, `Deze ${GROUP_LABELS[type.group]} is te groot (maximaal ${Math.round(max / MB)} MB).`);
  return ext;
}

/** Herkent het werkelijke bestandstype aan de eerste bytes. */
function sniff(buf) {
  const ascii = (start, end) => buf.subarray(start, end).toString('latin1');
  if (ascii(0, 5) === '%PDF-') return 'pdf';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a') return 'gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp';
  if (ascii(4, 8) === 'ftyp') return ascii(8, 10) === 'qt' ? 'mov' : 'mp4';
  if (buf.length >= 4 && buf.readUInt32BE(0) === 0x1a45dfa3) return 'webm';
  return null;
}
const SAME = { jpg: 'jpeg', jpeg: 'jpeg', mp4: 'mp4', m4v: 'mp4', mov: 'mp4', png: 'png', gif: 'gif', webp: 'webp', webm: 'webm', pdf: 'pdf' };

/** Klopt de inhoud met de extensie? Gooit 422 met een begrijpelijke melding. */
async function verifyContent(file, ext) {
  const fh = await fsp.open(file, 'r');
  let buf;
  try {
    buf = Buffer.alloc(16);
    await fh.read(buf, 0, 16, 0);
  } finally {
    await fh.close();
  }
  const found = sniff(buf);
  // mp4/m4v/mov delen dezelfde containerfamilie (ISO-BMFF); dat telt als overeenkomend.
  const same = found && (SAME[found] === SAME[ext] || (found === 'mov' && SAME[ext] === 'mp4'));
  if (!same) {
    throw new HttpError(422, `De inhoud van dit bestand is geen geldige ${GROUP_LABELS[ATTACHMENT_TYPES[ext].group]} (.${ext}). Controleer het bestand of exporteer het opnieuw.`);
  }
}

/**
 * Headers voor het serveren van geüploade bestanden: het opgegeven (gecontroleerde) type, nooit
 * HTML; een sandbox-CSP zodat een bestand dat toch rechtstreeks geopend wordt geen scripts kan
 * uitvoeren of de app kan aanspreken; en een nette bestandsnaam.
 */
function safeFileHeaders({ mime, filename, download = false, cache = 'private, no-store' }) {
  const ascii = String(filename || 'bestand').replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '');
  return {
    'Content-Type': mime,
    'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename || 'bestand')}`,
    'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; object-src 'self'; sandbox",
    'Cache-Control': cache,
    'Cross-Origin-Resource-Policy': 'same-origin',
  };
}

module.exports = { ATTACHMENT_TYPES, LOGO_TYPES, LOGO_MAX_BYTES, ALLOWED_TEXT, attachmentExt, checkAttachment, sniff, verifyContent, safeFileHeaders };
