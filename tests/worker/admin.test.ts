// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { api, createTestDb } from './helpers'
import { pbkdf2Hex, sha256Hex } from '../../worker/auth'

describe('Worker Admin Auth API — POST /api/admin/login', () => {
  it('fails closed with 500 when no admin credentials are configured', async () => {
    const { env } = createTestDb() // No ADMIN_PASSWORD or ADMIN_PASSWORD_HASH
    const { res, body } = await api(env, '/api/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'any-password' }),
    })

    expect(res.status).toBe(500)
    expect(body.error?.code).toBe('internal_error')
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('rejects missing or empty password with 400', async () => {
    const { env } = createTestDb({ envOverrides: { ADMIN_PASSWORD: 'correct-secret' } })
    const { res, body } = await api(env, '/api/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })

    expect(res.status).toBe(400)
    expect(body.error?.code).toBe('bad_request')
  })

  it('rejects incorrect password with 401', async () => {
    const { env } = createTestDb({ envOverrides: { ADMIN_PASSWORD: 'correct-secret' } })
    const { res, body } = await api(env, '/api/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'wrong-password' }),
    })

    expect(res.status).toBe(401)
    expect(body.error?.code).toBe('unauthorized')
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('authenticates with ADMIN_PASSWORD, stores hashed session in D1, and returns HttpOnly cookie', async () => {
    const { env, raw } = createTestDb({ envOverrides: { ADMIN_PASSWORD: 'my-admin-password-123' } })
    const { res, body } = await api(env, '/api/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'my-admin-password-123' }),
    })

    expect(res.status).toBe(200)
    expect(body.data?.authenticated).toBe(true)
    expect(body.data?.adminId).toBe('admin')

    const setCookie = res.headers.get('set-cookie')
    expect(setCookie).not.toBeNull()
    expect(setCookie).toContain('gs_admin_session=')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Strict')
    expect(setCookie).toContain('Path=/api/admin')

    // Verify session stored in D1
    const sessions = raw.prepare('SELECT * FROM admin_sessions').all() as Array<{ session_id_hash: string; admin_id: string; revoked_at: string | null }>
    expect(sessions.length).toBe(1)
    expect(sessions[0].admin_id).toBe('admin')
    expect(sessions[0].revoked_at).toBeNull()
  })

  it('authenticates with precomputed PBKDF2 hash & salt', async () => {
    const saltHex = '0123456789abcdef0123456789abcdef'
    const hashHex = await pbkdf2Hex('hash-tested-password', saltHex)
    const { env } = createTestDb({
      envOverrides: {
        ADMIN_PASSWORD_HASH: hashHex,
        ADMIN_PASSWORD_SALT: saltHex,
      },
    })

    const { res, body } = await api(env, '/api/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'hash-tested-password' }),
    })

    expect(res.status).toBe(200)
    expect(body.data?.authenticated).toBe(true)
  })

  it('rejects cross-origin login attempts (origin validation)', async () => {
    const { env } = createTestDb({ envOverrides: { ADMIN_PASSWORD: 'admin-password' } })
    const { res, body } = await api(env, '/api/admin/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://evil-attacker.example.com',
      },
      body: JSON.stringify({ password: 'admin-password' }),
    })

    expect(res.status).toBe(403)
    expect(body.error?.code).toBe('forbidden')
  })
})

