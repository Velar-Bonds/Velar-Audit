<div align="center">

# Velar Audit

**Donation auditability for political financing**

Every donation a political party receives is traceable from the moment it arrives
to the moment it is verified, flagged, or returned — with the evidence anchored on
a public blockchain and the donor's identity never leaving the KYC provider.

<br>

![Node.js](https://img.shields.io/badge/Node.js-22+-1d70b8?style=for-the-badge&logo=nodedotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-1d70b8?style=for-the-badge&logo=typescript&logoColor=white)
![Tether WDK](https://img.shields.io/badge/Tether_WDK-0c2d4a?style=for-the-badge&logo=tether&logoColor=white)
![QVAC](https://img.shields.io/badge/QVAC_Local_AI-0c2d4a?style=for-the-badge&logo=probot&logoColor=white)
![Ethereum](https://img.shields.io/badge/Sepolia-14528c?style=for-the-badge&logo=ethereum&logoColor=white)
![License](https://img.shields.io/badge/MIT-6b7885?style=for-the-badge)

**Aleph Hackathon 2026** · Tether **WDK** + **QVAC** tracks

</div>

---

## Why this exists

Costa Rica's **Tribunal Supremo de Elecciones (TSE)** — the Supreme Electoral
Tribunal — supervises how political parties are financed. It is one of the most
respected electoral authorities in Latin America, and the constitutional body
responsible for guaranteeing that elections are clean.

But the trail it supervises is paper. Nobody can independently verify who gave
what, when, or whether the money was legal. The controls that do exist happen
months after an election, when the result is already decided and the money is
already spent.

**The TSE's president and magistrates asked us to build this.** After seeing our
work on bond traceability, they asked for the same treatment applied to
donations. This is not a hypothetical problem we invented to have something to
demo — it is a request from the institution that would use it.

### The constraint that shapes everything

Donor identity is sensitive and legally protected. The *fact* of a donation and
its compliance status must be publicly verifiable. Those two requirements pull in
opposite directions, and reconciling them is the entire design problem.

The answer: **sensitive data stays off-chain with the provider that collected it,
and only hashes go on-chain.** A regulator can verify that a donation was
assessed, when, and against what evidence — without anyone learning who the donor
was.

---

## Run it

Requires **Node 22 or later**. No database and no API keys.

```bash
git clone https://github.com/Velar-Bonds/Velar-Audit.git
cd Velar-Audit
npm install
cp .env.example .env
npm run wallet:new
```

Paste the printed phrase into `.env` as `WDK_SEED_PHRASE`. This step is not
optional: every wallet-touching call refuses to run without it. Then:

```bash
npm start
```

Open <http://localhost:3400>. Sign in with one of the demonstration accounts —
the password for all three is `velar-demo-2026`:

| Account | Role | Sees |
|---|---|---|
| `tse@velar.cr` | Electoral tribunal | Every donation, across all parties |
| `alfa@velar.cr` | Party treasurer | Only Partido Alfa's donations |
| `beta@velar.cr` | Party treasurer | Only Partido Beta's donations |

What you get is a fully working app with an empty ledger. Zero donations is the
real empty state, not a stub: the sign-in screen, the party isolation, and the
dashboard all run against the same code path that later shows live chain data.
No testnet funds are required for this.

### Loading the demonstration scenario

Seeing donations that cover every compliance outcome — foreign donor, over-cap,
KYC failure, and the rest — means sending real transactions on Sepolia. That
needs a small amount of free testnet ETH and three commands.

```bash
npm run donor:new
```

Paste the printed phrase into `.env` as `DONOR_SEED_PHRASE`. Fund that donor
wallet with Sepolia ETH from a faucet (Google Cloud and Alchemy both hand it
out). Then:

```bash
npm run provision
npm run seed:chain
```

`provision` mints test USDT via Aave's Sepolia faucet contract and tops up the
party wallets with gas. `seed:chain` sends the donations on-chain. The indexer
picks them up the same way it would pick up any other transfer — because they
are ordinary transfers.

---

## How a donation flows through the system

### Where donations come from

A donor sends **USDC** (or any ERC-20 the party accepts) from their own wallet
directly to the party's public address. There is no payment page, no checkout, no
intermediary: the party publishes its address, and the donor sends money to it
the same way they would send it to any other wallet.

This is deliberate. The moment a platform sits between the donor and the party,
that platform becomes something the TSE has to trust — and something that could
quietly reorder, delay, or hide a transaction. Here the blockchain is the
intake channel, and the system's job is to *observe* it rather than to *operate*
it.

### 1 — Intake

The party's donation wallet is built with **Tether's Wallet Development Kit
(WDK)** and is fully self-custodial: the seed phrase belongs to the party, and no
exchange or custodian holds the funds.

An indexer reads ERC-20 `Transfer` logs straight from the chain and records every
incoming transaction. **A donation cannot arrive without being recorded**, because
the record is built from what the chain says, not from what the party reports.

Each party gets its own account index derived from the same seed phrase, so a
deployment with many parties needs one seed and many addresses — and donations to
different parties are separated on-chain, not by a column in a database.

### 2 — Evidence link

A third-party KYC and source-of-funds provider issues an **attestation** for each
donation. The system keeps two things:

- a **pseudonymous donor reference**, stable across donations so contributions can
  be totalled against the legal cap
- the **SHA-256 hash** of the attestation payload

The payload itself — the name, the identity document, the bank trail — never
enters this system. Hashing uses canonical JSON with sorted keys, so the TSE can
recompute a hash and get the same answer, which is what makes the evidence
reproducible rather than merely stored.

### 3 — Compliance

A deterministic rules engine evaluates each donation against Costa Rican
financing law and decides its status. A **QVAC agent then runs a language model
on the machine itself** to turn that decision into a sentence an auditor can
read.

Running locally is not a performance choice. The agent reasons over KYC and
source-of-funds data; sending that to a cloud API would hand a third party the
donor list of every political party in the country.

### 4 — Enforcement

Non-compliant donations are flagged for return. When the return is executed, the
refund transaction and the whole chain of events — attestation hash, verdict,
return — are anchored on-chain with a hash, a timestamp, and a transaction
reference.

The party wallet is gated by a WDK **`returns-only` policy**: outbound transfers
are denied unless the recipient is an address that has already donated to it. A
treasurer trying to move donated funds somewhere they do not belong does not get
a failed transaction — they never get a signature.

---

## Two design decisions worth defending

### The model writes, it does not judge

`src/compliance/rules.ts` decides compliance status.
`src/compliance/qvac-agent.ts` runs the local model to phrase that decision for a
human reader. **The model is never asked whether something is legal.**

A verdict that carries a legal consequence has to be reproducible by a regulator,
and a sampled language model is not reproducible. There is also a practical
reason: we tested it. A 1B model asked whether a foreign donation was legal
answered *"foreign financing is illegal, but this donation is not illegal"* in a
single sentence, and invented a statute requiring politically exposed persons to
be "publicly exposed". Fabricated electoral law reaching a TSE auditor is a real
harm, not a cosmetic defect.

The agent therefore includes a guard that discards any explanation contradicting
its own verdict, and falls back to the rule findings when that happens.

### The wallet enforces the rule itself

Compliance that lives only in an application is compliance that can be bypassed
by anyone with database access. Pushing the return rule down into the wallet's
policy engine means the constraint holds even against the party operating the
software.

---

## Compliance rules

| Rule | Severity | Basis |
|---|---|---|
| `foreign_donor` | Violation | Foreign political financing is illegal in Costa Rica, Colombia, Brazil and Argentina |
| `kyc_failed` | Violation | The provider could not verify the donor's identity |
| `undisclosed_source` | Violation | Anonymous donations are not admissible |
| `over_cap` | Violation | The donor exceeded the annual per-donor cap |
| `attestation_tampered` | Violation | The attestation hash does not reproduce |
| `no_attestation` | Warning → violation | Escalates when the cure window expires |
| `pep_donor` | Warning | Politically exposed person — manual TSE review |

> The foreign-financing prohibition is real law. **The numeric cap in
> `.env.example` is a placeholder**, not a legal figure. Confirm it against the
> Código Electoral before presenting it to the TSE as anything but an
> illustration.

---

## Who sees what

| | TSE | Party |
|---|---|---|
| View donations | Every party | Only its own |
| Return or re-assess | Any donation | Only its own |
| Full evidence log | Yes | No |
| Reload the demonstration data | Yes | No |

Isolation between parties is **not a filter on a list**. Every action against a
donation verifies ownership, and a party requesting another party's donation by
id receives **404, not 403** — because knowing that the donation exists is itself
information it is not entitled to.

Passwords are stored with `scrypt` and a per-user salt. Session tokens are stored
hashed, so a stolen database does not hand over live sessions. The login endpoint
answers in constant time whether or not the account exists, so the form cannot be
used to enumerate who works at the tribunal, and it locks out after eight failed
attempts per address.

---

## The interface

Four views, with a top navigation bar carrying identity and session, and a
sidebar carrying the sections:

| View | What it shows |
|---|---|
| **Resumen** | Headline figures, seven-day activity, compliance breakdown, the six-step verification flow, and the most recent donations |
| **Donaciones** | Filterable list with status tabs, search and pagination; each donation opens a five-step traceability timeline |
| **Cumplimiento** | Analysis agent status, a queue of donations needing attention ordered by risk, and a review panel |
| **Billeteras** | Balances per party with their derivation index, and the evidence-without-exposure diagram |

The interface is in Spanish, because the people who will use it are Costa Rican
electoral officials and party treasurers.

### Design basis

The visual language follows the UK
[Government Project Delivery design system](https://projectdelivery.gov.uk/get-involved/connect-and-contribute/publishing-content-on-the-government-project-delivery-website/design-system/),
which extends the GOV.UK Design System, combined with the density a data
dashboard needs. What was adopted is its accessibility discipline:

- The **yellow focus indicator** with a black underline — one of the
  best-tested accessibility patterns in existence, and one that does not rely on
  colour to be visible. It is the only rule in the stylesheet marked
  `!important`, so no component state can ever hide it.
- **Status tags in uppercase**, where the meaning is carried by the text rather
  than the colour, for anyone who cannot tell two reds from two greens.
- **Plain language** throughout: short sentences, full dates, no unexplained
  abbreviations.

What was *not* adopted is the identity: no crown, no GOV.UK wordmark, no British
government imagery. Citing an open design system is legitimate; appearing to be
another country's government service would not be.

### Nothing loads from a CDN

No part of the interface fetches anything from a third party at runtime. During a
hackathon the venue wifi is the adversary, and a dashboard that depends on
`fonts.googleapis.com` can show up blank in front of the judges.

- **Barlow, self-hosted** in `web/fonts/`. It is the typeface Project Delivery
  uses and it is Open Font Licence. GDS Transport, the GOV.UK typeface, is
  licensed **only for use on gov.uk services**, so it was never an option.
- **Charts drawn by hand in SVG** (`web/charts.js`, about 120 lines) instead of a
  charting library that would have brought React and a build step.
- **No icon library.** The design system is text-first.

### The interface does not invent numbers

Every figure on the dashboard comes from real donations that went through the
pipeline. Each donation shows **which engine assessed it** and **how many rules
were applied** — not a model confidence score, because no such number exists in
this system and fabricating one would be exactly the figure a judge asks to
verify.

---

## Going live

```bash
npm run qvac:pull     # download the model weights before you need them
```

`WDK_TOKEN_ADDRESS` is the only thing that changes between USDC, USDT, and
mainnet — the WDK code path is identical for any ERC-20. The party wallet
address is printed at startup and shown in the interface.

### Running QVAC on macOS

QVAC's native addon links against Homebrew's OpenSSL 3 at an absolute path.
Without it the worker cannot start, and the system falls back cleanly to the
rules engine — the interface reports this per row.

```bash
brew install openssl@3
```

The default model is `QWEN3_4B_INST_Q4_K_M` (about 2.4 GB). Do not drop to the
1B model to save the download: it reliably inverted the verdict it was asked to
restate, writing *"foreign donor (US), not rejected"* for a non-compliant
donation.

---

## Project layout

```
src/
  types.ts                       canonical data model
  store.ts                       audit store
  pipeline.ts                    intake → evidence → compliance → enforcement
  wallet/wdk.ts                  WDK party wallets + returns-only policy
  wallet/indexer.ts              ERC-20 Transfer log indexer
  attestation/hash.ts            canonical JSON + SHA-256
  attestation/stub-provider.ts   stand-in for a KYC provider
  compliance/rules.ts            deterministic rules — the authority
  compliance/qvac-agent.ts       local model — explanation only
  evidence/anchor.ts             hash + timestamp + transaction reference
  auth/                          scrypt passwords, hashed sessions, role gates
  seed.ts                        parties and demonstration accounts
  demo.ts                        demonstration scenario and 14 days of history
  server.ts                      HTTP API
web/
  index.html                     shell
  app.js                         router, views and state
  app.css                        design system
  charts.js                      SVG charts
  fonts/                         Barlow, self-hosted
```

## Commands

| Command | What it does |
|---|---|
| `npm start` | Run the server |
| `npm run dev` | Run with reload on change |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run qvac:pull` | Download the QVAC model weights |
| `npm run wallet:new` | Generate a party wallet seed phrase |
| `npm run donor:new` | Generate a donor wallet seed phrase |
| `npm run provision` | Mint test USDT and fund party wallets with gas |
| `npm run seed:chain` | Send real Sepolia donations covering every compliance outcome |
| `npm run faucet:usdt` | Mint test USDT from Aave's Sepolia faucet |

---

<div align="center">

MIT · [LICENSE](LICENSE)

</div>
