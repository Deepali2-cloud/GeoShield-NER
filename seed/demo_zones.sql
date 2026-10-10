-- Idempotent seed for the six ILLUSTRATIVE DEMO zones.
--
-- Source of truth for ids, names, coordinates and inputs: src/data/demoZones.ts. A test
-- (tests/worker/seed.test.ts) fails if this file and that file ever disagree.
--
-- Safe to run repeatedly:
--   * No duplicates: rows are keyed by id and upserted.
--   * Never overwrites other data: the update only applies to rows whose record_origin is
--     'demo_seed'. A row with the same id but record_origin = 'user', and any other row, is left alone.
--   * created_at is preserved on re-seed; updated_at is refreshed.
--
-- Every input below is invented for UI demonstration. None is a measurement, live weather
-- or authoritative hazard data.

INSERT INTO zones (
  id, name, state, latitude, longitude, sort_order,
  rainfall_72h_mm, rainfall_72h_mm_source,
  slope_deg, slope_deg_source,
  elevation_m, elevation_m_source,
  soil_score, soil_score_source,
  historical_score, historical_score_source,
  record_origin
) VALUES
  ('guwahati', 'Guwahati', 'Assam', 26.1445, 91.7362, 10, 35, 'demo', 14, 'demo', 140, 'demo', 40, 'demo', 30, 'demo', 'demo_seed'),
  ('itanagar', 'Itanagar', 'Arunachal Pradesh', 27.0844, 93.6053, 20, 40, 'demo', 24, 'demo', 320, 'demo', 52, 'demo', 45, 'demo', 'demo_seed'),
  ('kohima', 'Kohima', 'Nagaland', 25.6751, 94.1086, 30, 55, 'demo', 27, 'demo', 1261, 'demo', 55, 'demo', 50, 'demo', 'demo_seed'),
  ('shillong', 'Shillong', 'Meghalaya', 25.5788, 91.8933, 40, 90, 'demo', 31, 'demo', 1496, 'demo', 60, 'demo', 62, 'demo', 'demo_seed'),
  ('aizawl', 'Aizawl', 'Mizoram', 23.7271, 92.7176, 50, 110, 'demo', 36, 'demo', 1132, 'demo', 66, 'demo', 70, 'demo', 'demo_seed'),
  ('gangtok', 'Gangtok', 'Sikkim', 27.3314, 88.6138, 60, 160, 'demo', 42, 'demo', 1650, 'demo', 72, 'demo', 78, 'demo', 'demo_seed')
ON CONFLICT (id) DO UPDATE SET
  name                    = excluded.name,
  state                   = excluded.state,
  latitude                = excluded.latitude,
  longitude               = excluded.longitude,
  sort_order              = excluded.sort_order,
  rainfall_72h_mm         = excluded.rainfall_72h_mm,
  rainfall_72h_mm_source  = excluded.rainfall_72h_mm_source,
  slope_deg               = excluded.slope_deg,
  slope_deg_source        = excluded.slope_deg_source,
  elevation_m             = excluded.elevation_m,
  elevation_m_source      = excluded.elevation_m_source,
  soil_score              = excluded.soil_score,
  soil_score_source       = excluded.soil_score_source,
  historical_score        = excluded.historical_score,
  historical_score_source = excluded.historical_score_source,
  updated_at              = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE zones.record_origin = 'demo_seed';
