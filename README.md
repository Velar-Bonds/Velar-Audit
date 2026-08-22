# Velar Audit

Donation auditability for political financing. Every donation a party receives is
traceable from the moment it lands to the moment it is verified, flagged, or
returned — with the evidence anchored on a public chain and the donor's identity
never leaving the KYC provider.

Built at the **Aleph Hackathon 2026** for the **Tether WDK** and **QVAC** tracks.

---

## Why

Costa Rica's Tribunal Supremo de Elecciones supervises how political parties are
financed, but the trail it supervises is paper. Nobody can independently verify
who gave what, when, or whether the money was legal — and the checks that do
exist happen months after an election.

The TSE's president and magistrados asked us to build this after seeing our work
on bond traceability. This is the donation half of that ask.

The constraint that shapes everything: donor identity is sensitive and legally
protected, but the *fact* of a donation and its compliance status must be
publicly verifiable. So sensitive data stays off-chain with the provider that
collected it, and only hashes go on-chain.

---

## Run it

Needs Node 22+. Nothing else — no database, no API keys, no testnet funds.

```bash
git clone https://github.com/Velar-Bonds/Velar-Audit.git
cd Velar-Audit
npm install
cp .env.example .env
npm start
```

Open <http://localhost:3400> and press **Cargar escenario de demo**.

You get four donations covering every compliance outcome: one clean, one waiting
on its attestation, one from a foreign donor, one over the annual cap. Press
**Devolver** on a non-compliant donation to execute the return and watch the
on-chain evidence trail grow.

`DEMO_MODE=1` is the default: the chain is simulated and compliance runs on the
deterministic rules engine. The pipeline, the data model, and the dashboard are
identical to live mode — see [Going live](#going-live).

---

## What it does

**1 — Intake.** A self-custodial party wallet built on WDK receives donations. An
indexer reads ERC-20 `Transfer` logs straight from the chain, so a donation
cannot arrive without being recorded. The party does not self-report.

**2 — Evidence link.** A KYC / source-of-funds provider issues an attestation for
each donation. We keep a pseudonymous donor reference and the SHA-256 of the
attestation payload. The payload itself — the name, the ID number, the bank
trail — never enters this system.

**3 — Compliance.** A QVAC agent runs a language model *on the machine* and
assesses each donation against Costa Rican financing law. Running locally is not
a performance choice: a cloud API here would hand a third party the donor list of
every political party in the country.

**4 — Enforcement.** Non-compliant donations are flagged for return. The refund is
executed and the whole chain of events — attestation hash, verdict, return — is
anchored on-chain with a hash, a timestamp, and a transaction reference.

---

## Architecture

```
  donor ──USDC──▶ party wallet (WDK, self-custodial)
                        │
                        ▼
                  chain indexer  ──▶  donation record (off-chain)
                                            │
   KYC provider ──attestation hash──────────┤
   (no raw PII)                             │
                                            ▼
                              QVAC agent (local model)
                              + deterministic rules
                                            │
                        ┌───────────────────┴───────────────┐
                        ▼                                   ▼
                 compliance dashboard            on-chain evidence anchor
                 (party + TSE view)              hash + timestamp + tx ref
                        │
                        ▼
                 flag ▶ return ▶ anchored
```

### The model does not get the final word

`src/compliance/rules.ts` decides compliance status. `src/compliance/qvac-agent.ts`
runs the local model over the same data and contributes the written rationale an
auditor reads, plus any concern the rules did not encode — which escalates a
donation to review but can never clear a violation.

This is deliberate. A verdict that carries a legal consequence has to be
reproducible by a regulator, and a sampled language model is not reproducible.
When the model is unavailable the rules engine simply stands alone and the
dashboard says so, per row.

### The wallet enforces the rule itself

WDK's policy engine gates the party wallet with a `returns-only` policy: outbound
transfers are denied unless the recipient is an address that has already donated
to us. A treasurer who wants to move donated funds somewhere they do not belong
does not get a failed transaction — they never get a signature.

### What is anchored

Only hashes. The anchors are the only part of this system a regulator has to
trust; the database and the dashboard are a convenience layer that can be rebuilt
from them. A failed anchor records itself as `unanchored` rather than
disappearing, so a gap in the trail stays visible.

---

## Compliance rules

| Rule | Severity | Basis |
|---|---|---|
| `foreign_donor` | violation | Foreign political financing is illegal in CR, CO, BR and AR |
| `kyc_failed` | violation | Provider could not verify the donor's identity |
| `undisclosed_source` | violation | Anonymous donations are not admissible |
| `over_cap` | violation | Donor exceeded the annual per-donor cap |
| `attestation_tampered` | violation | Attestation hash does not reproduce |
| `no_attestation` | warning → violation | Escalates when the cure window expires |
| `pep_donor` | warning | Politically exposed person — manual TSE review |

> The foreign-financing prohibition is real law. **The numeric cap in
> `.env.example` is a placeholder**, not a legal figure — confirm it against the
> Código Electoral before this is presented to the TSE as anything but an
> illustration.

---

## Going live

```bash
npm run qvac:pull       # download model weights — do this first, before you need them
npm run wallet:new      # generate a BIP-39 seed for the party wallet
```

Put the seed in `.env` as `WDK_SEED_PHRASE`, set `DEMO_MODE=0`, fund the address
with Sepolia ETH and test USDC, then `npm start`.

`WDK_TOKEN_ADDRESS` is the only thing that changes between USDC, USDT, and
mainnet — the WDK code path is identical for any ERC-20.

---

## Layout

```
src/
  types.ts                  canonical data model
  store.ts                  append-only audit store
  pipeline.ts               intake → evidence → compliance → enforcement
  wallet/wdk.ts             WDK party wallet + returns-only policy
  wallet/indexer.ts         ERC-20 Transfer log indexer
  attestation/hash.ts       canonical JSON + SHA-256
  attestation/stub-provider.ts   stand-in for Sumsub / Truora
  compliance/rules.ts       deterministic rules — the authority
  compliance/qvac-agent.ts  local model — rationale and extra concerns
  evidence/anchor.ts        on-chain hash + timestamp + tx ref
  server.ts                 HTTP API
  demo.ts                   the four-donation scenario
web/index.html              dashboard, no build step
```

## Scripts

| Command | What it does |
|---|---|
| `npm start` | Run the server |
| `npm run dev` | Run with reload on change |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run qvac:pull` | Download the QVAC model weights |
| `npm run wallet:new` | Generate a party wallet seed phrase |
| `npm run donate:sim -- 2500 0xdonor…` | Push a donation into a running server |

---

## Honest status

Built in a hackathon weekend. What is real and what is not:

- **Real:** the data model, the hashing and anchor format, the compliance rules,
  the WDK wallet and policy integration, the ERC-20 log indexer, the QVAC
  integration and its fallback behaviour, the dashboard.
- **Simulated in demo mode:** the chain and the refund transaction. Anchors are
  marked `simulated` in the API and the UI — we do not dress them up as real.
- **Stubbed:** the KYC provider. The boundary is what matters; the implementation
  is one file.
- **Not built:** authentication, multi-party tenancy, the TSE's own login, and
  the bond-certificate lifecycle that the wider VELAR platform covers.

## License

MIT — see [LICENSE](LICENSE).