describe('Worker Admin Session API — GET /api/admin/session', () => {
  it('returns 401 when no session cookie is present', async () => {
    const { env } = createTestDb({ envOverrides: { ADMIN_PASSWORD: 'secret' } })
    const { res, body } = await api(env, '/api/admin/session')

    expect(res.status).toBe(401)
    expect(body.error?.code).toBe('unauthorized')
  })

  it('returns 200 with session info when valid session cookie is sent', async () => {
    const { env, raw } = createTestDb({ envOverrides: { ADMIN_PASSWORD: 'secret' } })
    const token = 'test-token-value-12345678901234567890'
    const tokenHash = await sha256Hex(token)
    const now = new Date().toISOString()
    const expiresAt = new Date(Date.now() + 8 * 3600 * 1000).toISOString()

    raw.prepare(
      `INSERT INTO admin_sessions (session_id_hash, admin_id, created_at, expires_at)
       VALUES (?, 'admin', ?, ?)`,
    ).run(tokenHash, now, expiresAt)

    const { res, body } = await api(env, '/api/admin/session', {
      headers: { cookie: `gs_admin_session=${token}` },
    })

    expect(res.status).toBe(200)
    expect(body.data?.authenticated).toBe(true)
    expect(body.data?.adminId).toBe('admin')
  })

  it('returns 401 when session is expired', async () => {
    const { env, raw } = createTestDb({ envOverrides: { ADMIN_PASSWORD: 'secret' } })
    const token = 'expired-token-value-123456789012345'
    const tokenHash = await sha256Hex(token)
    const past = new Date(Date.now() - 10000).toISOString()

    raw.prepare(
      `INSERT INTO admin_sessions (session_id_hash, admin_id, created_at, expires_at)
       VALUES (?, 'admin', ?, ?)`,
    ).run(tokenHash, past, past)

    const { res, body } = await api(env, '/api/admin/session', {
      headers: { cookie: `gs_admin_session=${token}` },
    })

    expect(res.status).toBe(401)
    expect(body.error?.code).toBe('unauthorized')
  })

  it('returns 401 when session has been revoked', async () => {
    const { env, raw } = createTestDb({ envOverrides: { ADMIN_PASSWORD: 'secret' } })
    const token = 'revoked-token-value-123456789012345'
    const tokenHash = await sha256Hex(token)
    const now = new Date().toISOString()
    const expiresAt = new Date(Date.now() + 8 * 3600 * 1000).toISOString()

    raw.prepare(
      `INSERT INTO admin_sessions (session_id_hash, admin_id, created_at, expires_at, revoked_at)
       VALUES (?, 'admin', ?, ?, ?)`,
    ).run(tokenHash, now, expiresAt, now)

    const { res, body } = await api(env, '/api/admin/session', {
      headers: { cookie: `gs_admin_session=${token}` },
    })

    expect(res.status).toBe(401)
    expect(body.error?.code).toBe('unauthorized')
  })
})

describe('Worker Admin Logout API — POST /api/admin/logout', () => {
  it('revokes session in database and clears the cookie', async () => {
    const { env, raw } = createTestDb({ envOverrides: { ADMIN_PASSWORD: 'secret' } })
    const token = 'logout-test-token-123456789012345'
    const tokenHash = await sha256Hex(token)
    const now = new Date().toISOString()
    const expiresAt = new Date(Date.now() + 8 * 3600 * 1000).toISOString()

    raw.prepare(
      `INSERT INTO admin_sessions (session_id_hash, admin_id, created_at, expires_at)
       VALUES (?, 'admin', ?, ?)`,
    ).run(tokenHash, now, expiresAt)

    const { res, body } = await api(env, '/api/admin/logout', {
      method: 'POST',
      headers: { cookie: `gs_admin_session=${token}` },
    })

    expect(res.status).toBe(200)
    expect(body.data?.success).toBe(true)

    // Verify cookie cleared
    const setCookie = res.headers.get('set-cookie')
    expect(setCookie).toContain('Max-Age=0')

    // Verify session revoked in D1
    const row = raw.prepare('SELECT revoked_at FROM admin_sessions WHERE session_id_hash = ?').get(tokenHash) as { revoked_at: string | null }
    expect(row?.revoked_at).not.toBeNull()
  })
})

