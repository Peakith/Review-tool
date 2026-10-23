'use strict';
const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { now } = require('../db');
const { HttpError } = require('../status');
const { intParam } = require('../access');
const { HEX, brandDto } = require('../client');
const { LOGO_MAX_BYTES, sniff, safeFileHeaders } = require('../files');

const LOGO_MIME = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };

/** Merken (Studio Brutaal, Moviemates): naam, accentkleur en logo voor de klantweergave. */
function brandRoutes(router, db, config, { access, storage }) {
  const getBrand = (id) => {
    const b = db.prepare('SELECT * FROM brands WHERE id = ?').get(intParam(id));
    if (!b) throw new HttpError(404, 'Merk niet gevonden');
    return b;
  };
  const dto = (b) => ({
    ...brandDto(db, b.id),
    accentColor: b.accent_color,
    projectCount: db.prepare('SELECT COUNT(*) AS n FROM projects WHERE brand_id = ? AND trashed_at IS NULL').get(b.id).n,
    updatedAt: b.updated_at,
  });

  router.get('/brands', (req, res) => {
    res.json(db.prepare('SELECT * FROM brands ORDER BY name').all().map(dto));
  });

  router.patch('/brands/:id', (req, res) => {
    access.requireAdmin(req);
    const b = getBrand(req.params.id);
    const name = req.body?.name !== undefined ? String(req.body.name).replace(/\s+/g, ' ').trim().slice(0, 80) : b.name;
    if (!name) throw new HttpError(400, 'Geef het merk een naam');
    const color = req.body?.accentColor !== undefined ? String(req.body.accentColor).trim().toLowerCase() : b.accent_color;
    if (!HEX.test(color)) throw new HttpError(400, 'Kies een accentkleur als hexcode, bijvoorbeeld #38c6b8');
    db.prepare('UPDATE brands SET name = ?, accent_color = ?, updated_at = ? WHERE id = ?').run(name, color, now(), b.id);
    res.json(dto(getBrand(b.id)));
  });

  // Logo: PNG, JPG of WebP tot 2 MB, als ruwe body. SVG is bewust niet toegestaan (kan scripts bevatten).
  router.put('/brands/:id/logo', express.raw({ type: () => true, limit: LOGO_MAX_BYTES }), async (req, res) => {
    access.requireAdmin(req);
    const b = getBrand(req.params.id);
    const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!buf.length) throw new HttpError(400, 'Kies een afbeelding voor het logo');
    const kind = sniff(buf);
    if (!LOGO_MIME[kind]) throw new HttpError(422, 'Het logo moet een PNG-, JPG- of WebP-afbeelding zijn (geen SVG).');
    storage.assertReady();
    const key = `brand-${b.id}-${crypto.randomBytes(8).toString('hex')}.${kind === 'jpeg' ? 'jpg' : kind}`;
    const tmp = path.join(os.tmpdir(), `${key}.part`);
    await fsp.writeFile(tmp, buf);
    try {
      await storage.importFile(tmp, key);
    } finally {
      await fsp.rm(tmp, { force: true });
    }
    db.prepare('UPDATE brands SET logo_key = ?, logo_mime = ?, updated_at = ? WHERE id = ?').run(key, LOGO_MIME[kind], now(), b.id);
    if (b.logo_key && b.logo_key !== key) await storage.remove(b.logo_key).catch(() => {});
    res.json(dto(getBrand(b.id)));
  });

  router.delete('/brands/:id/logo', async (req, res) => {
    access.requireAdmin(req);
    const b = getBrand(req.params.id);
    db.prepare('UPDATE brands SET logo_key = NULL, logo_mime = NULL, updated_at = ? WHERE id = ?').run(now(), b.id);
    if (b.logo_key) await storage.remove(b.logo_key).catch(() => {});
    res.json(dto(getBrand(b.id)));
  });
}

/** Het logo zelf is openbaar (het staat op elke klantpagina van dat merk). */
function brandLogoRoute(router, db, config, { storage }) {
  router.get('/brands/:id/logo', async (req, res) => {
    const b = db.prepare('SELECT * FROM brands WHERE id = ?').get(intParam(req.params.id));
    if (!b?.logo_key) throw new HttpError(404, 'Geen logo');
    await storage.send(res, b.logo_key, safeFileHeaders({ mime: b.logo_mime, filename: `${b.slug}-logo`, cache: 'public, max-age=86400' }));
  });
}

module.exports = { brandRoutes, brandLogoRoute };
