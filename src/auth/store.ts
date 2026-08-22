import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { dirname } from 'node:path'
import type { Session, User } from '../types.ts'

/**
 * Credentials live in their own file, apart from the donation ledger. Different
 * sensitivity, different lifetime, and it makes it obvious which file must
 * never be committed or shipped in a demo bundle.
 */
const DB_PATH = './data/auth.json'

const SESSION_TTL_MS = 12 * 60 * 60 * 1000 // 12h — longer than any demo, shorter than a leak

interface AuthDb {
  users: User[]
  sessions: Session[]
}

function load(): AuthDb {
  if (!existsSync(DB_PATH)) return { users: [], sessions: [] }
  try {
    const parsed = JSON.parse(readFileSync(DB_PATH, 'utf8'))
    return { users: parsed.users ?? [], sessions: parsed.sessions ?? [] }
  } catch {
    console.warn('[auth] corrupt auth db, starting fresh')
    return { users: [], sessions: [] }
  }
}

let db = load()

function persist(): void {
  mkdirSync(dirname(DB_PATH), { recursive: true })
  writeFileSync(DB_PATH, JSON.stringify(db, null, 2), { mode: 0o600 })
}

/**
 * Session tokens are stored hashed, for the same reason passwords are: a stolen
 * database should not hand over live sessions. SHA-256 is enough here because
 * the token is 32 random bytes, not a guessable secret.
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
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

  /** Issue a session and return the raw token — the only time it exists in plaintext. */
  createSession(userId: string): { token: string; expiresAt: number } {
    const token = randomBytes(32).toString('base64url')
    const now = Date.now()
    const expiresAt = now + SESSION_TTL_MS

    db.sessions.push({ tokenHash: hashToken(token), userId, createdAt: now, expiresAt })
    authStore.pruneExpired()
    persist()
    return { token, expiresAt }
  },

  /** Resolve a raw token to its user, or null if unknown or expired. */
  userForToken(token: string): User | null {
    if (!token) return null
    const wanted = Buffer.from(hashToken(token), 'hex')

    for (const session of db.sessions) {
      const candidate = Buffer.from(session.tokenHash, 'hex')
      if (candidate.length !== wanted.length) continue
      if (!timingSafeEqual(candidate, wanted)) continue
      if (session.expiresAt < Date.now()) return null
      return authStore.userById(session.userId)
    }
    return null
  },

  revokeSession(token: string): void {
    const target = hashToken(token)
    db.sessions = db.sessions.filter((s) => s.tokenHash !== target)
    persist()
  },

  pruneExpired(): void {
    const now = Date.now()
    db.sessions = db.sessions.filter((s) => s.expiresAt > now)
  },

  reset(): void {
    db = { users: [], sessions: [] }
    persist()
  },
}
