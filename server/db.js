'use strict';
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  client_name TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);

-- De zichtbare titel hoort bij de video, niet bij een bestand.
CREATE TABLE IF NOT EXISTS videos (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  approver_name TEXT NOT NULL DEFAULT '',
  approver_email TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Technische bestandsgegevens per versie. stored_name verandert nooit.
CREATE TABLE IF NOT EXISTS versions (
  id INTEGER PRIMARY KEY,
  video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  original_filename TEXT NOT NULL,
  stored_name TEXT NOT NULL UNIQUE,
  extension TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  duration_seconds REAL,
  width INTEGER,
  height INTEGER,
  has_poster INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  shared_at TEXT,
  uploaded_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE (video_id, number)
);

CREATE TABLE IF NOT EXISTS status_events (
  id INTEGER PRIMARY KEY,
  version_id INTEGER NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  event TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_label TEXT NOT NULL,
  actor_user_id INTEGER REFERENCES users(id),
  share_link_id INTEGER REFERENCES share_links(id),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

-- Eén link per video blijft gelijk over versies heen. role: reviewer | approver.
CREATE TABLE IF NOT EXISTS share_links (
  id INTEGER PRIMARY KEY,
  video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  approver_name TEXT NOT NULL DEFAULT '',
  approver_email TEXT NOT NULL DEFAULT '',
  allow_download INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  revoked_by INTEGER REFERENCES users(id),
  last_used_at TEXT
);

CREATE TABLE IF NOT EXISTS feedback_rounds (
  id INTEGER PRIMARY KEY,
  version_id INTEGER NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
  share_link_id INTEGER REFERENCES share_links(id),
  reviewer_name TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0,
  message TEXT NOT NULL DEFAULT '',
  comment_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY,
  version_id INTEGER NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
  parent_id INTEGER REFERENCES comments(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  timecode REAL,
  author_name TEXT NOT NULL,
  author_type TEXT NOT NULL, -- team | guest | approver
  user_id INTEGER REFERENCES users(id),
  share_link_id INTEGER REFERENCES share_links(id),
  reviewer_key TEXT,
  round_id INTEGER REFERENCES feedback_rounds(id),
  resolved_at TEXT,
  resolved_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS approvals (
  id INTEGER PRIMARY KEY,
  version_id INTEGER NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
  share_link_id INTEGER NOT NULL REFERENCES share_links(id),
  approver_name TEXT NOT NULL,
  approver_email TEXT NOT NULL,
  ip TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS uploads (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  original_filename TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  received_bytes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

-- Toegang per project voor teamleden zonder beheerdersrol.
-- level: view (bekijken/reageren) < upload < publish (publiceren/delen) < manage (beheren)
CREATE TABLE IF NOT EXISTS project_members (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  level TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_id, user_id)
);

-- Merken voor de klantweergave (logo, naam, accentkleur). Een project kiest er één.
CREATE TABLE IF NOT EXISTS brands (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  accent_color TEXT NOT NULL,
  logo_key TEXT,
  logo_mime TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Eén stabiele link per project naar het klantportaal. Vervangen = oude intrekken + nieuwe maken.
CREATE TABLE IF NOT EXISTS project_links (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  revoked_by INTEGER REFERENCES users(id),
  last_used_at TEXT
);

-- Briefing en referenties per project: tekst, link of bestand; standaard intern.
CREATE TABLE IF NOT EXISTS briefing_items (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, -- text | link | file
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  visibility TEXT NOT NULL DEFAULT 'internal', -- internal | client
  file_key TEXT,
  file_name TEXT,
  file_mime TEXT,
  file_size INTEGER,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  trashed_at TEXT,
  trashed_by INTEGER
);

-- Reviewrondes per video. Een ronde ontstaat alleen bij publiceren, met een expliciete keuze van het team.
CREATE TABLE IF NOT EXISTS review_rounds (
  id INTEGER PRIMARY KEY,
  video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  deadline_at TEXT,            -- ISO 8601 (UTC); alleen informatief, verandert nooit een status
  client_note TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE (video_id, number)
);

-- Feedbacktaak: hooguit één per reactie (dus nooit dubbel bij opnieuw klikken of opnieuw proberen).
CREATE TABLE IF NOT EXISTS comment_tasks (
  id INTEGER PRIMARY KEY,
  comment_id INTEGER NOT NULL UNIQUE REFERENCES comments(id) ON DELETE CASCADE,
  assignee_id INTEGER REFERENCES users(id),
  priority TEXT NOT NULL DEFAULT 'normal',   -- low | normal | high
  due_date TEXT,                             -- JJJJ-MM-DD (een dag, geen tijdstip)
  status TEXT NOT NULL DEFAULT 'open',       -- open | in_progress | done
  note TEXT NOT NULL DEFAULT '',             -- interne toelichting
  unassigned_note TEXT,                      -- bijv. "Freek heeft geen toegang meer"
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by INTEGER REFERENCES users(id)
);

-- Eenmalige gegevensmigraties (zie migrate()).
CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_videos_project ON videos(project_id);
CREATE INDEX IF NOT EXISTS idx_briefing_project ON briefing_items(project_id);
CREATE INDEX IF NOT EXISTS idx_project_links_project ON project_links(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON comment_tasks(assignee_id);
CREATE INDEX IF NOT EXISTS idx_rounds_video ON review_rounds(video_id);
CREATE INDEX IF NOT EXISTS idx_versions_video ON versions(video_id);
CREATE INDEX IF NOT EXISTS idx_comments_version ON comments(version_id);
CREATE INDEX IF NOT EXISTS idx_events_version ON status_events(version_id);
`;

// Kolommen die later zijn toegevoegd; bestaande databases krijgen ze hier alsnog.
const COLUMNS = [
  ['feedback_rounds', 'request_id', 'TEXT'],
  ['approvals', 'request_id', 'TEXT'],
  ['comments', 'request_id', 'TEXT'],
  ['uploads', 'updated_at', 'TEXT'],
  // Rollen: bestaande accounts worden beheerder, zodat ze na de update alles blijven kunnen.
  ['users', 'role', "TEXT NOT NULL DEFAULT 'admin'"],
  ['users', 'disabled_at', 'TEXT'],
  // Archief en prullenbak (zacht verwijderen; bestanden blijven tot definitief verwijderen).
  ['projects', 'archived_at', 'TEXT'],
  ['projects', 'archived_by', 'INTEGER'],
  ['projects', 'trashed_at', 'TEXT'],
  ['projects', 'trashed_by', 'INTEGER'],
  ['videos', 'archived_at', 'TEXT'],
  ['videos', 'archived_by', 'INTEGER'],
  ['videos', 'trashed_at', 'TEXT'],
  ['videos', 'trashed_by', 'INTEGER'],
  ['versions', 'trashed_at', 'TEXT'],
  ['versions', 'trashed_by', 'INTEGER'],
  // Waarvoor een upload bedoeld is, zodat rechten al bij het begin gecontroleerd worden.
  ['uploads', 'project_id', 'INTEGER'],
  ['uploads', 'video_id', 'INTEGER'],
  // Bouwronde 2: klantportaal, merken, opleveringen, briefing en interne reacties.
  ['uploads', 'purpose', "TEXT NOT NULL DEFAULT 'video'"],
  ['projects', 'brand_id', 'INTEGER'],
  ['projects', 'portal_intro', "TEXT NOT NULL DEFAULT ''"],
  ['videos', 'kind', 'TEXT'],
  ['videos', 'aspect_ratio', 'TEXT'],
  ['videos', 'channel', "TEXT NOT NULL DEFAULT ''"],
  // Reviewlinks die automatisch bij een projectlink horen (één per video).
  ['share_links', 'project_link_id', 'INTEGER'],
  // Teamreacties: intern (alleen team) of zichtbaar voor de klant.
  ['comments', 'internal', 'INTEGER NOT NULL DEFAULT 0'],
  // Bouwronde 3: reviewrondes, tijdsbereiken en annotaties.
  ['projects', 'rounds_included', 'INTEGER'],
  ['videos', 'rounds_included', 'INTEGER'],
  ['versions', 'round_id', 'INTEGER'],
  ['versions', 'change_note', "TEXT NOT NULL DEFAULT ''"],
  ['versions', 'share_request_id', 'TEXT'],
  ['comments', 'timecode_end', 'REAL'],
  ['comments', 'annotation', 'TEXT'],
];

const DEFAULT_BRANDS = [
  ['studio-brutaal', 'Studio Brutaal', '#ff6a3d'],
  ['moviemates', 'Moviemates', '#38c6b8'],
];

/** Eenmalige stappen; elke stap draait precies één keer per database. */
const ONCE = {
  // Vóór deze versie zag de klant álle teamreacties op een gedeelde versie. Losse teamnotities
  // worden nu intern; antwoorden van het team op een klantreactie blijven zichtbaar voor de klant.
  'comments-internal-v1': (db) => db.exec("UPDATE comments SET internal = 1 WHERE author_type = 'team' AND parent_id IS NULL"),
  'brands-v1': (db) => {
    const at = new Date().toISOString();
    for (const [slug, name, color] of DEFAULT_BRANDS) {
      db.prepare('INSERT OR IGNORE INTO brands (slug, name, accent_color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(slug, name, color, at, at);
    }
  },
};

function migrate(db) {
  for (const [table, column, type] of COLUMNS) {
    const exists = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
    if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
  db.exec(`UPDATE uploads SET updated_at = created_at WHERE updated_at IS NULL;
    -- Een herhaald verzoek (zelfde request_id via dezelfde link) wordt maar één keer verwerkt.
    CREATE UNIQUE INDEX IF NOT EXISTS uq_rounds_request ON feedback_rounds(share_link_id, request_id) WHERE request_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_approvals_request ON approvals(share_link_id, request_id) WHERE request_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_comments_request ON comments(share_link_id, request_id) WHERE request_id IS NOT NULL;
    -- Per projectlink hooguit één afgeleide reviewlink per video.
    CREATE UNIQUE INDEX IF NOT EXISTS uq_share_links_portal ON share_links(project_link_id, video_id) WHERE project_link_id IS NOT NULL;`);
  for (const [key, step] of Object.entries(ONCE)) {
    if (db.prepare('SELECT 1 FROM app_meta WHERE key = ?').get(key)) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      step(db);
      db.prepare('INSERT INTO app_meta (key, value) VALUES (?, ?)').run(key, new Date().toISOString());
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

function openDb(config) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const db = new DatabaseSync(config.dbFile);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  migrate(db);

  db.tx = (fn) => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  };
  return db;
}

const now = () => new Date().toISOString();

module.exports = { openDb, now };
