/**
 * Measure how reliably the local model restates a verdict.
 *
 * Running a demo once proves nothing about a small model: the failure modes
 * that matter are intermittent. This runs each scenario N times and reports
 * what actually came back, including the runs where the model had to be
 * overruled.
 *
 *   npm run qvac:bench            # 5 runs per scenario
 *   npm run qvac:bench -- 20      # 20
 *
 * A high `overruled` count is not a broken benchmark. It is the guard doing
 * its job, and it is the number worth publishing.
 */
import 'dotenv/config'
import { store } from '../store.js'
import { assess } from '../compliance/qvac-agent.js'
import { issueAttestation } from '../attestation/stub-provider.js'
import type { RuleContext } from '../compliance/rules.js'
import type { Attestation, Donation } from '../types.js'

const RUNS = Number(process.argv[2] ?? 5)

// The benchmark stages its own fixtures; it must not inherit a previous run.
store.reset()

/**
 * Each scenario gets its own donor.
 *
 * Sharing one address across all of them makes the annual cap accumulate
 * between unrelated cases, so a scenario meant to be clean inherits whatever
 * the previous ones spent.
 */
function donation(amount: number, tag: string): Donation {
  return {
    id: `don_${tag}`, txHash: '0x' + tag.padEnd(64, '0'), chain: 'ethereum', asset: 'USDT',
    amountRaw: String(amount * 1e6), amountDecimal: amount,
    fromAddress: '0x' + tag.padEnd(40, '1'), toAddress: '0x' + '2'.repeat(40),
    blockNumber: 1, receivedAt: Date.now(), partyId: 'party-alfa',
  }
}

/**
 * Built through the real provider so the hash reproduces.
 *
 * A hand-written hash trips `attestation_tampered` on every scenario, which
 * collapses the whole outcome space into non_compliant: the table then reports
 * five confident rows that are all measuring one code path, and the `verified`
 * path is never executed at all.
 */
function attestation(d: Donation, over: Partial<Attestation> = {}): Attestation {
  return issueAttestation({
    donation: d,
    donorRef: `donor-${d.id}`,
    donorCountry: (over.donorCountry ?? 'CR') as Attestation['donorCountry'],
    sourceOfFunds: over.sourceOfFunds ?? 'business_income',
    kycVerified: over.kycVerified ?? true,
    isPep: over.isPep ?? false,
    issuedAt: d.receivedAt,
  })
}

/**
 * The cap is an aggregate rule: it sums a donor's contributions from the store,
 * so a donation held in isolation can never trip it. The scenario has to be
 * staged, not merely described.
 */
function staged(d: Donation, a: Attestation | null): RuleContext {
  store.addDonation(d)
  if (a) store.putAttestation(a)
  return { donation: d, attestation: a, now: Date.now() }
}

const domestic = donation(500, 'a1')
const foreign = donation(500, 'b2')
const unverified = donation(500, 'c3')
const pep = donation(500, 'd4')
const bare = donation(500, 'e5')
const capped = donation(9_000, 'f6')

const SCENARIOS: { name: string; ctx: RuleContext }[] = [
  { name: 'domestic, within cap', ctx: staged(domestic, attestation(domestic)) },
  { name: 'foreign donor', ctx: staged(foreign, attestation(foreign, { donorCountry: 'US' as Attestation['donorCountry'] })) },
  { name: 'KYC not verified', ctx: staged(unverified, attestation(unverified, { kycVerified: false })) },
  { name: 'politically exposed donor', ctx: staged(pep, attestation(pep, { isPep: true })) },
  { name: 'no attestation', ctx: staged(bare, null) },
  { name: 'over the annual cap', ctx: staged(capped, attestation(capped)) },
]

console.log(`\n  QVAC reliability — ${RUNS} run(s) per scenario, model ${process.env.QVAC_MODEL}\n`)
console.log('  scenario                      status         qvac  overruled  silent   avg ms')
console.log('  ' + '─'.repeat(78))

let totalQvac = 0, totalOverruled = 0, totalSilent = 0, grandTotalMs = 0, totalRuns = 0

for (const { name, ctx } of SCENARIOS) {
  const statuses = new Set<string>()
  let qvac = 0, overruled = 0, silent = 0, ms = 0

  for (let i = 0; i < RUNS; i++) {
    const t0 = Date.now()
    const v = await assess({ ...ctx, now: Date.now() })
    ms += Date.now() - t0

    statuses.add(v.status)
    if (v.findings.some((f) => f.code === 'model_disagreement')) overruled++
    else if (v.engine === 'qvac') qvac++
    else silent++
  }

  // More than one status across identical inputs would mean the rules engine
  // is not deterministic, which is the one thing that must never be true.
  const status =
    statuses.size === 1 ? ([...statuses][0] ?? '—') : `UNSTABLE(${[...statuses].join('|')})`

  console.log(
    `  ${name.padEnd(29)} ${status.padEnd(14)} ${String(qvac).padStart(4)}` +
    `  ${String(overruled).padStart(9)}  ${String(silent).padStart(6)}  ${String(Math.round(ms / RUNS)).padStart(6)}`,
  )

  totalQvac += qvac; totalOverruled += overruled; totalSilent += silent
  grandTotalMs += ms; totalRuns += RUNS
}

console.log('  ' + '─'.repeat(78))
const pct = (n: number) => `${Math.round((n / totalRuns) * 100)}%`
console.log(
  `\n  ${totalRuns} inferences · rationale accepted ${pct(totalQvac)}` +
  ` · overruled by the guard ${pct(totalOverruled)} · no usable output ${pct(totalSilent)}`,
)
console.log(`  mean latency ${Math.round(grandTotalMs / totalRuns)} ms\n`)
console.log('  In every case the status came from the rules engine. The model')
console.log('  contributes prose, and a disagreement escalates for review.\n')

process.exit(0)
