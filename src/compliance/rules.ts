import { config } from '../config.ts'
import { store } from '../store.ts'
import { verifyAttestation } from '../attestation/stub-provider.ts'
import type {
  Attestation, ComplianceFinding, ComplianceStatus, ComplianceVerdict, Donation,
} from '../types.ts'

/**
 * Deterministic compliance rules for political donations.
 *
 * This engine is the ground truth and the fallback. The QVAC agent runs the same
 * policy through a local model and adds a written rationale; when the model is
 * unavailable — or disagrees on a rule that carries a legal consequence — these
 * findings are what stand. A regulator has to be able to reproduce the verdict.
 *
 * DEMO POLICY. The foreign-donor prohibition is real law in CR/CO/BR/AR. The
 * numeric cap is a placeholder from .env; confirm it against the Codigo
 * Electoral before this is shown to the TSE as anything but an illustration.
 */

/** Demo conversion rates. Replace with a real oracle before mainnet. */
const USD_RATES: Record<string, number> = {
  USDT: 1, USDC: 1, ETH: 3000, BTC: 95000,
}

export function toUsd(amount: number, asset: string): number {
  return amount * (USD_RATES[asset] ?? 0)
}

export interface RuleContext {
  donation: Donation
  attestation: Attestation | null
  now: number
}

export function evaluateRules(ctx: RuleContext): ComplianceFinding[] {
  const { donation, attestation, now } = ctx
  const findings: ComplianceFinding[] = []

  // --- No attestation yet -------------------------------------------------
  if (!attestation) {
    const age = now - donation.receivedAt
    const expired = age > config.compliance.cureWindowMs
    findings.push({
      code: 'no_attestation',
      message: expired
        ? 'No identity or source-of-funds attestation within the cure window. Must be returned.'
        : 'Awaiting the identity and source-of-funds attestation from the provider.',
      severity: expired ? 'violation' : 'warning',
    })
    return findings
  }

  // --- Integrity ----------------------------------------------------------
  if (!verifyAttestation(attestation, donation)) {
    findings.push({
      code: 'attestation_tampered',
      message: 'The attestation hash does not reproduce. The evidence has been altered.',
      severity: 'violation',
    })
  }

  // --- Foreign financing: illegal in CR, CO, BR and AR --------------------
  if (attestation.donorCountry !== config.compliance.country) {
    findings.push({
      code: 'foreign_donor',
      message: `Foreign donor (${attestation.donorCountry}). Foreign political financing is illegal.`,
      severity: 'violation',
    })
  }

  // --- Identity -----------------------------------------------------------
  if (!attestation.kycVerified) {
    findings.push({
      code: 'kyc_failed',
      message: 'The provider could not verify the donor’s identity.',
      severity: 'violation',
    })
  }

  // --- Anonymous money ----------------------------------------------------
  if (attestation.sourceOfFunds === 'undisclosed') {
    findings.push({
      code: 'undisclosed_source',
      message: 'Source of funds not declared. Anonymous donations are not admissible.',
      severity: 'violation',
    })
  }

  // --- Annual cap, summed across every donation by this donor -------------
  const donorTotalUsd = store
    .attestationsByDonor(attestation.donorRef)
    .map((att) => store.donation(att.donationId))
    .filter((d): d is Donation => d !== null)
    .reduce((sum, d) => sum + toUsd(d.amountDecimal, d.asset), 0)

  if (donorTotalUsd > config.compliance.donorCapUsd) {
    findings.push({
      code: 'over_cap',
      message: `This donor has now given USD ${donorTotalUsd.toLocaleString('en-US')}, over the USD ${config.compliance.donorCapUsd.toLocaleString('en-US')} annual cap.`,
      severity: 'violation',
    })
  }

  // --- Politically exposed person: review, not rejection ------------------
  if (attestation.isPep) {
    findings.push({
      code: 'pep_donor',
      message: 'Politically exposed donor. Requires manual review by the electoral tribunal.',
      severity: 'warning',
    })
  }

  if (findings.length === 0) {
    findings.push({
      code: 'clear',
      message: 'Valid attestation, domestic donor, within the annual cap.',
      severity: 'info',
    })
  }

  return findings
}

export function statusFrom(findings: ComplianceFinding[]): ComplianceStatus {
  if (findings.some((f) => f.severity === 'violation')) return 'non_compliant'
  if (findings.some((f) => f.severity === 'warning')) return 'pending'
  return 'verified'
}

export function evaluate(ctx: RuleContext): ComplianceVerdict {
  const findings = evaluateRules(ctx)
  const status = statusFrom(findings)
  return {
    donationId: ctx.donation.id,
    status,
    findings,
    engine: 'rules',
    rationale: '',
    evaluatedAt: ctx.now,
    cureDeadline:
      status === 'pending' ? ctx.donation.receivedAt + config.compliance.cureWindowMs : null,
  }
}
