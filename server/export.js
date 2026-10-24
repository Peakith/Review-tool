'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const PDFDocument = require('pdfkit');
const { STATUSES } = require('./status');
const { videoMeta } = require('./client');
const { resolveTools } = require('./media');

/**
 * Feedbackexport (PDF en CSV) voor één of meer video's binnen een project.
 *
 * Standaard (en voor klanten altijd): alleen gepubliceerde versies, alleen reacties die de klant
 * mag zien, zonder taken of interne toelichting. Met includeInternal (alleen team, expliciet):
 * ook interne notities, taken en niet-gepubliceerde versies; de export wordt dan duidelijk als
 * INTERN gemarkeerd (titel, elke pagina, bestandsnaam en een kolom in de CSV).
 */
const ROLE = { team: 'Team', guest: 'Klant', approver: 'Akkoordgever' };
const TASK_STATUS = { open: 'Open', in_progress: 'Bezig', done: 'Afgehandeld' };
const PRIORITY = { high: 'Hoog', normal: 'Normaal', low: 'Laag' };
const TZ = process.env.DISPLAY_TZ || 'Europe/Amsterdam';

const fmtDate = (iso) => (iso ? new Intl.DateTimeFormat('nl-NL', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)).replace(',', '') : '');
const fmtDeadline = (iso) => (iso ? new Intl.DateTimeFormat('nl-NL', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }).format(new Date(iso)) : '');
const fmtDay = (day) => (day ? new Intl.DateTimeFormat('nl-NL', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${day}T12:00:00Z`)) : '');
function tc(sec) {
  if (sec === null || sec === undefined) return '';
  const s = Math.max(0, Math.floor(sec));
  const p = (n) => String(n).padStart(2, '0');
  return s >= 3600 ? `${Math.floor(s / 3600)}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}` : `${Math.floor(s / 60)}:${p(s % 60)}`;
}

/** Verzamelt wat er geëxporteerd mag worden. videos: rijen uit de tabel videos (zelfde project). */
function collect(db, { project, videos, includeInternal = false }) {
  const out = [];
  for (const v of videos) {
    const versions = db.prepare(`SELECT * FROM versions WHERE video_id = ? AND trashed_at IS NULL ${includeInternal ? '' : 'AND shared_at IS NOT NULL'} ORDER BY number`).all(v.id);
    const vs = versions.map((ver) => {
      const round = ver.round_id ? db.prepare('SELECT * FROM review_rounds WHERE id = ?').get(ver.round_id) : null;
      const rows = db.prepare(`SELECT * FROM comments WHERE version_id = ? ${includeInternal ? '' : 'AND internal = 0'} ORDER BY created_at, id`).all(ver.id);
      const roots = rows.filter((c) => !c.parent_id).sort((a, b) => (a.timecode ?? Infinity) - (b.timecode ?? Infinity) || a.id - b.id);
      const comments = roots.map((c, i) => {
        const task = includeInternal ? db.prepare('SELECT t.*, u.name AS assignee FROM comment_tasks t LEFT JOIN users u ON u.id = t.assignee_id WHERE t.comment_id = ?').get(c.id) : null;
        const pending = c.author_type !== 'team' && !c.round_id && ver.status !== 'approved';
        const status = task ? TASK_STATUS[task.status] : c.resolved_at ? 'Afgehandeld' : pending ? 'Nog niet verstuurd' : 'Open';
        return {
          nr: i + 1, id: c.id, timecode: c.timecode, timecodeEnd: c.timecode_end, author: c.author_name, role: ROLE[c.author_type] || c.author_type,
          createdAt: c.created_at, body: c.body, status, internal: !!c.internal, annotation: c.annotation ? JSON.parse(c.annotation) : null,
          task: task ? { status: TASK_STATUS[task.status], assignee: task.assignee || (task.unassigned_note ? `niet toegewezen (${task.unassigned_note})` : 'niet toegewezen'), priority: PRIORITY[task.priority], due: task.due_date || '', note: task.note } : null,
          replies: rows.filter((r) => r.parent_id === c.id).map((r) => ({ author: r.author_name, role: ROLE[r.author_type] || r.author_type, createdAt: r.created_at, body: r.body, internal: !!r.internal })),
        };
      });
      return {
        id: ver.id, number: ver.number, status: STATUSES[ver.status], shared: !!ver.shared_at, sharedAt: ver.shared_at, changeNote: ver.change_note || '',
        round: round ? { number: round.number, deadline: round.deadline_at } : null, duration: ver.duration_seconds, width: ver.width, height: ver.height, storedName: ver.stored_name, comments,
      };
    });
    out.push({ id: v.id, title: v.title, meta: videoMeta(v, versions.at(-1)), versions: vs });
  }
  const brand = project.brand_id ? db.prepare('SELECT * FROM brands WHERE id = ?').get(project.brand_id) : null;
  return { project: { name: project.name, client: project.client_name }, brand, videos: out, internal: includeInternal, generatedAt: new Date().toISOString() };
}

// ---------- CSV ----------

/** Een cel: altijd tussen aanhalingstekens; formules uit ingevoerde tekst worden onschadelijk gemaakt. */
function cell(value) {
  let s = value === null || value === undefined ? '' : String(value);
  // Spreadsheets voeren tekst die met = + - @ (of tab/CR) begint uit als formule.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

function toCsv(data, { sep = ';' } = {}) {
  const head = ['Project', 'Video', 'Versie', 'Reviewronde', 'Versiestatus', 'Nr', 'Soort', 'Auteur', 'Rol', `Datum (${TZ})`, 'Tijdcode', 'Tot', 'Reactie', 'Afhandelstatus', 'Tekening'];
  if (data.internal) head.push('Zichtbaarheid', 'Taakstatus', 'Verantwoordelijke', 'Prioriteit', 'Deadline taak', 'Interne toelichting');
  const lines = [head.map(cell).join(sep)];
  for (const v of data.videos) {
    for (const ver of v.versions) {
      for (const c of ver.comments) {
        const base = [data.project.name, v.title, ver.number, ver.round?.number ?? '', ver.status];
        const row = [...base, c.nr, 'Reactie', c.author, c.role, fmtDate(c.createdAt), tc(c.timecode) || 'algemeen', tc(c.timecodeEnd), c.body, c.status, c.annotation ? 'ja' : 'nee'];
        if (data.internal) row.push(c.internal ? 'Intern' : 'Zichtbaar voor klant', c.task?.status ?? '', c.task?.assignee ?? '', c.task?.priority ?? '', c.task?.due ?? '', c.task?.note ?? '');
        lines.push(row.map(cell).join(sep));
        for (const r of c.replies) {
          const rr = [...base, `${c.nr}.`, `Antwoord op ${c.nr}`, r.author, r.role, fmtDate(r.createdAt), '', '', r.body, '', ''];
          if (data.internal) rr.push(r.internal ? 'Intern' : 'Zichtbaar voor klant', '', '', '', '', '');
          lines.push(rr.map(cell).join(sep));
        }
      }
    }
  }
  // UTF-8 met BOM, zodat Excel en Numbers ë, é, — en € goed tonen; CRLF volgens RFC 4180.
  return `﻿${lines.join('\r\n')}\r\n`;
}

// ---------- PDF ----------

const FONT = path.join(__dirname, 'fonts', 'DejaVuSans.ttf');
const FONT_BOLD = path.join(__dirname, 'fonts', 'DejaVuSans-Bold.ttf');

function run(cmd, args) {
  return new Promise((resolve, reject) => execFile(cmd, args, { encoding: 'buffer', maxBuffer: 20 * 1024 * 1024, timeout: 30_000 }, (err, stdout) => (err ? reject(err) : resolve(stdout))));
}

/** Videobeeld op een tijdstip als JPEG (voor reacties met een tekening). */
async function frameAt(file, seconds, ffmpeg) {
  if (!ffmpeg || !fs.existsSync(file)) return null;
  try {
    return await run(ffmpeg, ['-v', 'error', '-ss', String(Math.max(0, seconds || 0)), '-i', file, '-frames:v', '1', '-vf', 'scale=960:-2', '-f', 'image2', '-c:v', 'mjpeg', 'pipe:1']);
  } catch { return null; }
}

/** Logo als PNG/JPEG (WebP wordt via ffmpeg omgezet). */
async function logoBuffer(brand, storage, ffmpeg) {
  if (!brand?.logo_key) return null;
  const file = storage.localPath(brand.logo_key);
  if (!fs.existsSync(file)) return null;
  if (brand.logo_mime === 'image/webp') {
    if (!ffmpeg) return null;
    try { return await run(ffmpeg, ['-v', 'error', '-i', file, '-f', 'image2', '-c:v', 'png', 'pipe:1']); } catch { return null; }
  }
  return fs.readFileSync(file);
}

const hexRgb = (hex) => (/^#[0-9a-f]{6}$/i.test(hex || '') ? hex : '#6b5cff');

/** Tekening op een afbeelding in de PDF (coördinaten 0–1 t.o.v. het beeld). */
function drawShapes(doc, shapes, x, y, w, h) {
  const lw = Math.max(2, w / 130);
  doc.save().lineWidth(lw).lineCap('round').lineJoin('round');
  for (const s of shapes) {
    const P = ([px, py]) => [x + px * w, y + py * h];
    doc.strokeColor(s.c);
    if (s.t === 'pen') {
      const [x0, y0] = P(s.pts[0]);
      doc.moveTo(x0, y0);
      for (const p of s.pts.slice(1)) doc.lineTo(...P(p));
      doc.stroke();
    } else if (s.t === 'rect') {
      const [x1, y1] = P(s.a);
      const [x2, y2] = P(s.b);
      doc.rect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1)).stroke();
    } else if (s.t === 'arrow') {
      const [x1, y1] = P(s.a);
      const [x2, y2] = P(s.b);
      const ang = Math.atan2(y2 - y1, x2 - x1);
      const len = Math.max(lw * 4, Math.min(16, Math.hypot(x2 - x1, y2 - y1) * 0.35));
      doc.moveTo(x1, y1).lineTo(x2, y2).stroke();
      doc.moveTo(x2 - len * Math.cos(ang + 0.45), y2 - len * Math.sin(ang + 0.45)).lineTo(x2, y2).lineTo(x2 - len * Math.cos(ang - 0.45), y2 - len * Math.sin(ang - 0.45)).stroke();
    }
  }
  doc.restore();
}

async function toPdf(data, { storage, tools }) {
  const ffmpeg = (await resolveTools(tools)).ffmpeg;
  const accent = hexRgb(data.brand?.accent_color);
  const brandName = data.brand?.name || 'Studio Review';
  const logo = await logoBuffer(data.brand, storage, ffmpeg);
  const doc = new PDFDocument({ size: 'A4', margins: { top: 64, bottom: 56, left: 50, right: 50 }, bufferPages: true,
    info: { Title: `Feedback ${data.project.name}${data.internal ? ' (INTERN)' : ''}`, Author: brandName, Creator: 'Studio Review' } });
  doc.registerFont('r', FONT);
  doc.registerFont('b', FONT_BOLD);
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  const W = doc.page.width - 100;
  const grey = '#5f6368';
  const ink = '#1d1f23';

  // ---- Voorblad / kop ----
  doc.rect(0, 0, doc.page.width, 8).fill(accent);
  let y = 36;
  if (logo) {
    try { doc.image(logo, 50, y, { fit: [160, 40] }); y += 50; } catch { doc.font('b').fontSize(13).fillColor(ink).text(brandName, 50, y); y += 26; }
  } else { doc.font('b').fontSize(13).fillColor(ink).text(brandName, 50, y); y += 26; }
  if (data.internal) {
    doc.roundedRect(50, y, W, 30, 4).fill('#fde2df');
    doc.font('b').fontSize(11).fillColor('#a32116').text('INTERN — bevat interne notities en taken. Niet delen met de klant.', 62, y + 9, { width: W - 24 });
    y += 42;
  }
  doc.font('b').fontSize(20).fillColor(ink).text(`Feedback · ${data.project.name}`, 50, y, { width: W });
  doc.moveDown(0.2);
  doc.font('r').fontSize(10).fillColor(grey).text([data.project.client ? `Klant: ${data.project.client}` : null, `${data.videos.length} video${data.videos.length === 1 ? '' : '’s'}`, `Gemaakt op ${fmtDate(data.generatedAt)} (${TZ})`].filter(Boolean).join('  ·  '), { width: W });
  doc.moveDown(0.6);
  doc.font('r').fontSize(9).fillColor(grey).text(data.internal
    ? 'Deze export bevat alle versies (ook niet gepubliceerde), interne notities en taakgegevens.'
    : 'Deze export bevat alleen gepubliceerde versies en reacties die voor de klant zichtbaar zijn.', { width: W });

  const ensure = (need) => { if (doc.y + need > doc.page.height - doc.page.margins.bottom) doc.addPage(); };

  for (const v of data.videos) {
    ensure(80);
    doc.moveDown(1.2);
    const vy = doc.y;
    doc.rect(50, vy, 4, 22).fill(accent);
    doc.font('b').fontSize(15).fillColor(ink).text(v.title, 62, vy + 2, { width: W - 12 });
    const meta = [v.meta.kindLabel, v.meta.aspect, v.meta.channel].filter(Boolean).join(' · ');
    if (meta) doc.font('r').fontSize(9.5).fillColor(grey).text(meta, 62, doc.y, { width: W - 12 });
    if (!v.versions.length) { doc.moveDown(0.5).font('r').fontSize(10).fillColor(grey).text('Nog geen gepubliceerde versie.', 50, doc.y, { width: W }); continue; }

    for (const ver of v.versions) {
      ensure(60);
      doc.moveDown(0.8);
      doc.font('b').fontSize(11.5).fillColor(ink).text(`Versie ${ver.number}${ver.round ? ` · reviewronde ${ver.round.number}` : ''}`, 50, doc.y, { continued: true })
        .font('r').fillColor(grey).text(`   ${ver.status}${ver.shared ? ` · gepubliceerd ${fmtDate(ver.sharedAt)}` : ' · intern, niet gepubliceerd'}`);
      if (ver.round?.deadline) doc.font('r').fontSize(9).fillColor(grey).text(`Reactie gevraagd vóór ${fmtDeadline(ver.round.deadline)}`, { width: W });
      if (ver.changeNote) { doc.font('b').fontSize(9.5).fillColor(ink).text('Aangepast in deze versie: ', { continued: true }).font('r').text(ver.changeNote, { width: W }); }
      if (!ver.comments.length) { doc.font('r').fontSize(9.5).fillColor(grey).text('Geen reacties op deze versie.', { width: W }); continue; }
      doc.moveDown(0.3);

      for (const c of ver.comments) {
        ensure(c.annotation ? 220 : 54);
        const top = doc.y + 4;
        const when = c.timecode !== null && c.timecode !== undefined ? `${tc(c.timecode)}${c.timecodeEnd ? `–${tc(c.timecodeEnd)}` : ''}` : 'algemeen';
        // Kopregel: nummer, tijdcode, auteur, datum en status
        doc.roundedRect(50, top, 28, 16, 3).fill('#eef0f3');
        doc.font('b').fontSize(9).fillColor(ink).text(String(c.nr), 50, top + 3.5, { width: 28, align: 'center' });
        doc.font('b').fontSize(9.5).fillColor(accent === '#ffffff' ? ink : '#202124').text(`${when}`, 86, top + 3, { continued: true })
          .font('r').fillColor(grey).text(`   ${c.author} (${c.role}) · ${fmtDate(c.createdAt)}`, { continued: true })
          .font('b').fillColor(c.status === 'Afgehandeld' ? '#137333' : c.status === 'Open' ? '#b06000' : grey).text(`   ${c.status}`);
        if (data.internal && c.internal) doc.font('b').fontSize(8.5).fillColor('#a32116').text('INTERNE NOTITIE', 86, doc.y, { width: W - 36 });
        doc.font('r').fontSize(10).fillColor(ink).text(c.body || '(zie de tekening)', 86, doc.y + 2, { width: W - 36 });
        if (c.task) {
          doc.font('r').fontSize(9).fillColor('#174ea6').text(`Taak: ${c.task.status} · ${c.task.assignee} · prioriteit ${c.task.priority}${c.task.due ? ` · uiterlijk ${fmtDay(c.task.due)}` : ''}${c.task.note ? `\nToelichting: ${c.task.note}` : ''}`, 86, doc.y + 2, { width: W - 36 });
        }
        if (c.annotation?.shapes?.length) {
          const img = await frameAt(storage.localPath(ver.storedName), c.timecode, ffmpeg);
          const ratio = ver.width && ver.height ? ver.height / ver.width : 9 / 16;
          let iw = Math.min(300, W - 36);
          let ih = iw * ratio;
          if (ih > 260) { ih = 260; iw = ih / ratio; }
          ensure(ih + 16);
          const ix = 86;
          const iy = doc.y + 6;
          if (img) doc.image(img, ix, iy, { width: iw, height: ih }); else { doc.rect(ix, iy, iw, ih).fill('#2b2d31'); }
          drawShapes(doc, c.annotation.shapes, ix, iy, iw, ih);
          doc.rect(ix, iy, iw, ih).lineWidth(0.5).strokeColor('#c4c7cc').stroke();
          doc.y = iy + ih + 4;
          doc.font('r').fontSize(8).fillColor(grey).text(`Tekening op ${tc(c.timecode)}${img ? '' : ' (videobeeld niet beschikbaar)'}`, ix, doc.y, { width: iw });
        }
        for (const r of c.replies) {
          ensure(34);
          doc.font('b').fontSize(9).fillColor(ink).text(`↳ ${r.author}`, 100, doc.y + 4, { continued: true })
            .font('r').fillColor(grey).text(` (${r.role}) · ${fmtDate(r.createdAt)}${data.internal && r.internal ? ' · INTERN' : ''}`);
          doc.font('r').fontSize(9.5).fillColor(ink).text(r.body, 112, doc.y + 1, { width: W - 62 });
        }
        doc.moveDown(0.5);
        doc.moveTo(86, doc.y).lineTo(50 + W, doc.y).lineWidth(0.4).strokeColor('#e3e5e8').stroke();
      }
    }
  }

  // ---- Kop- en voettekst op elke pagina ----
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // Voettekst staat onder de marge; zonder dit zou pdfkit een lege extra pagina beginnen.
    const margin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const bottom = doc.page.height - 34;
    doc.font('r').fontSize(8).fillColor(grey);
    doc.text(`${brandName} · ${data.project.name}`, 50, bottom, { width: W / 2, lineBreak: false });
    doc.text(`Pagina ${i + 1} van ${range.count}`, 50 + W / 2, bottom, { width: W / 2, align: 'right', lineBreak: false });
    if (data.internal) {
      doc.font('b').fontSize(8).fillColor('#a32116').text('INTERN — niet delen met de klant', 50, 22, { width: W, align: 'right', lineBreak: false });
    }
    if (i > 0) doc.rect(0, 0, doc.page.width, 4).fill(accent);
    doc.page.margins.bottom = margin;
  }
  doc.end();
  return done;
}

module.exports = { collect, toCsv, toPdf, cell, fmtDate };
