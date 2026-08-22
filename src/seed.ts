import { store } from './store.js'
import { authStore } from './auth/store.js'
import { hashPassword } from './auth/passwords.js'
import { newId } from './attestation/hash.js'
import type { Party } from './types.js'

/**
 * Parties and accounts for the demo.
 *
 * The party names are deliberately fictional. Attaching invented
 * non-compliance findings to a real Costa Rican party — even in a demo — would
 * be defamatory, and this system exists to be trusted by the tribunal that
 * supervises those parties.
 */

const PARTIES: Party[] = [
  { id: 'party-alfa', name: 'Alfa Party', code: 'ALFA', country: 'CR', walletIndex: 0 },
  { id: 'party-beta', name: 'Beta Party', code: 'BETA', country: 'CR', walletIndex: 1 },
]

/**
 * Demo password. Everyone gets the same one so a judge can log in as any role
 * without a credential handoff. Override it with DEMO_PASSWORD, and never point
 * this seed at anything but a demo.
 */
const DEMO_PASSWORD = process.env.DEMO_PASSWORD?.trim() || 'velar-demo-2026'

const ACCOUNTS = [
  { email: 'tse@velar.cr', role: 'tse' as const, partyId: null },
  { email: 'alfa@velar.cr', role: 'partido' as const, partyId: 'party-alfa' },
  { email: 'beta@velar.cr', role: 'partido' as const, partyId: 'party-beta' },
]

export async function seedIdentity(): Promise<void> {
  for (const party of PARTIES) store.putParty(party)

  const existing = authStore.users().length
  if (existing > 0) return

  const passwordHash = await hashPassword(DEMO_PASSWORD)
  for (const account of ACCOUNTS) {
    authStore.addUser({
      id: newId('usr'),
      email: account.email,
      role: account.role,
      partyId: account.partyId,
      passwordHash,
      createdAt: Date.now(),
    })
  }

  console.log(`[auth] demo accounts created — password: ${DEMO_PASSWORD}`)
  for (const account of ACCOUNTS) console.log(`         ${account.email} (${account.role})`)
}

export const demoParties = PARTIES
