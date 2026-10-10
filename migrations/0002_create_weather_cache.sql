-- Migration 0002: weather cache (Phase 5).
--
-- One row per cache key. The key encodes the provider request and the exact zone ids and coordinates
-- (see worker/weather.ts), so changing a zone's coordinates automatically misses the old row.
--
-- `payload` is the Worker's own normalised snapshot (per-zone past/forecast sums with their time windows and the
-- time the provider was queried), NOT the raw provider response. It is validated again on every read; a row that
-- fails validation is ignored as a cache miss.
--
-- This table is a cache only. It never holds risk inputs and nothing reads it for scoring.

CREATE TABLE weather_cache (
  cache_key  TEXT PRIMARY KEY NOT NULL CHECK (length(cache_key) > 0),
  payload    TEXT NOT NULL,
  -- Human-readable copy of when the provider was queried (ISO-8601 UTC). The authoritative time is inside `payload`.
  fetched_at TEXT NOT NULL
);
