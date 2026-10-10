# GeoShield-NER

AI-assisted landslide risk monitoring, community reporting and early-warning **MVP prototype** for Northeast India.

> GeoShield-NER is an experimental risk-indicator prototype, not an official emergency warning system. Follow instructions from local authorities.

## Current status: Phase 8 (Secure Admin Authentication & Citizen Report Moderation, local only)

Built so far:
- Phase 1: responsive dashboard shell, navigation, risk legend, safety disclaimer.
- Phase 2: Leaflet + OpenStreetMap map with accessible, risk-coded markers kept in sync with the list and panel; non-blocking tile-failure and offline messages; no geolocation.
- Phase 3: a pure, tested, rule-based risk engine in `src/risk/`.
- Phase 4: a local-first backend. A Cloudflare Worker serves `GET /api/health` and `GET /api/zones` from a local D1 (SQLite) database; the dashboard loads its zones from that API.
- Phase 5: `GET /api/weather` fetches real precipitation data from Open-Meteo for the six seeded zones (one batched request, cached in D1) and the dashboard shows it, clearly labelled, beside the risk score.
- Phase 6: Prediction history deduplication (`GET /api/predictions`) and in-app alerts (`GET /api/alerts`, `PATCH /api/alerts/:id/read`) stored in local D1.
- Phase 7: Citizen Reporting MVP (`POST /api/reports`, `GET /api/reports`). Anonymous hazard reporting form and community reports feed with category, zone, and status filters. All new submissions are marked as `pending` and unverified.
- Phase 8: Secure Admin Authentication & Citizen Report Moderation (`POST /api/admin/login`, `GET /api/admin/session`, `POST /api/admin/logout`, `GET /api/admin/reports`, `PATCH /api/admin/reports/:id/status`). Single-administrator server-side verification (PBKDF2/WebCrypto), secure `HttpOnly` sessions with SHA-256 token hashing in D1, atomic moderation updates with append-only audit trail (`moderation_audit`), and authenticated Admin UI workspace at `/admin`.

**All six zones still use illustrative demo inputs, and risk scores are still demo-derived.** Rainfall, slope, elevation, soil and historical values are invented for UI demonstration. They are not measurements, not live weather and not authoritative hazard data. Every seeded input is stored with `source = 'demo'` and the API says so in its response metadata. **Phase 5 weather is displayed next to the score; it is not an input to it** (see "Weather and the risk score").

**This is a local development setup only.** Nothing is deployed, no remote database exists, and no remote migration has been run.

**Not built yet:** Charts and analytics (Phase 9).

## Backend architecture

```
Browser (React, :5173)
   |  GET /api/zones          (same-origin; Vite dev server proxies /api -> :8787)
   v
Cloudflare Worker (wrangler dev, :8787)      worker/index.ts   router, method + error handling
   |  reads rows, validates, calls the shared engine
   |     worker/zones.ts  ->  src/risk/*   (the Phase 3 engine, imported as is, never copied)
   v
Cloudflare D1 (local SQLite, .wrangler/state)   migrations/*.sql, seed/demo_zones.sql
```

- **One risk engine.** The Worker imports `assessZone` from `src/risk/zoneRisk.ts`. The formula, normalization bands, rounding and level boundaries exist only in `src/risk/`. No score is stored in the database; it is calculated from the stored raw inputs on every request. The frontend displays the API's result and does not recompute it.
- **No fallback data.** If the database fails, the API returns an error and the UI shows a retryable error state. It never substitutes `DEMO_ZONES`. (`src/data/demoZones.ts` is still the reference for the seed and for tests.)
- **Dependency-light.** Only `wrangler` was added. The Worker uses plain `Request`/`Response`, no router framework.
- **No CORS headers.** In development the browser talks to Vite on `:5173` and Vite proxies `/api` to the Worker, so requests are same-origin. Unrestricted CORS is deliberately not enabled.

### Files

