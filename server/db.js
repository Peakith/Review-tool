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

CREATE INDEX IF NOT EXISTS idx_videos_project ON videos(project_id);
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
];

function migrate(db) {
  for (const [table, column, type] of COLUMNS) {
    const exists = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
    if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
  db.exec(`UPDATE uploads SET updated_at = created_at WHERE updated_at IS NULL;
    -- Een herhaald verzoek (zelfde request_id via dezelfde link) wordt maar één keer verwerkt.
    CREATE UNIQUE INDEX IF NOT EXISTS uq_rounds_request ON feedback_rounds(share_link_id, request_id) WHERE request_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_approvals_request ON approvals(share_link_id, request_id) WHERE request_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_comments_request ON comments(share_link_id, request_id) WHERE request_id IS NOT NULL;`);
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
