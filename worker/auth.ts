import type { Env } from './db'

export const COOKIE_NAME = 'gs_admin_session'
export const SESSION_LIFETIME_SECONDS = 8 * 60 * 60 // 8 hours

// In-memory rate limiter for login attempts (suitable for local MVP / single instance)
interface RateLimitRecord {
  attempts: number
  lockedUntilMs: number
}
const loginAttempts = new Map<string, RateLimitRecord>()
const MAX_ATTEMPTS = 5
const LOCKOUT_MS = 15 * 60 * 1000 // 15 minutes

export function checkLoginRateLimit(ip: string): { allowed: boolean; remainingSeconds?: number } {
  const now = Date.now()
  const record = loginAttempts.get(ip)
  if (!record) return { allowed: true }

  if (record.lockedUntilMs > now) {
    const remainingSeconds = Math.ceil((record.lockedUntilMs - now) / 1000)
    return { allowed: false, remainingSeconds }
  }

  // If lockout expired, reset
  if (record.lockedUntilMs > 0 && record.lockedUntilMs <= now) {
    loginAttempts.delete(ip)
    return { allowed: true }
  }

  return { allowed: true }
}

export function recordFailedLogin(ip: string): void {
  const now = Date.now()
  const record = loginAttempts.get(ip) ?? { attempts: 0, lockedUntilMs: 0 }
  record.attempts += 1
  if (record.attempts >= MAX_ATTEMPTS) {
    record.lockedUntilMs = now + LOCKOUT_MS
  }
  loginAttempts.set(ip, record)
}

export function resetLoginAttempts(ip: string): void {
  loginAttempts.delete(ip)
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return mismatch === 0
}

export async function sha256Hex(data: string): Promise<string> {
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data))
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function pbkdf2Hex(password: string, saltHex: string): Promise<string> {
  const saltBytes = new Uint8Array(
    saltHex.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) ?? []
  )
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  )
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  )
  return Array.from(new Uint8Array(derivedBits))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export function isAuthConfigured(env: Env): boolean {
  if (env.ADMIN_PASSWORD_HASH && env.ADMIN_PASSWORD_SALT) return true
  if (env.ADMIN_PASSWORD && env.ADMIN_PASSWORD.trim().length > 0) return true
  return false
}

export async function verifyAdminPassword(env: Env, candidate: string): Promise<boolean> {
  if (!isAuthConfigured(env)) return false

  if (env.ADMIN_PASSWORD_HASH && env.ADMIN_PASSWORD_SALT) {
    const derived = await pbkdf2Hex(candidate, env.ADMIN_PASSWORD_SALT)
    return timingSafeEqual(derived, env.ADMIN_PASSWORD_HASH)
  }

  if (env.ADMIN_PASSWORD) {
    // Salt derived deterministically from fixed application namespace for local dev fallback
    const localSalt = await sha256Hex('geoshield-local-admin-salt')
    const derivedCandidate = await pbkdf2Hex(candidate, localSalt.slice(0, 32))
    const derivedExpected = await pbkdf2Hex(env.ADMIN_PASSWORD, localSalt.slice(0, 32))
    return timingSafeEqual(derivedCandidate, derivedExpected)
  }

  return false
}

export function generateSessionToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export function isRequestSecure(request: Request): boolean {
  return request.url.startsWith('https://') || request.headers.get('x-forwarded-proto') === 'https'
}

export function parseSessionCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null
  const match = cookieHeader.match(/(?:^|;\s*)gs_admin_session=([^;]+)/)
  return match ? decodeURIComponent(match[1].trim()) : null
}

export function buildSessionCookie(token: string, isSecure: boolean, maxAgeSeconds: number = SESSION_LIFETIME_SECONDS): string {
  const secureFlag = isSecure ? '; Secure' : ''
  return `gs_admin_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=${maxAgeSeconds}${secureFlag}`
}

export function buildClearSessionCookie(isSecure: boolean): string {
  const secureFlag = isSecure ? '; Secure' : ''
  return `gs_admin_session=; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secureFlag}`
}

export function validateOrigin(request: Request): boolean {
  const origin = request.headers.get('origin')
  if (!origin) return true // Non-browser / same-origin without origin header

  try {
    const originUrl = new URL(origin)
    const requestUrl = new URL(request.url)

    // Match exact origin (protocol + host + port)
    if (originUrl.origin === requestUrl.origin) return true

    // In local development, Vite dev server (:5173) calls local worker (:8787)
    const allowedLocalPorts = ['5173', '8787', '3000', '4173']
    if (
      (originUrl.hostname === 'localhost' || originUrl.hostname === '127.0.0.1') &&
      (requestUrl.hostname === 'localhost' || requestUrl.hostname === '127.0.0.1') &&
      allowedLocalPorts.includes(originUrl.port)
    ) {
      return true
    }

    return false
  } catch {
    return false
  }
}

export interface AuthenticatedAdmin {
  adminId: string
  sessionIdHash: string
}

export async function authenticateAdminRequest(env: Env, request: Request): Promise<AuthenticatedAdmin | null> {
  const token = parseSessionCookie(request.headers.get('cookie'))
  if (!token || token.length < 32) return null

  const tokenHash = await sha256Hex(token)
  const now = new Date().toISOString()

  try {
    const session = await env.DB.prepare(
      'SELECT session_id_hash, admin_id, expires_at, revoked_at FROM admin_sessions WHERE session_id_hash = ?'
    )
      .bind(tokenHash)
      .first<{ session_id_hash: string; admin_id: string; expires_at: string; revoked_at: string | null }>()

    if (!session) return null
    if (session.revoked_at !== null) return null
    if (session.expires_at <= now) return null

    return { adminId: session.admin_id, sessionIdHash: session.session_id_hash }
  } catch (err) {
    console.error('[auth] database error verifying session:', err)
    return null
  }
}
