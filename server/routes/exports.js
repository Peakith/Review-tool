'use strict';
const { HttpError } = require('../status');
const { contentDisposition } = require('../media');
const { collect, toCsv, toPdf } = require('../export');

/**
 * Feedback exporteren als PDF of CSV.
 *  - team:   /projects/:id/export.pdf|csv?videos=1,2&intern=1  en  /videos/:id/export.pdf|csv
 *  - klant:  /review/:token/export.pdf|csv  en  /portal/:token/export.pdf|csv
 * Klanten krijgen nooit interne gegevens, ongeacht de parameters.
 */
function exportRoutes(router, db, config, { access, storage, mode }) {
  const FORMATS = { pdf: 'application/pdf', csv: 'text/csv; charset=utf-8' };
  const safeName = (s) => String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80);

  async function send(req, res, { project, videos, includeInternal }) {
    const format = req.params.format;
    if (!FORMATS[format]) throw new HttpError(404, 'Onbekend exportformaat');
    if (!videos.length) throw new HttpError(400, 'Kies minstens één video om te exporteren.');
    const data = collect(db, { project, videos, includeInternal });
    const name = `Feedback - ${safeName(project.name)} - ${videos.length === 1 ? safeName(videos[0].title) : `${videos.length} video's`}${includeInternal ? ' - INTERN' : ''}.${format}`;
    const body = format === 'csv' ? Buffer.from(toCsv(data, { sep: req.query.scheiding === 'komma' ? ',' : ';' }), 'utf8') : await toPdf(data, { storage, tools: config.tools });
    res.set({ 'Content-Type': FORMATS[format], 'Content-Disposition': contentDisposition(name), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
    res.send(body);
  }

  if (mode === 'team') {
    router.get('/projects/:id/export.:format', async (req, res) => {
      const { project } = access.project(req, req.params.id, 'view');
      const all = db.prepare('SELECT * FROM videos WHERE project_id = ? AND trashed_at IS NULL ORDER BY created_at, id').all(project.id);
      let videos = all;
      if (req.query.videos) {
        const ids = String(req.query.videos).split(',').map(Number);
        videos = all.filter((v) => ids.includes(v.id));
        if (videos.length !== new Set(ids).size) throw new HttpError(404, 'Een gekozen video bestaat niet (meer) in dit project.');
      }
      await send(req, res, { project, videos, includeInternal: req.query.intern === '1' });
    });
    router.get('/videos/:id/export.:format', async (req, res) => {
      const { video, project } = access.video(req, req.params.id, 'view');
      await send(req, res, { project, videos: [video], includeInternal: req.query.intern === '1' });
    });
  } else {
    // Klantlinks: req.video/req.project zijn al gecontroleerd door de middleware van review/portaal.
    router.get('/review/:token/export.:format', async (req, res) => {
      await send(req, res, { project: req.project, videos: [req.video], includeInternal: false });
    });
    router.get('/portal/:token/export.:format', async (req, res) => {
      const published = db.prepare(`SELECT v.* FROM videos v WHERE v.project_id = ? AND v.trashed_at IS NULL
        AND EXISTS (SELECT 1 FROM versions ver WHERE ver.video_id = v.id AND ver.shared_at IS NOT NULL AND ver.trashed_at IS NULL) ORDER BY v.created_at, v.id`).all(req.project.id);
      await send(req, res, { project: req.project, videos: published, includeInternal: false });
    });
  }
}

module.exports = { exportRoutes };
