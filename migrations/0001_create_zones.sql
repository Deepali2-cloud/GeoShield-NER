-- Migration 0001: zones table (Phase 4).
--
-- Stores the monitoring zones and the five RAW risk inputs, in the same units as the TypeScript
-- `Zone` / `ZoneInputs` types (src/types/index.ts):
--   rainfall_72h_mm  past-72h rainfall, millimetres
--   slope_deg        slope angle, degrees
--   elevation_m      metres above sea level
--   soil_score       0-100, already normalised
--   historical_score 0-100, already normalised
--
-- Deliberately NOT stored: risk score, level, normalised factors. The Phase 3 engine in src/risk/
-- is the single source of truth and the Worker calculates them on every read.
--
-- Input value columns are nullable and have no range CHECKs on purpose: the valid ranges live in
-- INPUT_LIMITS (src/risk/config.ts) and are enforced by the engine, which reports bad data instead
-- of the database silently rejecting or the API silently fixing it.
--
-- All seeded inputs are ILLUSTRATIVE DEMO DATA (source = 'demo'), not measurements or live weather.

CREATE TABLE zones (
  id         TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
  name       TEXT NOT NULL CHECK (length(trim(name)) > 0),
  state      TEXT NOT NULL CHECK (length(trim(state)) > 0),
  latitude   REAL NOT NULL CHECK (latitude  BETWEEN  -90 AND  90),
  longitude  REAL NOT NULL CHECK (longitude BETWEEN -180 AND 180),

  -- Display order on the dashboard (ascending), ties broken by id.
  sort_order INTEGER NOT NULL DEFAULT 0,

  rainfall_72h_mm         REAL,
  rainfall_72h_mm_source  TEXT NOT NULL DEFAULT 'demo' CHECK (rainfall_72h_mm_source  IN ('demo', 'live', 'authoritative')),
  slope_deg               REAL,
  slope_deg_source        TEXT NOT NULL DEFAULT 'demo' CHECK (slope_deg_source        IN ('demo', 'live', 'authoritative')),
  elevation_m             REAL,
  elevation_m_source      TEXT NOT NULL DEFAULT 'demo' CHECK (elevation_m_source      IN ('demo', 'live', 'authoritative')),
  soil_score              REAL,
  soil_score_source       TEXT NOT NULL DEFAULT 'demo' CHECK (soil_score_source       IN ('demo', 'live', 'authoritative')),
  historical_score        REAL,
  historical_score_source TEXT NOT NULL DEFAULT 'demo' CHECK (historical_score_source IN ('demo', 'live', 'authoritative')),

  -- 'demo_seed' rows are managed by seed/demo_zones.sql; 'user' rows are never touched by the seed.
  record_origin TEXT NOT NULL DEFAULT 'user' CHECK (record_origin IN ('demo_seed', 'user')),

  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Supports the dashboard listing query (ORDER BY sort_order, id).
CREATE INDEX idx_zones_sort_order ON zones (sort_order, id);

-- Supports the seed's "only touch demo rows" rule and future filtering by origin.
CREATE INDEX idx_zones_record_origin ON zones (record_origin);
