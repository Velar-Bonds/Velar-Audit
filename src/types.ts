/**
 * Testigo — canonical data model.
 *
 * Design rule inherited from the VELAR architecture: sensitive donor data never
 * lands here. We store a pseudonymous reference plus the HASH of the attestation
 * the KYC provider issued. Raw PII stays with the provider; the chain gets evidence.
 */

export type Chain = 'ethereum' | 'bitcoin'
export type AssetSymbol = 'ETH' | 'BTC' | 'USDT' | 'USDC'

/** ISO 3166-1 alpha-2. Costa Rica is the only compliant donor origin (see rules.ts). */
export type CountryCode = string

// ---------------------------------------------------------------------------
// 1. Intake — what the WDK indexer produces
// ---------------------------------------------------------------------------

export interface Donation {
  id: string
  /** On-chain transaction hash. Unique per chain; the natural primary key. */
  txHash: string
  chain: Chain
  asset: AssetSymbol
  /** Smallest unit (wei / satoshi / token base units). String to avoid f64 loss. */
  amountRaw: string
  /** Human-readable amount, derived from amountRaw and the asset's decimals. */
  amountDecimal: number
  /** Sender address as reported by the chain. Not an identity — see Attestation. */
  fromAddress: string
  /** The party wallet that received it. */
  toAddress: string
  blockNumber: number | null
  /** When the chain confirmed it (ms epoch), not when we indexed it. */
  receivedAt: number
  partyId: string
}

// ---------------------------------------------------------------------------
// 2. Evidence link — attestation from a third-party KYC / source-of-funds provider
// ---------------------------------------------------------------------------

export type SourceOfFunds =
  | 'salary'
  | 'business_income'
  | 'savings'
  | 'inheritance'
  | 'undisclosed'

export interface Attestation {
  id: string
  donationId: string
  /** Which provider vouched for this donor. */
  providerId: string
  /**
   * Pseudonymous donor handle from the provider. NEVER a name, cedula, or email.
   * Stable across donations so we can aggregate against the annual cap.
   */
  donorRef: string
  donorCountry: CountryCode
  sourceOfFunds: SourceOfFunds
  /** Did the provider complete identity verification? */
  kycVerified: boolean
  /** Is the donor a politically exposed person? Relevant to manual review. */
  isPep: boolean
  issuedAt: number
  /**
   * SHA-256 over the canonical attestation payload. This is what gets anchored
   * on-chain — the payload itself never leaves the provider boundary.
   */
  hash: string
}

// ---------------------------------------------------------------------------
// 3. Compliance — QVAC agent output
// ---------------------------------------------------------------------------

export type ComplianceStatus = 'verified' | 'pending' | 'non_compliant'

export interface ComplianceFinding {
  /** Machine-readable rule id, e.g. 'foreign_donor'. */
  code: string
  /** Human sentence shown in the dashboard, in Spanish. */
  message: string
  severity: 'info' | 'warning' | 'violation'
}

export interface ComplianceVerdict {
  donationId: string
  status: ComplianceStatus
  findings: ComplianceFinding[]
  /** Which engine produced this: the local QVAC model or the deterministic fallback. */
  engine: 'qvac' | 'rules'
  /** Free-text rationale from the local model. Empty for the rules engine. */
  rationale: string
  evaluatedAt: number
  /** Deadline for curing a `pending` verdict before it escalates (ms epoch). */
  cureDeadline: number | null
}

// ---------------------------------------------------------------------------
// 4. Enforcement — return flow and on-chain evidence
// ---------------------------------------------------------------------------

export type ReturnStatus = 'flagged' | 'returned' | 'overdue'

export interface ReturnAction {
  donationId: string
  status: ReturnStatus
  reason: string
  flaggedAt: number
  /** Must be returned by this time or it becomes an overdue violation. */
  dueBy: number
  executedAt: number | null
  /** Tx hash of the refund. Simulated in demo mode. */
  refundTxRef: string | null
}

export type EvidenceKind = 'attestation' | 'verdict' | 'return'

/**
 * The on-chain receipt: hash + timestamp + tx ref. This is the artifact the TSE
 * audits. Everything else in this system is a convenience index over these.
 */
export interface EvidenceAnchor {
  id: string
  kind: EvidenceKind
  /** What was anchored — the SHA-256 of the subject document. */
  subjectHash: string
  donationId: string
  anchoredAt: number
  /** Transaction that carries the hash. */
  txRef: string
  chain: Chain
  /** True when the anchor was written by the simulator rather than a real tx. */
  simulated: boolean
}

// ---------------------------------------------------------------------------
// Read model for the dashboard — one row per donation, everything joined
// ---------------------------------------------------------------------------

export interface AuditRow {
  donation: Donation
  attestation: Attestation | null
  verdict: ComplianceVerdict | null
  returnAction: ReturnAction | null
  anchors: EvidenceAnchor[]
}
