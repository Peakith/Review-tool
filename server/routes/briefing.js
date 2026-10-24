'use strict';
const { now } = require('../db');
const { HttpError } = require('../status');
const { intParam } = require('../access');
const { safeFileHeaders } = require('../files');

const KINDS = ['text', 'link', 'file'];

/**
 * Briefing en referenties per project. Elk onderdeel is intern (standaard) of gedeeld met de
 * klant. Rechten volgen het project: bekijken = lezen, uploaden = toevoegen/wijzigen/weggooien,
 * publiceren/delen = iets met de klant delen.
 */
function briefingRoutes(router, db, config, { access, storage, uploads }) {
  const userName = (id) => (id ? db.prepare('SELECT name FROM users WHERE id = ?').get(id)?.name || null : null);
  const dto = (b) => ({
    id: b.id,
    kind: b.kind,
    title: b.title,
    body: b.body,
    url: b.kind === 'link' ? b.url : null,
    visibility: b.visibility,
    file: b.kind === 'file' ? { name: b.file_name, mime: b.file_mime, size: b.file_size, url: `/api/briefing/${b.id}/file` } : null,
    createdBy: userName(b.created_by),
    createdAt: b.created_at,
    updatedAt: b.updated_at,
  });

  function getItem(req, need, opts = {}) {
    const item = db.prepare('SELECT * FROM briefing_items WHERE id = ?').get(intParam(req.params.id));
    if (!item) throw new HttpError(404, 'Onderdeel niet gevonden');
    const ctx = access.project(req, item.project_id, need, opts);
    if (item.trashed_at && !opts.allowTrashed) throw new HttpError(410, 'Dit onderdeel staat in de prullenbak. Een beheerder kan het terugzetten.');
    return { item, ...ctx };
  }

  const visibilityOf = (value) => {
    if (value === undefined) return undefined;
    if (!['internal', 'client'].includes(value)) throw new HttpError(400, 'Onbekende zichtbaarheid');
    return value;
  };
  const assertMayShare = (level, visibility) => {
    if (visibility === 'client' && !['publish', 'manage'].includes(level)) {
      throw new HttpError(403, 'Delen met de klant vraagt het recht “Publiceren en delen”. Het onderdeel kan wel intern blijven.');
    }
  };

  function cleanUrl(value) {
    const raw = String(value || '').trim();
    let u;
    try { u = new URL(raw); } catch { throw new HttpError(400, 'Vul een volledige link in, beginnend met https://'); }
    if (!['http:', 'https:'].includes(u.protocol)) throw new HttpError(400, 'Alleen links die beginnen met http:// of https:// zijn toegestaan.');
    return u.toString().slice(0, 2000);
  }
  const cleanTitle = (value) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 200);

  router.get('/projects/:id/briefing', (req, res) => {
    const { project: p, level } = access.project(req, req.params.id, 'view');
    const items = db.prepare('SELECT * FROM briefing_items WHERE project_id = ? AND trashed_at IS NULL ORDER BY id').all(p.id).map(dto);
    res.json({ items, myLevel: level, archived: !!p.archived_at });
  });

  router.post('/projects/:id/briefing', async (req, res) => {
    const { project: p, level } = access.project(req, req.params.id, 'upload', { write: true });
    const body = req.body || {};
    const kind = KINDS.includes(body.kind) ? body.kind : null;
    if (!kind) throw new HttpError(400, 'Onbekend soort onderdeel');
    // Nieuwe onderdelen zijn standaard intern.
    const visibility = visibilityOf(body.visibility) || 'internal';
    assertMayShare(level, visibility);
    let title = cleanTitle(body.title);
    let text = '';
    let url = '';
    let file = null;
    if (kind === 'text') {
      text = String(body.body || '').trim().slice(0, 20000);
      if (!text) throw new HttpError(400, 'De briefing mag niet leeg zijn');
      title = title || 'Briefing';
    } else if (kind === 'link') {
      url = cleanUrl(body.url);
      title = title || new URL(url).hostname;
    } else {
      file = await uploads.finalizeAttachment(body.uploadId, req.user, p.id);
      title = title || file.name;
    }
    const at = now();
    const info = db.prepare(`INSERT INTO briefing_items (project_id, kind, title, body, url, visibility, file_key, file_name, file_mime, file_size, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(p.id, kind, title, text, url, visibility,
      file?.key ?? null, file?.name ?? null, file?.mime ?? null, file?.size ?? null, req.user.id, at, at);
    res.status(201).json(dto(db.prepare('SELECT * FROM briefing_items WHERE id = ?').get(Number(info.lastInsertRowid))));
  });

  router.patch('/briefing/:id', (req, res) => {
    const { item, level } = getItem(req, 'upload', { write: true });
    const body = req.body || {};
    const visibility = visibilityOf(body.visibility) ?? item.visibility;
    if (visibility !== item.visibility) assertMayShare(level, visibility);
    const title = body.title !== undefined ? cleanTitle(body.title) || item.title : item.title;
    let text = item.body;
    if (body.body !== undefined && item.kind === 'text') {
      text = String(body.body).trim().slice(0, 20000);
      if (!text) throw new HttpError(400, 'De briefing mag niet leeg zijn');
    }
    const url = body.url !== undefined && item.kind === 'link' ? cleanUrl(body.url) : item.url;
    db.prepare('UPDATE briefing_items SET title = ?, body = ?, url = ?, visibility = ?, updated_at = ? WHERE id = ?').run(title, text, url, visibility, now(), item.id);
    res.json(dto(db.prepare('SELECT * FROM briefing_items WHERE id = ?').get(item.id)));
  });

  // Naar de prullenbak (herstelbaar); het bestand blijft bewaard tot definitief verwijderen.
  router.delete('/briefing/:id', (req, res) => {
    const { item } = getItem(req, 'upload');
    db.prepare('UPDATE briefing_items SET trashed_at = ?, trashed_by = ? WHERE id = ?').run(now(), req.user.id, item.id);
    res.json({ ok: true, trashed: true });
  });

  router.get('/briefing/:id/file', async (req, res) => {
    const { item } = getItem(req, 'view');
    if (item.kind !== 'file') throw new HttpError(404, 'Dit onderdeel heeft geen bestand');
    await storage.send(res, item.file_key, safeFileHeaders({ mime: item.file_mime, filename: item.file_name, download: req.query.download === '1', cache: 'private, no-cache' }));
  });
}

module.exports = { briefingRoutes };
