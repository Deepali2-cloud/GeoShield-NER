/**
 * The smallest slice of the D1 API this Worker uses. Cloudflare's real `D1Database` satisfies it
 * structurally, so `env.DB` can be passed as is, and tests can supply a local SQLite-backed stand-in.
 */
export interface D1StatementLike {
  bind(...values: unknown[]): D1StatementLike
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>
  first<T = Record<string, unknown>>(): Promise<T | null>
  run(): Promise<unknown>
}

export interface D1Like {
  prepare(query: string): D1StatementLike
  batch?<T = unknown>(statements: D1StatementLike[]): Promise<T[]>
}

export interface Env {
  /** D1 binding named `DB` in wrangler.jsonc. */
  DB: D1Like
  ADMIN_PASSWORD?: string
  ADMIN_PASSWORD_HASH?: string
  ADMIN_PASSWORD_SALT?: string
}