| Path | Purpose |
|---|---|
| `worker/index.ts` | Entry point and router (`handleRequest`) |
| `worker/zones.ts` | D1 read, row validation, engine call, response building |
| `worker/db.ts` | Minimal D1 interface + `Env` (the `DB` binding) |
| `worker/http.ts` | JSON and error helpers (fixed, non-leaky messages) |
| `worker/openMeteo.ts` | Open-Meteo client: URL, bounded request, strict parsing |
| `worker/weather.ts` | Weather cache policy (D1), stale handling, response building |
| `src/types/weather.ts` | `GET /api/weather` response types shared by Worker and frontend |
| `src/api/weatherApi.ts`, `src/hooks/useWeather.ts` | Frontend fetch + strict validation, loading/error/retry state |
| `src/components/WeatherPanel.tsx` | Dashboard weather panel and per-zone weather detail |
| `src/risk/provenance.ts` | Says whether a score is demo-, partly-live- or live-derived (does not change scores) |
| `migrations/0002_create_weather_cache.sql` | Weather cache table |
| `src/types/api.ts` | Response types shared by Worker and frontend |
| `src/api/zonesApi.ts` | Frontend fetch + validation of the API response |
| `src/hooks/useZones.ts`, `src/components/ApiState.tsx` | Loading / error / empty states |
| `migrations/0001_create_zones.sql` | Schema |
| `seed/demo_zones.sql` | Idempotent demo seed |
| `wrangler.jsonc` | Worker + local D1 binding |
| `scripts/smoke-local.mjs` | Read-only smoke test for a running Worker |

## API

All responses are JSON with `Cache-Control: no-store`. Only `GET` and `HEAD` are accepted; any other method on a known route returns `405` with `Allow: GET, HEAD`. Unknown routes return `404`. The query string is ignored.

### `GET /api/health`

```json
{ "data": { "status": "ok", "service": "geoshield-ner-api", "database": "ok" } }
```
Returns `503` with `"status": "degraded", "database": "unavailable"` when D1 cannot be queried or migrations have not been applied.

### `GET /api/zones`

```json
{
  "data": {
    "zones": [
      {
        "id": "guwahati", "name": "Guwahati", "state": "Assam",
        "latitude": 26.1445, "longitude": 91.7362,
        "origin": "demo_seed",
        "inputs": {
          "rainfall72hMm":   { "value": 35,  "source": "demo" },
          "slopeDeg":        { "value": 14,  "source": "demo" },
          "elevationM":      { "value": 140, "source": "demo" },
          "soilScore":       { "value": 40,  "source": "demo" },
          "historicalScore": { "value": 30,  "source": "demo" }
        },
        "assessment": {
          "ok": true,
          "result": {
            "score": 23.3, "level": "LOW",
            "factors": { "rainfall": 20, "slope": 23.33, "historical": 30, "soil": 40, "terrain": 4.2 },
            "contributions": { "...": "..." }, "weights": { "...": "..." },
            "explanation": ["..."], "modelVersion": "weighted-v1"
          }
        }
      }
    ]
  },
  "meta": {
    "count": 6, "demoData": true, "modelVersion": "weighted-v1",
    "notice": "All inputs are illustrative demo data. Not measured, not live weather, not a validated prediction."
  }
}
```
(`...` marks fields omitted here for brevity; the real response contains them. Types: `src/types/api.ts`.)

- Zones are ordered by `sort_order`, then `id`.
- A zone with a missing, non-numeric, out-of-range or unknown-source input is still returned, with `"assessment": { "ok": false, "errors": ["Rainfall (past 72 h): missing"] }` and **no score**. Values are never clamped, defaulted or estimated. Affected `inputs[...].value` / `.source` are `null`.
- An empty table returns `200` with `"zones": []` and `"count": 0`.
- A stored row with no usable id, name or coordinates fails the whole request with `500 invalid_stored_data` rather than guessing.

### `GET /api/weather`

```json
{
  "data": {
    "zones": [
      {
        "id": "guwahati", "name": "Guwahati", "latitude": 26.1445, "longitude": 91.7362,
        "status": "live",
        "past": {
          "kind": "model_derived_recent", "status": "available", "totalMm": 7.2, "unit": "mm",
          "window": { "start": "2026-10-07T03:00:00.000Z", "end": "2026-10-10T03:00:00.000Z", "hours": 72 }
        },
        "forecast": {
          "kind": "forecast", "status": "available", "totalMm": 1.2, "unit": "mm",
          "window": { "start": "2026-10-10T03:00:00.000Z", "end": "2026-10-11T03:00:00.000Z", "hours": 24 }
        }
      }
    ]
  },
  "meta": {
    "status": "live", "partial": false, "count": 6,
    "provider": { "name": "Open-Meteo", "endpoint": "forecast", "model": "best_match", "status": "ok" },
    "retrievedAt": "2026-10-10T03:17:00.000Z", "ageSeconds": 0, "cache": "refreshed",
    "freshSeconds": 1800, "maxStaleSeconds": 21600, "unit": "mm",
    "notice": "Past-72h values are model-derived recent precipitation ..."
  }
}
```
(The numbers are illustrative. Real responses contain all six zones.)

