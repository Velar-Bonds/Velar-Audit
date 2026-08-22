import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type {
  Donation, Attestation, ComplianceVerdict, ReturnAction, EvidenceAnchor, AuditRow, Party,
} from './types.ts'

const DB_PATH = './data/velar-audit.json'

interface Db {
  parties: Party[]
  donations: Donation[]
  attestations: Attestation[]
  verdicts: ComplianceVerdict[]
  returns: ReturnAction[]
  anchors: EvidenceAnchor[]
  /** Highest block the indexer has processed, so restarts don't re-ingest. */
  cursor: number
}

const empty: Db = {
  parties: [], donations: [], attestations: [], verdicts: [], returns: [], anchors: [], cursor: 0,
}

function load(): Db {
  if (!existsSync(DB_PATH)) return structuredClone(empty)
  try {
    return { ...structuredClone(empty), ...JSON.parse(readFileSync(DB_PATH, 'utf8')) }
  } catch {
    console.warn('[store] corrupt db, starting fresh')
    return structuredClone(empty)
  }
}

let db = load()

function persist(): void {
  mkdirSync(dirname(DB_PATH), { recursive: true })
  writeFileSync(DB_PATH, JSON.stringify(db, null, 2))
}

export const store = {
  parties: () => db.parties,
  party: (id: string) => db.parties.find((p) => p.id === id) ?? null,

  putParty(party: Party): Party {
    db.parties = db.parties.filter((p) => p.id !== party.id)
    db.parties.push(party)
    persist()
    return party
  },

  /** Idempotent on txHash — the indexer is allowed to see the same tx twice. */
  addDonation(d: Donation): { donation: Donation; isNew: boolean } {
    const existing = db.donations.find((x) => x.txHash === d.txHash)
    if (existing) return { donation: existing, isNew: false }
    db.donations.push(d)
    persist()
    return { donation: d, isNew: true }
  },

  donations: () => db.donations,
  donation: (id: string) => db.donations.find((d) => d.id === id) ?? null,

  attestationFor: (donationId: string) =>
    db.attestations.find((a) => a.donationId === donationId) ?? null,

  /** All attestations for a donor, used to sum against the annual cap. */
  attestationsByDonor: (donorRef: string) =>
    db.attestations.filter((a) => a.donorRef === donorRef),

  putAttestation(a: Attestation): Attestation {
    db.attestations = db.attestations.filter((x) => x.donationId !== a.donationId)
    db.attestations.push(a)
    persist()
    return a
  },

  verdictFor: (donationId: string) =>
    db.verdicts.find((v) => v.donationId === donationId) ?? null,

  putVerdict(v: ComplianceVerdict): ComplianceVerdict {
    db.verdicts = db.verdicts.filter((x) => x.donationId !== v.donationId)
    db.verdicts.push(v)
    persist()
    return v
  },

  returnFor: (donationId: string) =>
    db.returns.find((r) => r.donationId === donationId) ?? null,

  returns: () => db.returns,

  putReturn(r: ReturnAction): ReturnAction {
    db.returns = db.returns.filter((x) => x.donationId !== r.donationId)
    db.returns.push(r)
    persist()
    return r
  },

  anchorsFor: (donationId: string) =>
    db.anchors.filter((a) => a.donationId === donationId),

  addAnchor(a: EvidenceAnchor): EvidenceAnchor {
    db.anchors.push(a)
    persist()
    return a
  },

  anchors: () => db.anchors,

  cursor: () => db.cursor,
  setCursor(block: number): void {
    db.cursor = block
    persist()
  },

  /**
   * The dashboard read model: newest donation first, everything joined.
   *
   * `partyId` scopes the result to one party. Passing null means "every party",
   * which only the TSE is ever allowed to ask for — enforced at the route, not
   * here, but the shape of this call is where the distinction lives.
   */
  auditRows(partyId: string | null = null): AuditRow[] {
    return [...db.donations]
      .filter((d) => partyId === null || d.partyId === partyId)
      .sort((a, b) => b.receivedAt - a.receivedAt)
      .map((donation) => ({
        donation,
        attestation: store.attestationFor(donation.id),
        verdict: store.verdictFor(donation.id),
        returnAction: store.returnFor(donation.id),
        anchors: store.anchorsFor(donation.id),
      }))
  },

  reset(): void {
    db = structuredClone(empty)
    persist()
  },
}
