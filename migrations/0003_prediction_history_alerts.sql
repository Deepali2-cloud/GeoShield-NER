-- Migration 0003: Prediction history and in-app alerts (Phase 6).

-- Stores historical snapshots of risk predictions for deduplication and timeline.
CREATE TABLE prediction_history (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
  zone_id TEXT NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
  risk_score REAL NOT NULL,
  risk_level TEXT NOT NULL CHECK (risk_level IN ('LOW', 'MODERATE', 'HIGH', 'CRITICAL')),
  created_at TEXT NOT NULL, -- UTC ISO-8601 timestamp
  input_provenance TEXT NOT NULL -- e.g. 'demo'
);

CREATE INDEX idx_prediction_history_zone_created ON prediction_history(zone_id, created_at DESC);

-- Stores in-app alerts generated when a zone crosses a threshold.
CREATE TABLE alerts (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
  zone_id TEXT NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
  risk_score REAL NOT NULL,
  risk_level TEXT NOT NULL CHECK (risk_level IN ('LOW', 'MODERATE', 'HIGH', 'CRITICAL')),
  created_at TEXT NOT NULL, -- UTC ISO-8601 timestamp
  is_read INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0, 1)),
  message TEXT NOT NULL,
  input_provenance TEXT NOT NULL
);

CREATE INDEX idx_alerts_unread ON alerts(is_read, created_at DESC);
CREATE INDEX idx_alerts_zone ON alerts(zone_id, created_at DESC);
