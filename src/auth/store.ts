import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { dirname } from 'node:path'
import { config } from '../config.js'
import type { User } from '../types.js'

/**
 * Credentials live in their own file, apart from the donation ledger. Different
 * sensitivity, different lifetime, and it makes it obvious which file must
 * never be committed or shipped in a demo bundle.
 */
const DB_PATH = './data/auth.json'

const SESSION_TTL_MS = 12 * 60 * 60 * 1000 // 12h — longer than any demo, shorter than a leak

interface AuthDb {
  users: User[]
}

function load(): AuthDb {
  if (!existsSync(DB_PATH)) return { users: [] }
  try {
    const parsed = JSON.parse(readFileSync(DB_PATH, 'utf8'))
    return { users: parsed.users ?? [] }
  } catch {
    console.warn('[auth] corrupt auth db, starting fresh')
    return { users: [] }
  }
}

let db = load()

/** Best-effort, for the same reason as the donation store. */
let writable = true

function persist(): void {
  if (!writable) return
  try {
    mkdirSync(dirname(DB_PATH), { recursive: true })
    writeFileSync(DB_PATH, JSON.stringify(db, null, 2), { mode: 0o600 })
  } catch {
    writable = false
    console.warn('[auth] filesystem is read-only; sessions live in memory only')
  }
}

/**
 * Sessions are stateless: the cookie carries the claim and an HMAC over it, and
 * nothing about it is stored server-side.
 *
 * The stored-token design this replaces could not work on a serverless host.
 * Every cold start begins with an empty in-memory store and a read-only disk,
 * so a session issued by one instance was invisible to the next and the user
 * was thrown back to the login screen mid-click.
 *
 * The claim is the user's *email*, not their id: the demonstration accounts are
 * reseeded with a fresh random id on every boot, so an id is only stable within
 * one instance's lifetime — exactly the property that has to be avoided here.
 */
const SESSION_SECRET = (() => {
  const configured = config.auth.sessionSecret
  if (configured) return configured

  console.warn(
    '[auth] SESSION_SECRET is not set — using a per-process random secret.\n' +
    '       Fine locally. On a serverless host every instance picks a different\n' +
    '       one, so logins will appear to expire at random. Set it before deploying.',
  )
  return randomBytes(32).toString('hex')
})()

function sign(payload: string): string {
  return createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url')
}

/** Constant-time compare that tolerates length mismatch without throwing. */
function signatureMatches(expected: string, actual: string): boolean {
  const a = Buffer.from(expected)
  const b = Buffer.from(actual)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export const authStore = {
  userByEmail(email: string): User | null {
    const needle = email.trim().toLowerCase()
    return db.users.find((u) => u.email === needle) ?? null
  },

  userById: (id: string): User | null => db.users.find((u) => u.id === id) ?? null,

  users: () => db.users,

  addUser(user: User): User {
    if (authStore.userByEmail(user.email)) {
      throw new Error(`ya existe un usuario con el correo ${user.email}`)
    }
    db.users.push({ ...user, email: user.email.trim().toLowerCase() })
    persist()
    return user
  },

  /** Issue a session token. Nothing is stored: the token carries its own proof. */
  createSession(userId: string): { token: string; expiresAt: number } {
    const user = authStore.userById(userId)
    if (!user) throw new Error(`no existe el usuario ${userId}`)

    const expiresAt = Date.now() + SESSION_TTL_MS
    const payload = Buffer.from(`${user.email}|${expiresAt}`).toString('base64url')

    return { token: `${payload}.${sign(payload)}`, expiresAt }
  },

  /** Resolve a token to its user, or null if forged, malformed, or expired. */
  userForToken(token: string): User | null {
    if (!token) return null

    const dot = token.lastIndexOf('.')
    if (dot === -1) return null

    const payload = token.slice(0, dot)
    if (!signatureMatches(sign(payload), token.slice(dot + 1))) return null

    // Only decoded once the signature is known good, so a forged payload is
    // never parsed at all.
    const [email, expiresAt] = Buffer.from(payload, 'base64url').toString('utf8').split('|')
    if (!email || Number(expiresAt) < Date.now()) return null

    return authStore.userByEmail(email)
  },

  /**
   * Clearing the cookie is the whole of logout. A stateless token cannot be
   * recalled from the server, so the trade for surviving cold starts is that a
   * token already copied off the client stays valid until it expires — which is
   * why the TTL is 12 hours and not a week.
   */
  revokeSession(_token: string): void {},

  reset(): void {
    db = { users: [] }
    persist()
  },
}
