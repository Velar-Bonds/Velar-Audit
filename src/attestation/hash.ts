import { createHash, randomUUID } from 'node:crypto'

/**
 * Canonical JSON: keys sorted at every level, no whitespace. Two processes that
 * agree on the payload must agree on the hash, or the TSE cannot reproduce our
 * evidence. Never change this function without versioning the anchor format.
 */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(',')}}`
}

export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}

/** SHA-256 over the canonical form. This is the only hash we anchor. */
export function hashPayload(payload: unknown): string {
  return sha256(canonicalize(payload))
}

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 16)}`
}
