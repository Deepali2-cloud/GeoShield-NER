// Smoke test for a RUNNING local Worker (`npm run worker:dev`). Read-only: it only issues GET requests.
// Usage: npm run smoke:local            (defaults to http://localhost:8787)
//        API_URL=http://localhost:8787 npm run smoke:local
const base = (process.env.API_URL ?? 'http://localhost:8787').replace(/\/+$/, '')
const EXPECTED = { guwahati: 23.3, itanagar: 34.5, kohima: 44.8, shillong: 57.1, aizawl: 63.3, gangtok: 78.8 }

let failed = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : detail ? `  (${detail})` : ''}`)
  if (!ok) failed++
}
const get = async (path, init) => {
  const res = await fetch(base + path, init)
  let body = null
  try { body = await res.json() } catch { /* not JSON */ }
  return { res, body }
}

try {
  const health = await get('/api/health')
  check('GET /api/health -> 200 ok', health.res.status === 200 && health.body?.data?.status === 'ok', `status ${health.res.status}`)

  const zones = await get('/api/zones')
  const list = zones.body?.data?.zones ?? []
  check('GET /api/zones -> 200', zones.res.status === 200, `status ${zones.res.status}`)
  check('six zones returned', list.length === 6, `got ${list.length}; did you run "npm run db:setup:local"?`)
  check('meta marks data as demo', zones.body?.meta?.demoData === true)
  for (const [id, score] of Object.entries(EXPECTED)) {
    const z = list.find((x) => x.id === id)
    check(`${id} scores ${score}`, z?.assessment?.ok === true && z.assessment.result.score === score, JSON.stringify(z?.assessment?.result?.score))
  }

  // Weather: the provider may be unreachable from this machine, so every honest state passes. What must hold is the
  // shape, the zone ids, and that "unavailable" never carries numbers. Live is reported, never required.
  const wx = await get('/api/weather')
  const wz = wx.body?.data?.zones ?? []
  check('GET /api/weather -> 200', wx.res.status === 200, `status ${wx.res.status}`)
  check('weather lists the six zone ids', JSON.stringify(wz.map((z) => z.id)) === JSON.stringify(Object.keys(EXPECTED)), JSON.stringify(wz.map((z) => z.id)))
  check('weather status is live, stale or unavailable', ['live', 'stale', 'unavailable'].includes(wx.body?.meta?.status), String(wx.body?.meta?.status))
  check(
    'unavailable zones carry no numbers',
    wz.every((z) => z.status !== 'unavailable' || (z.past.totalMm === null && z.forecast.totalMm === null)),
  )
  check('past is labelled model-derived, forecast as forecast', wz.every((z) => z.past.kind === 'model_derived_recent' && z.forecast.kind === 'forecast'))
  console.log(`INFO  weather status: ${wx.body?.meta?.status}, provider: ${wx.body?.meta?.provider?.status}, retrievedAt: ${wx.body?.meta?.retrievedAt}`)
  const after = await get('/api/zones')
  check('scores unchanged after weather request', (after.body?.data?.zones ?? []).every((z) => z.assessment?.result?.score === EXPECTED[z.id]))

  const preds = await get('/api/predictions')
  check('GET /api/predictions -> 200', preds.res.status === 200, `status ${preds.res.status}`)
  check('predictions array returned', Array.isArray(preds.body?.data?.predictions), `got ${typeof preds.body?.data?.predictions}`)

  const alerts = await get('/api/alerts')
  check('GET /api/alerts -> 200', alerts.res.status === 200, `status ${alerts.res.status}`)
  check('alerts array returned', Array.isArray(alerts.body?.data?.alerts), `got ${typeof alerts.body?.data?.alerts}`)

  // Phase 7: Citizen Reporting
  const createReportRes = await get('/api/reports', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      zoneId: 'guwahati',
      category: 'Rockfall',
      title: 'Smoke test rockfall report',
      description: 'Automated smoke test verifying Phase 7 citizen reporting persistence.',
      latitude: 26.14,
      longitude: 91.73,
    }),
  })
  check('POST /api/reports -> 201', createReportRes.res.status === 201, `status ${createReportRes.res.status}`)
  check('created report has pending status', createReportRes.body?.data?.report?.status === 'pending')
  check('created report has server id', typeof createReportRes.body?.data?.report?.id === 'string')

  const reports = await get('/api/reports')
  check('GET /api/reports -> 200', reports.res.status === 200, `status ${reports.res.status}`)
  check('reports array returned', Array.isArray(reports.body?.data?.reports), `got ${typeof reports.body?.data?.reports}`)

  const deleteReport = await get('/api/reports', { method: 'DELETE' })
  check('DELETE /api/reports -> 405', deleteReport.res.status === 405 && deleteReport.res.headers.get('allow')?.includes('POST'))

  const nope = await get('/api/does-not-exist')
  check('unknown route -> 404 JSON', nope.res.status === 404 && nope.body?.error?.code === 'not_found')

  // Phase 8: Secure Admin Authentication & Moderation
  const adminSessionUnauth = await get('/api/admin/session')
  check('GET /api/admin/session (unauth) -> 401', adminSessionUnauth.res.status === 401 && adminSessionUnauth.body?.error?.code === 'unauthorized')

  const adminLoginWrong = await get('/api/admin/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'incorrect-password' }),
  })
  check('POST /api/admin/login (bad password) -> 401', adminLoginWrong.res.status === 401)

  const adminLoginSuccess = await get('/api/admin/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'local-dev-admin-secret' }),
  })
  const adminCookie = adminLoginSuccess.res.headers.get('set-cookie')
  check('POST /api/admin/login (valid) -> 200', adminLoginSuccess.res.status === 200)
  check('login sets admin session cookie', !!adminCookie && adminCookie.includes('gs_admin_session'))

  if (adminCookie) {
    const cookieHeader = adminCookie.split(';')[0]
    const adminSessionAuth = await get('/api/admin/session', {
      headers: { cookie: cookieHeader },
    })
    check('GET /api/admin/session (auth) -> 200', adminSessionAuth.res.status === 200 && adminSessionAuth.body?.data?.authenticated === true)

    const adminReports = await get('/api/admin/reports', {
      headers: { cookie: cookieHeader },
    })
    check('GET /api/admin/reports (auth) -> 200', adminReports.res.status === 200 && Array.isArray(adminReports.body?.data?.reports))

    const reportId = createReportRes.body?.data?.report?.id
    if (reportId) {
      const patchRes = await get(`/api/admin/reports/${reportId}/status`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          cookie: cookieHeader,
        },
        body: JSON.stringify({ status: 'reviewed' }),
      })
      check('PATCH /api/admin/reports/:id/status -> 200', patchRes.res.status === 200 && patchRes.body?.data?.report?.status === 'reviewed')
      check('audit record created on moderation', patchRes.body?.data?.audit?.previousStatus === 'pending' && patchRes.body?.data?.audit?.newStatus === 'reviewed')
    }

    const logoutRes = await get('/api/admin/logout', {
      method: 'POST',
      headers: { cookie: cookieHeader },
    })
    check('POST /api/admin/logout -> 200', logoutRes.res.status === 200 && logoutRes.body?.data?.success === true)
  }

  const post = await get('/api/zones', { method: 'POST' })
  check('POST /api/zones -> 405', post.res.status === 405 && post.res.headers.get('allow') === 'GET, HEAD')
} catch (err) {
  console.error(`Could not reach ${base}: ${err instanceof Error ? err.message : err}`)
  console.error('Is the Worker running? Start it with: npm run worker:dev')
  process.exit(2)
}

console.log(failed ? `\n${failed} check(s) failed` : '\nAll smoke checks passed')
process.exit(failed ? 1 : 0)
