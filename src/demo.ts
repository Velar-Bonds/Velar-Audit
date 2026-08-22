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

export async function seedDemo(): Promise<{ seeded: number; labels: string[] }> {
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
  console.log(`[demo] seeded ${rows.length} donations`)
  return { seeded: rows.length, labels: SCENARIOS.map((s) => s.label) }
}
