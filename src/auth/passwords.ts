import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCb) as (
  password: string, salt: Buffer, keylen: number,
) => Promise<Buffer>

const KEYLEN = 64
const SALT_BYTES = 16

/**
 * scrypt with a per-password salt. Node ships it, so there is no dependency to
 * audit — which matters more than usual for a system holding the credentials of
 * party treasurers and electoral tribunal staff.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES)
  const derived = await scrypt(password, salt, KEYLEN)
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`
}

/** Constant-time verification. Returns false on any malformed stored hash. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false

  const salt = Buffer.from(parts[1]!, 'hex')
  const expected = Buffer.from(parts[2]!, 'hex')
  if (expected.length !== KEYLEN) return false

  const derived = await scrypt(password, salt, KEYLEN)
  return timingSafeEqual(derived, expected)
}

/** Minimum we are willing to accept. Short passwords are the actual attack. */
export function passwordProblem(password: string): string | null {
  if (typeof password !== 'string' || password.length < 10) {
    return 'La contraseña debe tener al menos 10 caracteres.'
  }
  if (password.length > 200) return 'La contraseña es demasiado larga.'
  return null
}
