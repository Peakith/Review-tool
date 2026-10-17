'use strict';
const { STATUSES, EVENTS } = require('./status');

function versionDto(v) {
  return {
    id: v.id,
    videoId: v.video_id,
    number: v.number,
    status: v.status,
    statusLabel: STATUSES[v.status],
    sharedAt: v.shared_at,
    duration: v.duration_seconds,
    width: v.width,
    height: v.height,
    hasPoster: !!v.has_poster,
    mimeType: v.mime_type,
    createdAt: v.created_at,
  };
}

/** Technische bestandsgegevens: alleen voor het team. */
function versionFileDto(v) {
  return {
    originalFilename: v.original_filename,
    extension: v.extension,
    size: v.size_bytes,
  };
}

function commentDtos(db, versionId, { reviewerKey = null } = {}) {
  const rows = db.prepare(`SELECT c.*, u.name AS resolved_by_name FROM comments c
    LEFT JOIN users u ON u.id = c.resolved_by
    WHERE c.version_id = ? ORDER BY c.created_at, c.id`).all(versionId);
  const byId = new Map();
  const roots = [];
  for (const c of rows) {
    const dto = {
      id: c.id,
      parentId: c.parent_id,
      body: c.body,
      timecode: c.timecode,
      authorName: c.author_name,
      authorType: c.author_type,
      // "verified": identiteit is vastgesteld via teamaccount of persoonlijke akkoordlink.
      verified: c.author_type !== 'guest',
      pending: c.author_type !== 'team' && !c.round_id,
      mine: !!reviewerKey && c.reviewer_key === reviewerKey,
      resolved: !!c.resolved_at,
      resolvedAt: c.resolved_at,
      resolvedBy: c.resolved_by_name || null,
      createdAt: c.created_at,
      replies: [],
    };
    byId.set(c.id, dto);
    if (c.parent_id && byId.has(c.parent_id)) byId.get(c.parent_id).replies.push(dto);
    else roots.push(dto);
  }
  roots.sort((a, b) => (a.timecode ?? Infinity) - (b.timecode ?? Infinity) || a.id - b.id);
  return roots;
}

function eventDtos(db, versionId) {
  return db.prepare('SELECT * FROM status_events WHERE version_id = ? ORDER BY id').all(versionId).map((e) => ({
    id: e.id,
    from: e.from_status,
    fromLabel: e.from_status ? STATUSES[e.from_status] : null,
    to: e.to_status,
    toLabel: STATUSES[e.to_status],
    event: e.event,
    eventLabel: EVENTS[e.event],
    actorType: e.actor_type,
    actorLabel: e.actor_label,
    note: e.note,
    at: e.created_at,
  }));
}

function approvalDto(db, versionId) {
  const a = db.prepare('SELECT * FROM approvals WHERE version_id = ? ORDER BY id DESC LIMIT 1').get(versionId);
  return a ? { name: a.approver_name, email: a.approver_email, at: a.created_at } : null;
}

function roundDtos(db, versionId) {
  return db.prepare('SELECT * FROM feedback_rounds WHERE version_id = ? ORDER BY id').all(versionId).map((r) => ({
    id: r.id,
    reviewerName: r.reviewer_name,
    verified: !!r.verified,
    message: r.message,
    commentCount: r.comment_count,
    at: r.created_at,
  }));
}

module.exports = { versionDto, versionFileDto, commentDtos, eventDtos, approvalDto, roundDtos };
