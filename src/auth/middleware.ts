import type { NextFunction, Request, Response } from 'express'
import { authStore } from './store.js'
import { store } from '../store.js'
import type { Role, SafeUser, User } from '../types.js'

export const SESSION_COOKIE = 'velar_session'

/** Express does not carry our user; this is where it lives for a request. */
export interface AuthedRequest extends Request {
  user?: User
}

/** Minimal cookie parsing — one cookie, no dependency worth adding for it. */
function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() !== name) continue
    return decodeURIComponent(part.slice(eq + 1).trim())
  }
  return null
}

/** Accepts the session cookie, or a Bearer token for scripts and curl. */
export function tokenFrom(req: Request): string | null {
  const auth = req.headers.authorization
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim()
  return readCookie(req.headers.cookie, SESSION_COOKIE)
}

/** Attaches the user when a valid session exists. Never rejects on its own. */
export function authenticate(req: AuthedRequest, _res: Response, next: NextFunction): void {
  const token = tokenFrom(req)
  if (token) {
    const user = authStore.userForToken(token)
    if (user) req.user = user
  }
  next()
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Sesión requerida.' })
    return
  }
  next()
}

/**
 * Role gate. Kept separate from requireAuth so a 401 (log in) is never confused
 * with a 403 (logged in, not allowed) — the distinction matters when the
 * supervised is asking for the supervisor's view.
 */
export function requireRole(...roles: Role[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Sesión requerida.' })
      return
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: 'No tenés permiso para esta acción.' })
      return
    }
    next()
  }
}

/**
 * Which party's data this user may read.
 *
 * `null` means every party, and only the TSE ever gets it. A `partido` user
 * with a null partyId is a data bug, not an escalation path — it resolves to a
 * party id that matches nothing rather than to "see everything".
 */
export function scopeFor(user: User): string | null {
  if (user.role === 'tse') return null
  return user.partyId ?? '__no_party__'
}

/** Strip everything the client has no business knowing. */
export function toSafeUser(user: User): SafeUser {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    partyId: user.partyId,
    partyName: user.partyId ? (store.party(user.partyId)?.name ?? null) : null,
  }
}