- **Status** (per zone and overall): `live` = retrieved within the freshness window; `stale` = older, shown with its real age because a refresh failed; `unavailable` = no usable data. An `unavailable` part has `totalMm: null` and `window: null`. No value is ever estimated, defaulted or carried over from another zone.
- `meta.provider.status` is the outcome of the latest provider attempt: `ok`, `timeout`, `rate_limited`, `http_error`, `network_error`, `invalid_response`, or `not_attempted` (answered from cache). `meta.cache`: `refreshed`, `cache_fresh`, `cache_stale`, `none`.
- `meta.partial` is true when some zones, or only one of past/forecast for a zone, are unavailable.
- Provider trouble is **not** an HTTP error: the endpoint answers `200` with `stale` or `unavailable` data. Only a failure to read the zones from D1 gives `503 database_unavailable` / `500 invalid_stored_data`.
- `GET /api/health` never contacts the weather provider and does not depend on it.

### `POST /api/reports`

Accepts anonymous public citizen reports. Validates input types, lengths, and valid zones. Server generates a UUID `id`, `pending` status, and UTC timestamps.

Request body:
```json
{
  "zoneId": "gangtok",
  "category": "Landslide",
  "title": "Roadside soil movement",
  "description": "Loose soil and small boulders blocking one lane near km 14.",
  "latitude": 27.3389,
  "longitude": 88.6065
}
```

Constraints:
- `zoneId`: Required string matching an existing zone in `zones`.
- `category`: Must be one of `Landslide`, `Cracks in ground or road`, `Rockfall`, `Blocked road`, `Heavy rainfall or waterlogging`, `Other hazard`.
- `title`: 1–120 characters trimmed.
- `description`: 1–2000 characters trimmed.
- `latitude` / `longitude`: Optional; if either is provided, both must be valid finite numbers within -90..90 and -180..180.
- Payload size: Maximum 10 KB. `Content-Type: application/json` is required.

Response (`201 Created`):
```json
{
  "data": {
    "report": {
      "id": "e6a4b3d1-9f12-4c6e-821b-7a3d5e890123",
      "zoneId": "gangtok",
      "category": "Landslide",
      "title": "Roadside soil movement",
      "description": "Loose soil and small boulders blocking one lane near km 14.",
      "latitude": 27.3389,
      "longitude": 88.6065,
      "status": "pending",
      "createdAt": "2026-10-10T11:45:00.000Z",
      "updatedAt": "2026-10-10T11:45:00.000Z"
    }
  }
}
```

### `GET /api/reports`

Returns saved citizen reports ordered newest first (`ORDER BY created_at DESC, id DESC`). Supports optional filtering:

Query parameters:
- `zoneId`: filter by specific zone ID (e.g. `?zoneId=gangtok`)
- `category`: filter by hazard category (e.g. `?category=Landslide`)
- `status`: filter by status (`pending`, `reviewed`, `resolved`, `rejected`)
- `limit`: integer between 1 and 100 (default: 50)

Response (`200 OK`):
```json
{
  "data": {
    "reports": [
      {
        "id": "e6a4b3d1-9f12-4c6e-821b-7a3d5e890123",
        "zoneId": "gangtok",
        "category": "Landslide",
        "title": "Roadside soil movement",
        "description": "Loose soil and small boulders blocking one lane near km 14.",
        "latitude": 27.3389,
        "longitude": 88.6065,
        "status": "pending",
        "createdAt": "2026-10-10T11:45:00.000Z",
        "updatedAt": "2026-10-10T11:45:00.000Z"
      }
    ]
  }
}
```

### `POST /api/admin/login`

Authenticates single administrator using server-side PBKDF2/WebCrypto verification against `ADMIN_PASSWORD` or `ADMIN_PASSWORD_HASH` + `ADMIN_PASSWORD_SALT`. If unconfigured, fails closed with 500 without leaking details. Protects against brute-force abuse via in-memory rate limiting and constant-time string comparisons.

