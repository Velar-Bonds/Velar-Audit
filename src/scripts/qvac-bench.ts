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
import { assess } from '../compliance/qvac-agent.js'
import type { RuleContext } from '../compliance/rules.js'
import type { Attestation, Donation } from '../types.js'

const RUNS = Number(process.argv[2] ?? 5)

function donation(amount: number): Donation {
  return {
    id: 'don_bench', txHash: '0x' + '0'.repeat(64), chain: 'ethereum', asset: 'USDT',
    amountRaw: String(amount * 1e6), amountDecimal: amount,
    fromAddress: '0x' + '1'.repeat(40), toAddress: '0x' + '2'.repeat(40),
    blockNumber: 1, receivedAt: Date.now(), partyId: 'party-alfa',
  }
}

function attestation(over: Partial<Attestation> = {}): Attestation {
  return {
    id: 'att_bench', donationId: 'don_bench', providerId: 'stub-kyc-provider',
    donorRef: 'donor-bench', donorCountry: 'CR', sourceOfFunds: 'business_income',
    kycVerified: true, isPep: false, issuedAt: Date.now(), hash: 'a'.repeat(64),
    ...over,
  } as Attestation
}

const SCENARIOS: { name: string; ctx: RuleContext }[] = [
  {
    name: 'domestic, within cap',
    ctx: { donation: donation(500), attestation: attestation(), now: Date.now() },
  },
  {
    name: 'foreign donor',
    ctx: {
      donation: donation(500),
      attestation: attestation({ donorCountry: 'US' as Attestation['donorCountry'] }),
      now: Date.now(),
    },
  },
  {
    name: 'KYC not verified',
    ctx: { donation: donation(500), attestation: attestation({ kycVerified: false }), now: Date.now() },
  },
  {
    name: 'politically exposed donor',
    ctx: { donation: donation(500), attestation: attestation({ isPep: true }), now: Date.now() },
  },
  {
    name: 'no attestation',
    ctx: { donation: donation(500), attestation: null, now: Date.now() },
  },
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
