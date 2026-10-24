'use strict';
// Bouwronde 3, deel B: tijdsbereiken en annotaties (servercontrole en afscherming).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { makeVideo, startServer, client, rid, setupAdmin, sharedVideo } = require('./helpers');
const { cleanAnnotation, cleanTimes } = require('../server/annotations');

let srv;
let admin;
let s; // gedeelde video van 4 seconden
const key = { 'x-reviewer-key': 'annotatie-key-00000001' };
const drawing = { v: 1, shapes: [{ t: 'rect', c: '#ffd60a', a: [0.1, 0.2], b: [0.4, 0.5] }, { t: 'arrow', c: '#ff4d4f', a: [0.9, 0.9], b: [0.5, 0.5] }, { t: 'pen', c: '#4cc9f0', pts: [[0.1, 0.1], [0.12, 0.13], [0.15, 0.18]] }] };

before(async () => {
  srv = await startServer();
  admin = await setupAdmin(srv);
  s = await sharedVideo(admin, makeVideo(srv.dataDir, 'clip.mp4', 4), { name: 'Annotaties' });
});
after(() => srv.close());

const post = (body) => client(srv.base).post(`/api/review/${s.token}/versions/${s.versionId}/comments`, { authorName: 'Eva', requestId: rid(), ...body }, key);

test('tijdsbereik: geldige en ongeldige grenzen (klant en team)', async () => {
  const ok = await post({ body: 'Muziek zachter', timecode: 1, timecodeEnd: 3 });
  assert.equal(ok.status, 201);
  const row = srv.db.prepare('SELECT timecode, timecode_end FROM comments WHERE id = ?').get(ok.data.id);
  assert.deepEqual([row.timecode, row.timecode_end], [1, 3]);
  for (const [body, why] of [
    [{ timecode: 3, timecodeEnd: 2 }, 'eind vóór begin'],
    [{ timecode: 2, timecodeEnd: 2 }, 'eind = begin'],
    [{ timecode: 1, timecodeEnd: 1.1 }, 'te kort'],
    [{ timecode: 1, timecodeEnd: 60 }, 'na het einde van de video'],
    [{ timecodeEnd: 2 }, 'eind zonder begin'],
    [{ timecode: 'abc' }, 'geen getal'],
    [{ timecode: -1 }, 'negatief'],
    [{ timecode: 30 }, 'begin na het einde'],
  ]) {
    const r = await post({ body: 'x', ...body });
    assert.equal(r.status, 400, `${why}: ${JSON.stringify(r.data)}`);
    const t = await admin.post(`/api/versions/${s.versionId}/comments`, { body: 'x', ...body });
    assert.equal(t.status, 400, `team, ${why}`);
  }
  // Iets voorbij het einde door afronding wordt netjes begrensd
  const edge = await post({ body: 'Tot het eind', timecode: 2, timecodeEnd: 4.3 });
  assert.equal(edge.status, 201);
  const d = srv.db.prepare('SELECT duration_seconds FROM versions WHERE id = ?').get(s.versionId).duration_seconds;
  assert.equal(srv.db.prepare('SELECT timecode_end FROM comments WHERE id = ?').get(edge.data.id).timecode_end, d);
});

test('annotatie: opgeslagen bij reactie, versie en moment; ongeldige tekeningen geweigerd', async () => {
  const r = await post({ body: '', timecode: 2, annotation: drawing });
  assert.equal(r.status, 201, 'tekening zonder tekst mag');
  const stored = JSON.parse(srv.db.prepare('SELECT annotation FROM comments WHERE id = ?').get(r.data.id).annotation);
  assert.deepEqual(stored, drawing);
  const comments = (await client(srv.base).get(`/api/review/${s.token}/versions/${s.versionId}/comments`, key)).data;
  assert.deepEqual(comments.find((c) => c.id === r.data.id).annotation, drawing);
  for (const [annotation, why] of [
    [{ v: 1, shapes: [{ t: 'circle', a: [0, 0], b: [1, 1] }] }, 'onbekende vorm'],
    [{ v: 1, shapes: [{ t: 'rect', a: [0, 0], b: [3, 3] }] }, 'buiten het beeld'],
    [{ v: 1, shapes: [{ t: 'pen', pts: [[0.1, 0.1]] }] }, 'pen met één punt'],
    [{ v: 1, shapes: Array.from({ length: 41 }, () => ({ t: 'rect', a: [0, 0], b: [0.5, 0.5] })) }, 'te veel vormen'],
    ['geen json', 'geen JSON'],
  ]) {
    assert.equal((await post({ body: 'x', timecode: 1, annotation })).status, 400, why);
  }
  assert.equal((await post({ body: 'x', annotation: drawing })).status, 400, 'tekening zonder moment');
  assert.equal((await post({ body: '', timecode: 1 })).status, 400, 'leeg zonder tekening');
  // Normaliseren: afronden en kleine overschrijding naar de rand
  const n = JSON.parse(cleanAnnotation({ shapes: [{ t: 'arrow', c: '#000000', a: [0.123456, 1.01], b: [-0.01, 0.5] }] }));
  assert.deepEqual(n.shapes[0], { t: 'arrow', c: '#ff4d4f', a: [0.1235, 1], b: [0, 0.5] });
  assert.deepEqual(cleanTimes({ timecode: 1 }, 4), { timecode: 1, timecodeEnd: null });
});

test('zichtbaarheid: interne annotatie lekt niet naar de klant, ook niet via de voorbeeldweergave', async () => {
  const internal = await admin.post(`/api/versions/${s.versionId}/comments`, { body: 'Intern: deze shot vervangen', timecode: 1, annotation: drawing });
  assert.equal(internal.data.internal, true);
  const visible = await admin.post(`/api/versions/${s.versionId}/comments`, { body: 'Hier komt de titel', timecode: 2, annotation: { v: 1, shapes: [drawing.shapes[0]] }, internal: false });
  const seen = (await client(srv.base).get(`/api/review/${s.token}/versions/${s.versionId}/comments`, key)).data;
  assert.ok(!seen.some((c) => c.id === internal.data.id), 'interne reactie (met tekening) onzichtbaar');
  assert.deepEqual(seen.find((c) => c.id === visible.data.id).annotation.shapes.length, 1);
  const preview = (await admin.get(`/api/preview/videos/${s.videoId}/versions/${s.versionId}/comments`)).data;
  assert.ok(!preview.some((c) => c.id === internal.data.id));
  // Omzetten naar intern: tekening verdwijnt mee
  await admin.patch(`/api/comments/${visible.data.id}`, { internal: true });
  const after2 = JSON.stringify((await client(srv.base).get(`/api/review/${s.token}/versions/${s.versionId}/comments`, key)).data);
  assert.ok(!after2.includes('Hier komt de titel'));
  // Team ziet beide met tekening
  const team = (await admin.get(`/api/versions/${s.versionId}/comments`)).data;
  assert.ok(team.find((c) => c.id === internal.data.id).annotation);
});