describe('Worker Admin Reports Moderation — GET /api/admin/reports & PATCH /api/admin/reports/:id/status', () => {
  async function setupAuthenticatedAdmin() {
    const { env, raw } = createTestDb({ envOverrides: { ADMIN_PASSWORD: 'secret' } })
    const token = 'mod-auth-token-123456789012345678'
    const tokenHash = await sha256Hex(token)
    const now = new Date().toISOString()
    const expiresAt = new Date(Date.now() + 8 * 3600 * 1000).toISOString()

    raw.prepare(
      `INSERT INTO admin_sessions (session_id_hash, admin_id, created_at, expires_at)
       VALUES (?, 'admin', ?, ?)`,
    ).run(tokenHash, now, expiresAt)

    return { env, raw, token }
  }

  it('rejects moderation requests without valid session', async () => {
    const { env } = createTestDb({ envOverrides: { ADMIN_PASSWORD: 'secret' } })
    const { res } = await api(env, '/api/admin/reports')
    expect(res.status).toBe(401)

    const patchRes = await api(env, '/api/admin/reports/rep_123/status', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'reviewed' }),
    })
    expect(patchRes.res.status).toBe(401)
  })

  it('lists all reports including non-pending ones with moderation capability', async () => {
    const { env, token, raw } = await setupAuthenticatedAdmin()
    const now = new Date().toISOString()

    raw.prepare(
      `INSERT INTO reports (id, zone_id, category, title, description, status, created_at, updated_at)
       VALUES ('r1', 'gangtok', 'Landslide', 'Rockfall', 'On highway', 'pending', ?, ?),
              ('r2', 'gangtok', 'Heavy rainfall or waterlogging', 'Stream overflow', 'Near road', 'resolved', ?, ?)`,
    ).run(now, now, now, now)

    const { res, body } = await api(env, '/api/admin/reports', {
      headers: { cookie: `gs_admin_session=${token}` },
    })

    expect(res.status).toBe(200)
    expect(body.data?.reports?.length).toBe(2)
  })

  it('rejects transitions back to pending', async () => {
    const { env, token, raw } = await setupAuthenticatedAdmin()
    const now = new Date().toISOString()

    raw.prepare(
      `INSERT INTO reports (id, zone_id, category, title, description, status, created_at, updated_at)
       VALUES ('r_test_1', 'gangtok', 'Landslide', 'Rockfall', 'On highway', 'reviewed', ?, ?)`,
    ).run(now, now)

    const { res, body } = await api(env, '/api/admin/reports/r_test_1/status', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        cookie: `gs_admin_session=${token}`,
      },
      body: JSON.stringify({ status: 'pending' }),
    })

    expect(res.status).toBe(400)
    expect(body.error?.code).toBe('bad_request')
    expect(body.error?.message).toMatch(/cannot be returned to pending/i)
  })

  it('rejects invalid moderation status strings', async () => {
    const { env, token, raw } = await setupAuthenticatedAdmin()
    const now = new Date().toISOString()

    raw.prepare(
      `INSERT INTO reports (id, zone_id, category, title, description, status, created_at, updated_at)
       VALUES ('r_test_2', 'gangtok', 'Landslide', 'Rockfall', 'On highway', 'pending', ?, ?)`,
    ).run(now, now)

    const { res, body } = await api(env, '/api/admin/reports/r_test_2/status', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        cookie: `gs_admin_session=${token}`,
      },
      body: JSON.stringify({ status: 'random_invalid_status' }),
    })

    expect(res.status).toBe(400)
    expect(body.error?.code).toBe('bad_request')
  })

  it('returns 404 when moderating a non-existent report', async () => {
    const { env, token } = await setupAuthenticatedAdmin()
    const { res, body } = await api(env, '/api/admin/reports/non_existent_report_id/status', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        cookie: `gs_admin_session=${token}`,
      },
      body: JSON.stringify({ status: 'reviewed' }),
    })

    expect(res.status).toBe(404)
    expect(body.error?.code).toBe('not_found')
  })

  it('updates report status and atomically records moderation audit entry', async () => {
    const { env, token, raw } = await setupAuthenticatedAdmin()
    const now = new Date().toISOString()

    raw.prepare(
      `INSERT INTO reports (id, zone_id, category, title, description, status, created_at, updated_at)
       VALUES ('rep_mod_target', 'gangtok', 'Landslide', 'Big slide', 'Description', 'pending', ?, ?)`,
    ).run(now, now)

    const { res, body } = await api(env, '/api/admin/reports/rep_mod_target/status', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        cookie: `gs_admin_session=${token}`,
      },
      body: JSON.stringify({ status: 'reviewed' }),
    })

    expect(res.status).toBe(200)
    expect(body.data?.report?.id).toBe('rep_mod_target')
    expect(body.data?.report?.status).toBe('reviewed')
    expect(body.data?.audit?.previousStatus).toBe('pending')
    expect(body.data?.audit?.newStatus).toBe('reviewed')
    expect(body.data?.audit?.adminId).toBe('admin')

    // Verify report updated in D1
    const reportRow = raw.prepare('SELECT status FROM reports WHERE id = ?').get('rep_mod_target') as { status: string }
    expect(reportRow.status).toBe('reviewed')

    // Verify audit entry in D1
    const auditRows = raw.prepare('SELECT * FROM moderation_audit WHERE report_id = ?').all('rep_mod_target') as Array<{
      report_id: string
      previous_status: string
      new_status: string
      admin_id: string
    }>
    expect(auditRows.length).toBe(1)
    expect(auditRows[0].previous_status).toBe('pending')
    expect(auditRows[0].new_status).toBe('reviewed')
    expect(auditRows[0].admin_id).toBe('admin')
  })
})