Returns `200 OK` with an `HttpOnly`, `SameSite=Strict`, `Path=/api/admin` cookie named `gs_admin_session`. The session token is stored hashed (SHA-256) in D1 with an 8-hour lifetime.

### `GET /api/admin/session`

Validates current administrator session from the incoming cookie against unexpired, non-revoked session hashes in D1. Returns `200 OK` with session info if valid, or `401 unauthorized` if missing, invalid, expired, or revoked.

### `POST /api/admin/logout`

Revokes the administrator session in D1 and clears the `gs_admin_session` cookie (`Max-Age=0`).

### `GET /api/admin/reports`

Requires an authenticated admin session. Returns all citizen reports including status and details for moderation review.

### `PATCH /api/admin/reports/:id/status`

Requires an authenticated admin session and CSRF/Origin validation. Updates report status (`'reviewed'`, `'resolved'`, or `'rejected'`). Cannot transition reports back to `'pending'`. Executes atomically via D1 batch/transaction, recording an entry in `moderation_audit` with `previous_status`, `new_status`, `admin_id`, and timestamp.

### Errors

```json
{ "error": { "code": "database_unavailable", "message": "The database is currently unavailable." } }
```

| Status | `code` | When |
|---|---|---|
| 404 | `not_found` | Unknown route |
| 405 | `method_not_allowed` | Method other than GET/HEAD on a known route |
| 503 | `database_unavailable` | D1 binding missing, table missing, query failed |
| 500 | `invalid_stored_data` | A stored row cannot be represented as a zone |
| 500 | `internal_error` | Anything unexpected |

Messages are fixed strings. Stack traces, SQL, file paths and configuration are written to the Worker's own log only, never to the response. SQL is constant text; the only variable (a row cap) is bound as a `?` parameter, and no request data reaches a query.

## Database

Migration `migrations/0001_create_zones.sql` creates `zones`:

