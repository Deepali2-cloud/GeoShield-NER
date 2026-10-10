-- Migration 0004: Citizen reports (Phase 7).
--
-- Stores unverified citizen hazard reports submitted anonymously.
-- Status defaults to 'pending' and cannot be chosen by public submitters.
-- Coordinates are optional; when present both must be valid finite numbers within bounds.

CREATE TABLE reports (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
  zone_id TEXT NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN (
    'Landslide',
    'Cracks in ground or road',
    'Rockfall',
    'Blocked road',
    'Heavy rainfall or waterlogging',
    'Other hazard'
  )),
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  description TEXT NOT NULL CHECK (length(trim(description)) > 0),
  latitude REAL,
  longitude REAL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'resolved', 'rejected')),
  created_at TEXT NOT NULL, -- UTC ISO-8601 timestamp
  updated_at TEXT NOT NULL, -- UTC ISO-8601 timestamp

  CONSTRAINT chk_report_coords CHECK (
    (latitude IS NULL AND longitude IS NULL) OR
    (latitude IS NOT NULL AND longitude IS NOT NULL AND latitude BETWEEN -90.0 AND 90.0 AND longitude BETWEEN -180.0 AND 180.0)
  )
);

CREATE INDEX idx_reports_zone_created ON reports(zone_id, created_at DESC);
CREATE INDEX idx_reports_status_created ON reports(status, created_at DESC);
CREATE INDEX idx_reports_category_created ON reports(category, created_at DESC);
CREATE INDEX idx_reports_created ON reports(created_at DESC, id DESC);
