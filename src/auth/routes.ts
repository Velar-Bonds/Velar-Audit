import { Router } from 'express'
import { authStore } from './store.js'
import { verifyPassword } from './passwords.js'
import { SESSION_COOKIE, requireAuth, toSafeUser, tokenFrom } from './middleware.js'
import type { AuthedRequest } from './middleware.js'

export const authRouter = Router()

/**
 * Login throttling, per email.
 *
 * Crude on purpose — an in-memory counter is the right size for this, and the
 * alternative was leaving an unlimited password oracle in front of the accounts
 * of party treasurers. Resets on restart, which is acceptable when the window
 * is minutes.
 */
const MAX_ATTEMPTS = 8
const WINDOW_MS = 10 * 60 * 1000
const attempts = new Map<string, { count: number; first: number }>()

function throttled(key: string): boolean {
  const entry = attempts.get(key)
  if (!entry) return false
  if (Date.now() - entry.first > WINDOW_MS) {
    attempts.delete(key)
    return false
  }
  return entry.count >= MAX_ATTEMPTS
}

function recordFailure(key: string): void {
  const entry = attempts.get(key)
  if (!entry || Date.now() - entry.first > WINDOW_MS) {
    attempts.set(key, { count: 1, first: Date.now() })
    return
  }
  entry.count++
}

authRouter.post('/login', async (req, res) => {
  const email = String(req.body?.email ?? '').trim().toLowerCase()
  const password = String(req.body?.password ?? '')

  if (!email || !password) {
    return res.status(400).json({ error: 'Correo y contraseña son requeridos.' })
  }

  if (throttled(email)) {
    return res
      .status(429)
      .json({ error: 'Demasiados intentos fallidos. Esperá unos minutos.' })
  }

  const user = authStore.userByEmail(email)

  // Verify against a dummy hash when the user does not exist, so that a missing
  // account and a wrong password take the same time to answer. Otherwise the
  // login form doubles as a way to enumerate who works at the TSE.
  const hash = user?.passwordHash ?? 'scrypt$00$00'
  const ok = await verifyPassword(password, hash)

  if (!user || !ok) {
    recordFailure(email)
    return res.status(401).json({ error: 'Correo o contraseña incorrectos.' })
  }

  attempts.delete(email)
  const { token, expiresAt } = authStore.createSession(user.id)

  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure,
    expires: new Date(expiresAt),
    path: '/',
  })

  res.json({ user: toSafeUser(user) })
})

authRouter.post('/logout', (req, res) => {
  const token = tokenFrom(req)
  if (token) authStore.revokeSession(token)
  res.clearCookie(SESSION_COOKIE, { path: '/' })
  res.json({ ok: true })
})

authRouter.get('/me', requireAuth, (req: AuthedRequest, res) => {
  res.json({ user: toSafeUser(req.user!) })
})
