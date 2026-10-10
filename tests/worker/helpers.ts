import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import type { D1Like, D1StatementLike, Env } from '../../worker/db'
import { handleRequest } from '../../worker/index'

/**
 * Test database: an in-memory SQLite (Node's built-in `node:sqlite`) exposing the same slice of the D1 API
 * the Worker uses (prepare / bind / all / first). No Cloudflare account, network or production data is involved.
 * D1 is SQLite, so the migration and seed SQL run unchanged.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export const readMigrations = (): { name: string; sql: string }[] =>
  readdirSync(path.join(ROOT, 'migrations'))
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((name) => ({ name, sql: readFileSync(path.join(ROOT, 'migrations', name), 'utf8') }))

export const readSeedSql = (): string => readFileSync(path.join(ROOT, 'seed', 'demo_zones.sql'), 'utf8')

class Statement implements D1StatementLike {
  private readonly db: DatabaseSync
  private readonly sql: string
  private readonly params: unknown[]
  constructor(db: DatabaseSync, sql: string, params: unknown[] = []) {
    this.db = db
    this.sql = sql
    this.params = params
  }
  bind(...values: unknown[]): D1StatementLike {
    return new Statement(this.db, this.sql, values)
  }
  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    const rows = this.db.prepare(this.sql).all(...(this.params as never[]))
    return { results: rows.map((r) => ({ ...r })) as T[] }
  }
  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...(this.params as never[]))
    return row ? ({ ...row } as T) : null
  }
  async run(): Promise<unknown> {
    return this.db.prepare(this.sql).run(...(this.params as never[]))
  }
}

export interface TestDb {
  raw: DatabaseSync
  db: D1Like
  env: Env
}

export interface CreateTestDbOptions {
  migrate?: boolean
  seed?: boolean
  envOverrides?: Partial<Env>
}

export function createTestDb({ migrate = true, seed = true, envOverrides = {} }: CreateTestDbOptions = {}): TestDb {
  const raw = new DatabaseSync(':memory:')
  if (migrate) for (const m of readMigrations()) raw.exec(m.sql)
  if (migrate && seed) raw.exec(readSeedSql())
  const db: D1Like = {
    prepare: (sql) => new Statement(raw, sql),
    batch: async <T = unknown>(statements: D1StatementLike[]): Promise<T[]> => {
      raw.exec('BEGIN TRANSACTION')
      try {
        const results = []
        for (const stmt of statements) {
          results.push(await stmt.run())
        }
        raw.exec('COMMIT')
        return results as T[]
      } catch (err) {
        raw.exec('ROLLBACK')
        throw err
      }
    },
  }
  return { raw, db, env: { DB: db, ...envOverrides } }
}

/** A database whose every call fails with a message full of internals, to prove none of it is leaked. */
export const LEAKY_MESSAGE = 'SQLITE_ERROR: no such table: zones at /srv/secret/db.sqlite token=abc123'
export const brokenEnv: Env = {
  DB: {
    prepare() {
      throw new Error(LEAKY_MESSAGE)
    },
  },
}

export async function api(env: Env, pathAndQuery: string, init?: RequestInit) {
  const res = await handleRequest(new Request(`http://localhost${pathAndQuery}`, init), env)
  const text = await res.text()
  let body: unknown = null
  try {
    body = JSON.parse(text)
  } catch {
    /* empty or non-JSON body */
  }
  return { res, text, body: body as Record<string, any> } // eslint-disable-line @typescript-eslint/no-explicit-any
}
