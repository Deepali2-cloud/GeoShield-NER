-- Migration 0005: Admin sessions and moderation audit (Phase 8).
--
-- Stores hashed session tokens for the single-admin authentication model
-- and an append-only audit trail of all moderation actions.

-- Server-side session store. Only SHA-256 hashes of opaque session tokens are stored.
CREATE TABLE admin_sessions (
  session_id_hash TEXT PRIMARY KEY NOT NULL CHECK (length(trim(session_id_hash)) > 0),
  admin_id TEXT NOT NULL DEFAULT 'admin',
  created_at TEXT NOT NULL, -- UTC ISO-8601
  expires_at TEXT NOT NULL, -- UTC ISO-8601
  revoked_at TEXT -- NULL if active, UTC ISO-8601 when logged out
);

CREATE INDEX idx_admin_sessions_expires ON admin_sessions (expires_at);
CREATE INDEX idx_admin_sessions_revoked ON admin_sessions (revoked_at);

-- Append-only audit trail for citizen report status changes.
CREATE TABLE moderation_audit (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
  report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  previous_status TEXT NOT NULL CHECK (previous_status IN ('pending', 'reviewed', 'resolved', 'rejected')),
  new_status TEXT NOT NULL CHECK (new_status IN ('reviewed', 'resolved', 'rejected')),
  admin_id TEXT NOT NULL DEFAULT 'admin',
  created_at TEXT NOT NULL -- UTC ISO-8601
);

CREATE INDEX idx_moderation_audit_report ON moderation_audit (report_id, created_at DESC);
CREATE INDEX idx_moderation_audit_created ON moderation_audit (created_at DESC);