| Column(s) | Notes |
|---|---|
| `id` (PK), `name`, `state` | Non-empty text. `id` matches `src/data/demoZones.ts` |
| `latitude`, `longitude` | `REAL`, `CHECK` within -90..90 / -180..180 |
| `sort_order` | Dashboard display order |
| `rainfall_72h_mm`, `slope_deg`, `elevation_m`, `soil_score`, `historical_score` | The five raw Phase 3 inputs, same units as `ZoneInputs`. Nullable, no range checks (the engine's `INPUT_LIMITS` is the single authority) |
| `*_source` (five columns) | `demo` / `live` / `authoritative`, default `demo` |
| `record_origin` | `demo_seed` or `user`; the seed only ever touches `demo_seed` rows |
| `created_at`, `updated_at` | ISO-8601 UTC text |

Indexes: `idx_zones_sort_order (sort_order, id)` and `idx_zones_record_origin (record_origin)`.

Migration `migrations/0002_create_weather_cache.sql` adds `weather_cache (cache_key, payload, fetched_at)`. It is a cache only: it holds the Worker's normalised per-zone sums and the retrieval time, is validated on every read, and is never used for scoring.

Migration `migrations/0003_prediction_history_alerts.sql` adds `prediction_history` and `alerts` tables:
- `prediction_history (id, zone_id, risk_score, risk_level, created_at, input_provenance)`
- `alerts (id, zone_id, risk_score, risk_level, created_at, is_read, message, input_provenance)`

Migration `migrations/0004_citizen_reports.sql` adds `reports` for anonymous citizen hazard reporting:
- `id` (PK, UUID text), `zone_id` (FK to `zones.id` ON DELETE CASCADE)
- `category` (`CHECK` in `'Landslide'`, `'Cracks in ground or road'`, `'Rockfall'`, `'Blocked road'`, `'Heavy rainfall or waterlogging'`, `'Other hazard'`)
- `title` (text, non-empty, max 120 chars)
- `description` (text, non-empty, max 2000 chars)
- `latitude`, `longitude` (`REAL`, optional; when present both must be valid finite numbers within -90..90 and -180..180)
- `status` (default `'pending'`, `CHECK` in `'pending'`, `'reviewed'`, `'resolved'`, `'rejected'`)
- `created_at`, `updated_at` (ISO-8601 UTC text)
- Indexes: `idx_reports_zone_created`, `idx_reports_status_created`, `idx_reports_category_created`, `idx_reports_created`.

Migration `migrations/0005_admin_sessions_audit.sql` adds admin authentication and moderation audit:
- `admin_sessions`:
  - `session_id_hash` (PK, SHA-256 hex string)
  - `admin_id` (text, e.g. `'admin'`)
  - `created_at`, `expires_at`, `revoked_at` (ISO-8601 UTC text)
  - Index: `idx_admin_sessions_lookup` on `(session_id_hash, expires_at, revoked_at)`
- `moderation_audit`:
  - `id` (PK, text UUID)
  - `report_id` (FK to `reports.id` ON DELETE CASCADE)
  - `previous_status` (text)
  - `new_status` (text)
  - `admin_id` (text)
  - `created_at` (ISO-8601 UTC text)
  - Indexes: `idx_moderation_audit_report`, `idx_moderation_audit_created`

### Seeding

`seed/demo_zones.sql` is one `INSERT ... ON CONFLICT (id) DO UPDATE ... WHERE zones.record_origin = 'demo_seed'`:
- Run it any number of times: no duplicates, `created_at` is preserved, drifted demo rows are reset to the demo values.
- It never modifies a row whose `record_origin` is `user`, even if it shares a demo id, and never deletes anything.
- A test fails if the seed and `src/data/demoZones.ts` ever disagree.

## Weather (Phase 5)

**Source.** [Open-Meteo](https://open-meteo.com/en/docs) forecast endpoint, `https://api.open-meteo.com/v1/forecast`. Public, no API key, no secret. Open-Meteo's free tier is for non-commercial use; commercial use needs their paid plan and key (not configured here).

**Request.** One batched call for all six zones (comma-separated `latitude` / `longitude`, which Open-Meteo documents as returning one result per location in request order), using the zone coordinates stored in D1. Variable `hourly=precipitation`, `past_hours=72`, `forecast_hours=25`, `timeformat=unixtime` (UTC epoch seconds, so there is no timezone parsing), `precipitation_unit=mm`. Default "best match" model selection.

**Variable and units.** `precipitation` is the sum of rain, showers and snow over the *preceding hour* in millimetres, stamped at the end of that hour. The Worker checks that the response's `hourly_units.precipitation` is `mm` and refuses the zone otherwise.

**Two separate quantities, never mixed**

| | Past | Forecast |
|---|---|---|
| Meaning | Precipitation in the 72 h up to the current hour | Predicted precipitation for the next 24 h |
| Window | (floor − 72 h, floor] | (floor, floor + 24 h] |
| Nature | **Model-derived recent data, not a rain-gauge observation** | A forecast, not a measurement |
| Label in API | `kind: "model_derived_recent"` | `kind: "forecast"` |

`floor` is the retrieval time rounded down to the hour (UTC). Windows are cut by timestamp, not by array position. A total is reported only if all 72 (or 24) hourly values are present and valid: one missing hour makes that part `unavailable` instead of returning an understated sum.

**Why "model-derived" and not "observed".** The Historical Weather API (ERA5) lags by about five days, so it cannot cover the last 72 hours. The forecast endpoint's `past_hours` is the supported way to get recent hours, but Open-Meteo's documentation describes its past data as archived forecasts, not station or gauge readings. The UI and API therefore say "model-derived". No gauge-observation source is integrated.

**Forecast issue time.** Open-Meteo's response does not state the model run time, so only the Worker's retrieval time (`retrievedAt`) is reported. It is when the Worker asked, not when the model ran.

**Cache policy** (constants in `worker/weather.ts`)

| Rule | Value |
|---|---|
| Fresh | Up to 30 min old: served from cache, no provider call, labelled `live` with its age |
| Refresh | Older than 30 min: one provider call, timeout 8 s |
| Stale fallback | If the refresh fails, the previous snapshot is served only if it is at most 6 h old, labelled `stale` with its real age and original retrieval time |
| Expired | Older than 6 h and no refresh: `unavailable`, no values |
| Cool-down | After a failed refresh the provider is not called again for 60 s (per Worker instance) |
| Storage | The existing D1 binding (`weather_cache`), shared across instances. A cache read/write failure is logged and treated as a miss |
| Key | Includes every zone id and coordinate, so changing a coordinate invalidates the cache |

The browser requests weather once when the dashboard loads and again only when the user presses Refresh/Retry; the Worker cache absorbs repeats. **Known limit:** several simultaneous requests that all find an expired cache may each call the provider once (a Worker must not share another request's in-flight I/O); the cool-down limits repeats only after a failure.

**Failure handling.** Timeouts, network errors, HTTP 429/4xx/5xx, `{"error": true}` bodies, non-JSON, wrong shape, wrong unit, missing variables, null or negative hours and grid points far from the zone are all handled. Responses carry only fixed status codes (`timeout`, `rate_limited`, ...); URLs, exception text and configuration go to the Worker log at most.

### Weather and the risk score

**Weather does not change any score.** The formula (`0.35R + 0.25S + 0.20H + 0.10G + 0.10E`), weights, rounding and level boundaries are untouched, and the demo rainfall input (`source = 'demo'`) is not replaced. Every score is therefore **demo-derived**, and the zone panel says so (`src/risk/provenance.ts`):

| Basis | When |
|---|---|
| demo | all five inputs are demo data (every zone today) |
| partly live | some inputs are live/authoritative, the rest still demo; never presented as live |
| live | all five inputs are live or authoritative (no zone qualifies yet) |
| unavailable | invalid inputs, no score |

**Remaining requirement for live rainfall in R.** Feeding past-72h precipitation into factor R would be a small mapping (`normalizeRainfall72h` already takes mm over 72 h). It is deliberately not done: the available data is model-derived rather than observed, and the other four factors would remain demo, so the result could only ever be "partly live". It needs an explicit decision that model-derived rainfall is acceptable as the R input, plus per-zone provenance shown in the UI (the provenance helper is ready for this). The Phase 3 bands remain prototype assumptions, not validated thresholds.

**Limitations.** Open-Meteo values are gridded model output (kilometres across), not point measurements, and can differ substantially from local rainfall in steep Northeast India terrain. Precipitation totals are not landslide predictions. This is not an official warning source.

## Run locally

Requires **Node 22.5 or newer** (the backend tests use Node's built-in `node:sqlite`).

```
npm install
npm run db:setup:local      # one-time: apply migrations + seed the LOCAL database
```

Then run two terminals:

```
# Terminal 1: API
npm run worker:dev          # http://localhost:8787   (try /api/health and /api/zones)

# Terminal 2: frontend
npm run dev                 # http://localhost:5173   (proxies /api to :8787)
```

Open http://localhost:5173. Check the API without the browser: `npm run smoke:local` (Worker must be running). `npm run db:setup:local` applies migration 0002 too, which `/api/weather` uses for its cache (without it weather still works, just uncached).

The smoke test accepts any honest weather state (`live`, `stale`, `unavailable`) and prints which one it saw, so it only proves the contract. Treat live weather as verified only if you see `INFO weather status: live` on a machine that can reach `api.open-meteo.com`.

### Local database commands (all local-only)

```
npm run db:migrate:local    # wrangler d1 migrations apply DB --local
npm run db:seed:local       # wrangler d1 execute DB --local --file=seed/demo_zones.sql
npm run db:setup:local      # both, in order
```

Every script passes `--local`. Local state lives in `.wrangler/state/` (git-ignored). To start over, delete that folder yourself; no script does this for you.

### Configuration

`wrangler.jsonc` defines one D1 binding, `DB`, database name `geoshield-ner-db`. Its `database_id` is a **placeholder** (`00000000-0000-0000-0000-000000000000`) that local development does not use. You only need to supply a real ID if you later create a remote database yourself, which is outside Phase 4. No API token, account ID or secret is required, and none is stored. `remote` bindings are not enabled.

#### Admin Authentication Secrets (Local Development)

In local development, Wrangler automatically loads environment variables from `.dev.vars` (git-ignored).
To configure the administrator credentials locally on Windows PowerShell:

```powershell
# Copy the example file if .dev.vars does not exist
Copy-Item .dev.vars.example .dev.vars

# Or set custom admin password in .dev.vars:
Set-Content .dev.vars "ADMIN_PASSWORD=your-secure-local-password"
```

For production deployment (outside local scope), set secrets via Wrangler CLI:
```bash
npx wrangler secret put ADMIN_PASSWORD
```

Optional frontend variable (see `.env.example`): `VITE_API_BASE_URL`. Leave it unset in development.

### Tests and checks

```
npm test            # all tests: Phase 1-4 regression, weather client/cache/API, UI states, provenance
npm run typecheck   # app, node tooling and worker projects
npm run lint
npm run build       # frontend production build
```

**No test touches the internet.** Open-Meteo is always mocked (an injected `fetch`), so the suite passes offline, but it cannot prove the real provider's current behaviour. Backend and database tests run against an in-memory SQLite database that exposes the same D1 calls the Worker uses. They never touch a production or remote database and need no Cloudflare account. This is SQLite, not the `workerd` runtime, so use `npm run smoke:local` against `wrangler dev` to confirm behaviour on the real local D1.

### Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| Dashboard shows "Cannot reach the API" | The Worker is not running. Start `npm run worker:dev`, then press Retry |
| "The database is currently unavailable" / `/api/health` is 503 | Migrations not applied. Run `npm run db:setup:local` |
| "No monitoring zones found" | Migrated but not seeded. Run `npm run db:seed:local` |
| Port 8787 is already in use | Another Worker is running. Stop it, or change `dev.port` in `wrangler.jsonc` **and** the proxy target in `vite.config.ts` |
| Proxy error to `localhost:8787` (IPv6/IPv4) | Change the proxy target in `vite.config.ts` to `http://127.0.0.1:8787` |
| Wrangler cannot find the D1 binding `DB` | Run commands from the repository root, where `wrangler.jsonc` lives |
| Weather panel says "Unavailable" and `provider: network_error` | The machine cannot reach `api.open-meteo.com` (offline, firewall, proxy). Nothing is estimated. Retry later |
| Weather is never cached (always `refreshed`) | Migration 0002 not applied. Run `npm run db:migrate:local` |
| Weather is `stale` | The last refresh failed; the values shown are the last good ones with their age. They expire after 6 h |
| Data looks stale after editing the seed | Re-run `npm run db:seed:local` (it updates demo rows in place) |
| `ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite` when testing | Node is older than 22.5. Upgrade Node |
| `npm ci` fails on a lockfile mismatch | Run `npm install` once to refresh `package-lock.json` after the `wrangler` addition |

## How the score is calculated

```
Score = 0.35 R + 0.25 S + 0.20 H + 0.10 G + 0.10 E        (weights total 1.0)
```

Rule-based weighted sum. **Not machine learning, and not a validated landslide forecast.** Each factor is scaled to 0-100 first.

| Factor | Raw input (field) | Scaling |
|---|---|---|
| R rainfall | past 72 h rainfall, mm (`rainfall72hMm`) | piecewise-linear bands |
| S slope | slope angle, degrees (`slopeDeg`) | piecewise-linear bands |
| H historical susceptibility | `historicalScore` | already 0-100, used as is |
| G soil / ground | `soilScore` | already 0-100, used as is |
| E elevation / terrain | elevation, m (`elevationM`) | piecewise-linear bands (crude terrain proxy) |

The bands live in `src/risk/config.ts` and are **prototype assumptions, not official thresholds**.

The score is rounded to 1 decimal (half up), **then** classified: below 30 LOW, 30 to below 50 MODERATE, 50 to below 70 HIGH, 70 and above CRITICAL. Alerts (Phase 6) will start at 50.

Invalid inputs (missing, NaN, Infinity, negative, out of range) are rejected and reported. A zone with invalid inputs shows "Unavailable"; a score is never invented or silently set to zero.

Every zone input carries a `source` (`demo`, `live` or `authoritative`). In this build all of them are `demo`: illustrative values that are not measurements, not live weather and not authoritative data. Rainfall in the score is **not** live: Phase 5 shows Open-Meteo weather beside the score but does not feed it in (see "Weather and the risk score").

Code layout: `src/risk/config.ts` (weights, thresholds, bands), `normalize.ts`, `engine.ts` (`calculateRisk`, `levelFromScore`), `zoneRisk.ts` (`assessZone`).

## Agreed decisions

- Alerts for HIGH and CRITICAL (score >= 50).
- Scores rounded to 1 decimal, then: <30 LOW, <50 MODERATE, <70 HIGH, >=70 CRITICAL.
- Risk is calculated only for the six seeded zones (now read from the local D1 database); arbitrary coordinates are for reports and weather only.
- Rainfall input: past 72 h; the 24 h forecast is shown separately (Phase 5) and never mixed with it; bands defined in Phase 3 (`src/risk/config.ts`).
- Weather source: Open-Meteo forecast endpoint (public, no key); past hours are labelled model-derived, not observed.
- Admin authentication deferred to Phase 8 (prototype `ADMIN_TOKEN`, not full production auth).
- Photos: validate type and size only; never stored; no AI analysis claimed.
