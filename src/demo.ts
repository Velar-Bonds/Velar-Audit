import { store } from './store.ts'
import { injectDonation } from './wallet/indexer.ts'
import { issueAttestation } from './attestation/stub-provider.ts'
import { onDonation, onAttestation } from './pipeline.ts'
import type { CountryCode, SourceOfFunds } from './types.ts'

/**
 * The demo scenario.
 *
 * Four donations chosen to put one of each compliance outcome on screen at
 * once, plus the two violations that matter most politically: foreign money and
 * a donor over the legal cap. Reset and replay it with the dashboard button —
 * a demo you can rerun on demand is a demo that survives a judge asking
 * "can you show that again?"
 *
 * They are split across two parties on purpose: logged in as Alfa you see
 * three, as Beta one, as the TSE all four. Scoping you can see is scoping a
 * judge believes.
 */

interface Scenario {
  label: string
  partyId: string
  amountDecimal: number
  fromAddress: string
  /** Omit to leave the donation without an attestation. */
  attestation?: {
    donorRef: string
    donorCountry: CountryCode
    sourceOfFunds: SourceOfFunds
    kycVerified: boolean
    isPep: boolean
  }
}

const SCENARIOS: Scenario[] = [
  {
    label: 'clean domestic donation',
    partyId: 'party-alfa',
    amountDecimal: 1_500,
    fromAddress: '0xa11ce00000000000000000000000000000000001',
    attestation: {
      donorRef: 'donor-cr-001',
      donorCountry: 'CR',
      sourceOfFunds: 'salary',
      kycVerified: true,
      isPep: false,
    },
  },
  {
    label: 'awaiting attestation',
    partyId: 'party-alfa',
    amountDecimal: 800,
    fromAddress: '0xb0b0000000000000000000000000000000000002',
    // No attestation: sits in `pending` until the cure window expires.
  },
  {
    label: 'foreign donor — illegal financing',
    partyId: 'party-alfa',
    amountDecimal: 12_000,
    fromAddress: '0xf03e1900000000000000000000000000000003',
    attestation: {
      donorRef: 'donor-us-777',
      donorCountry: 'US',
      sourceOfFunds: 'business_income',
      kycVerified: true,
      isPep: false,
    },
  },
  {
    label: 'over the annual cap',
    partyId: 'party-beta',
    amountDecimal: 30_000,
    fromAddress: '0xcafe000000000000000000000000000000000004',
    attestation: {
      donorRef: 'donor-cr-042',
      donorCountry: 'CR',
      sourceOfFunds: 'business_income',
      kycVerified: true,
      isPep: true,
    },
  },
]

/**
 * Fourteen days of ordinary donation history behind the four hero cases.
 *
 * A compliance dashboard showing four rows tells a judge nothing about whether
 * it works at scale, and the activity chart has no shape to read. These are
 * seeded through the same pipeline as everything else — same rules, same
 * anchors — just scored without the local model, since re-running an LLM over
 * history already judged costs minutes and changes no verdict.
 */
const DAYS_OF_HISTORY = 14
const DAY_MS = 24 * 60 * 60 * 1000

/** Deterministic PRNG so every rehearsal produces the same chart. */
function makeRandom(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
}

async function seedHistory(): Promise<number> {
  const rand = makeRandom(20260822)
  const parties = store.parties()
  if (parties.length === 0) return 0

  let created = 0

  for (let daysAgo = DAYS_OF_HISTORY; daysAgo >= 1; daysAgo--) {
    // Weekends run quieter, which is what real donation traffic looks like.
    const date = new Date(Date.now() - daysAgo * DAY_MS)
    const weekend = date.getDay() === 0 || date.getDay() === 6
    const count = Math.floor(rand() * (weekend ? 3 : 6)) + (weekend ? 1 : 2)

    for (let i = 0; i < count; i++) {
      const party = parties[Math.floor(rand() * parties.length)]!
      const amount = Math.round((80 + rand() * 3_400) / 10) * 10
      const donorRef = `donor-cr-${String(Math.floor(rand() * 240)).padStart(3, '0')}`

      // A realistic tail of problems: most donations are simply fine.
      const roll = rand()
      const receivedAt =
        date.setHours(8 + Math.floor(rand() * 11), Math.floor(rand() * 60), 0, 0)

      const donation = await injectDonation(
        {
          amountDecimal: amount,
          fromAddress: `0x${Math.floor(rand() * 0xffffffff).toString(16).padStart(8, '0')}${'0'.repeat(32)}`,
          partyId: party.id,
          receivedAt,
        },
        (d) => onDonation(d, { useAgent: false }),
      )

      if (roll < 0.06) {
        // Left without an attestation — will age into a violation.
        created++
        continue
      }

      await onAttestation(
        issueAttestation({
          donation,
          donorRef,
          donorCountry: roll < 0.09 ? 'PA' : 'CR',
          sourceOfFunds: roll < 0.11 ? 'undisclosed' : rand() < 0.5 ? 'salary' : 'business_income',
          kycVerified: roll >= 0.13,
          isPep: rand() < 0.04,
        }),
        { useAgent: false },
      )
      created++
    }
  }

  return created
}

export async function seedDemo(): Promise<{ seeded: number; labels: string[] }> {
  const historical = await seedHistory()

  for (const scenario of SCENARIOS) {
    const donation = await injectDonation(
      {
        amountDecimal: scenario.amountDecimal,
        fromAddress: scenario.fromAddress,
        partyId: scenario.partyId,
      },
      onDonation,
    )

    if (scenario.attestation) {
      await onAttestation(issueAttestation({ donation, ...scenario.attestation }))
    }
  }

  const rows = store.auditRows()
  console.log(`[demo] seeded ${rows.length} donations (${historical} historical)`)
  return { seeded: rows.length, labels: SCENARIOS.map((s) => s.label) }
}
