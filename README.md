<div align="center">

<img src="web/logo-readme.jpg" alt="AUDIT — Transparency you can verify" width="480">

### Donation auditability for political financing

Every donation a political party receives is traceable from the moment it
arrives to the moment it is verified, flagged, or returned — with the evidence
anchored on a public blockchain and the donor's identity never leaving the KYC
provider.

<br>

![Node.js](https://img.shields.io/badge/Node.js-22+-1d70b8?style=for-the-badge&logo=nodedotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-1d70b8?style=for-the-badge&logo=typescript&logoColor=white)
![Tether WDK](https://img.shields.io/badge/Tether_WDK-0c2d4a?style=for-the-badge&logo=tether&logoColor=white)
![QVAC](https://img.shields.io/badge/QVAC_Local_AI-0c2d4a?style=for-the-badge&logo=probot&logoColor=white)
![Ethereum](https://img.shields.io/badge/Sepolia-14528c?style=for-the-badge&logo=ethereum&logoColor=white)
![License](https://img.shields.io/badge/MIT-6b7885?style=for-the-badge)

<br>

**[Quick start](#quick-start)** · **[How it works](#how-it-works)** ·
**[QVAC](#qvac--local-inference)** · **[The views](#the-views)**

</div>

---

## Quick start

Requires **Node 22 or later**. No database, no API keys.

```bash
git clone https://github.com/Velar-Bonds/Velar-Audit.git
cd Velar-Audit
npm install
cp .env.example .env
npm run wallet:new
```

Paste the printed phrase into `.env` as `WDK_SEED_PHRASE`, then generate a
signing key for sessions:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Paste it as `SESSION_SECRET`. Then:

```bash
npm start
```

Open **<http://localhost:3400>**. Password for all three accounts is
`velar-demo-2026`:

| Account | Role | Sees |
|:--|:--|:--|
| `tse@velar.cr` | Electoral tribunal | Every donation, across all parties |
| `alfa@velar.cr` | Party treasurer | Only Partido Alfa's donations |
| `beta@velar.cr` | Party treasurer | Only Partido Beta's donations |

You get a working app with an empty ledger. Zero donations is the real empty
state, not a stub — the sign-in screen, the party isolation and the dashboard
all run against the same code path that later shows live chain data. **No
testnet funds are needed for this.**

<details>
<summary><b>Load the demonstration scenario</b> — real transactions on Sepolia</summary>

<br>

Seeing donations that cover every compliance outcome means sending real
transactions, which needs a little free testnet ETH.

```bash
npm run donor:new
```

Paste the phrase into `.env` as `DONOR_SEED_PHRASE`, fund that wallet from a
Sepolia faucet, then:

```bash
npm run provision      # mints test USD₮, tops up the party wallets with gas
npm run seed:chain     # sends the donations on-chain
```

For a single donation, with the amount and party you choose:

```bash
npm run donate -- alfa 1500
```

The indexer picks these up the same way it picks up any other transfer —
because they *are* ordinary transfers.

</details>

<details>
<summary><b>Run the local model</b> — QVAC weights</summary>

<br>

```bash
npm run qvac:pull
```

Downloads the weights once into `~/.qvac`. Choose the model with `QVAC_MODEL`
in `.env`. Budget the RAM: a 4B at Q4 wants roughly 4 GB, a 1.7B about half.

</details>

---

## What AUDIT is

A supervision instrument for political donations. A party publishes its wallet
address, a donor sends money straight to it, and AUDIT **watches the chain** and
builds the record: who received how much, when, backed by what identity
evidence, and whether it complies with the law.

It is not a payment platform and not a checkout. **It never touches the money.**
It sits beside the flow and verifies it.

### What the TSE is

The **Tribunal Supremo de Elecciones** — Costa Rica's Supreme Electoral Tribunal
— is the constitutional body that organises and supervises the country's
elections. It holds the rank of a fourth branch of government, and among its
duties is supervising how political parties are financed.

It is one of the most respected electoral authorities in Latin America. And the
trail it supervises is still paper.

### Why it needs this

> Nobody can independently verify who gave what, when, or whether the money was
> legal. The controls that exist happen **months after** an election — once the
> result is decided and the money is spent.

The problem is not a lack of will to supervise. It is that the information
arrives late, in a format nobody can cross-reference, and it comes from the very
parties being supervised.

**The TSE's president and magistrates asked for this.** After seeing VELAR's
work on bond traceability, they requested the same treatment applied to
donations. Not a hypothetical problem invented to have something to demo — a
request from the institution that would use it.

### How it differs from VELAR

| | Scope |
|:--|:--|
| **VELAR** | Traceability for public financial instruments, with the bond-certificate lifecycle at its centre, across several Latin American jurisdictions |
| **AUDIT** | The same evidence model applied to a different problem: the financing of political parties. The bond lifecycle is not part of it |

They share an architecture and a standard of proof. They share neither scope nor
database.

---

## The design problem

Donor identity is sensitive and legally protected. The **fact** of a donation
and its compliance status must be publicly verifiable.

Those two requirements pull in opposite directions, and reconciling them is the
whole problem.

**The answer:** sensitive data stays off-chain with the provider that collected
it, and only hashes go on-chain. A regulator can verify that a donation was
assessed, when, and against what evidence — without anyone learning who the
donor was.

---

## How it works

A donor sends USD₮ from their own wallet directly to the party's public address.
No payment page, no checkout, no intermediary.

This is deliberate. The moment a platform sits between donor and party, that
platform becomes something the TSE has to trust — and something that could
quietly reorder, delay, or hide a transaction. Here **the blockchain is the
intake channel**, and the system's job is to *observe* it rather than to
*operate* it.

### 1 · Intake

The party's donation wallet is built with **Tether's WDK** and is fully
self-custodial: the seed phrase belongs to the party, and no exchange or
custodian holds the funds.

An indexer reads ERC-20 `Transfer` logs straight from the chain. **A donation
cannot arrive without being recorded**, because the record is built from what
the chain says, not from what the party reports.

Each party gets its own derived account index off the same seed, so donations to
different parties are separated on-chain — not by a column in a database.

### 2 · Evidence link

A third-party KYC and source-of-funds provider issues an **attestation** per
donation. Two things are kept:

- a **pseudonymous donor reference**, stable across donations so contributions
  can be totalled against the legal cap
- the **SHA-256 hash** of the attestation payload

The payload itself — name, identity document, bank trail — never enters this
system. Hashing uses canonical JSON with sorted keys, so the TSE can recompute a
hash and get the same answer. That is what makes the evidence **reproducible**
rather than merely stored.

### 3 · Compliance

A deterministic rules engine evaluates every donation against financing law:
foreign donor, annual cap exceeded, KYC unverified, politically exposed person,
attestation missing.

That engine is the ground truth. A regulator has to be able to **reproduce** a
verdict, and reproducibility requires determinism.

On top of that decided result runs a **QVAC agent with a language model on the
machine itself**, turning rule codes into a sentence an auditor can read.

### 4 · Enforcement

Non-compliant donations are flagged for return. When the return executes, the
refund transaction and the whole chain of events — attestation hash, verdict,
return — are anchored on-chain with a hash, a timestamp and a transaction
reference.

The party wallet is gated by a WDK **`returns-only` policy**: outbound transfers
are denied unless the recipient is an address that has already donated to it. A
treasurer trying to move donated funds somewhere they do not belong does not get
a failed transaction — **they never get a signature.**

---

## QVAC — local inference

> **Track:** Small models, hard tasks — tool use & reliability

### Why local is not optional here

The agent reasons over KYC and source-of-funds data. Sending that to a cloud API
would hand a third party the donor list of every political party in the country.
There is no version of this product where that is acceptable — which makes
on-device inference a requirement, not a cost saving.

The design goes further than the boundary requires. In
[`buildPrompt`](src/compliance/qvac-agent.ts) the model receives the amount, the
donor's **country**, and the rule findings. No name, no national ID, no bank
detail. Even running locally, the model gets the minimum it needs.

### Where inference happens

| | |
|:--|:--|
| **SDK** | `@qvac/sdk` — on-device, no API keys, no network |
| **Capability** | Text generation with enforced structured output |
| **Model** | `QVAC_MODEL` in `.env` — Qwen3 1.7B Q4 and Qwen3 4B Q4_K_M both wired |
| **Integration** | [`src/compliance/qvac-agent.ts`](src/compliance/qvac-agent.ts) |
| **Model load** | `sdk.loadModel()`, memoised once per process |
| **Completion** | `sdk.completion()`, streamed token by token |
| **Call site** | [`src/pipeline.ts`](src/pipeline.ts) |
| **Weights** | `npm run qvac:pull` — downloaded once, cached in `~/.qvac` |

### A deliberately narrow job

The model **restates a decision that has already been made.** `rules.ts`
determines the status; the model turns rule codes into one readable sentence.

It is not allowed to reason about the law, and it is not asked to. A small model
asked whether a foreign donation was legal answered *"el financiamiento
extranjero es ilegal, pero esta donación no es ilegal"* in a single sentence,
and invented a statute requiring politically exposed persons to be *"expuestas
públicamente"*. Fabricated electoral law reaching a TSE auditor is a real harm,
not a cosmetic one — so the model never sees a question it could answer wrongly.

### Reliability engineering

Every guard below exists because of a failure that was observed, not
anticipated:

| Guard | The failure it closes |
|:--|:--|
| Constraints in the `system` turn | In the `user` turn, the model echoed them back as findings |
| Two-shot examples | Told the rules in prose, it prefaced every answer with commentary about them |
| `responseFormat` schema | Enforces structured output instead of parsing prose |
| `temp: 0.1` | A restatement is not a place for sampling variety |
| `predict: 800` | At 400 the JSON truncated mid-string, surfacing as a parse failure rather than as what it was |
| 400-character ceiling | A rephrasing that ran long had stopped being a rephrasing |
| Parse fallback | Unparseable output keeps the rules findings and drops the sentence |
| `contradictsVerdict()` | The model rendered a **non-compliant** donation as *"foreign donor (US), not rejected"* |

### The escalation path

When the model contradicts the rules engine, the contradiction is not discarded
quietly — it raises a `model_disagreement` finding at `warning` severity.

The severity is the whole design. `statusFrom` lets a `violation` outrank every
other severity, so a warning turns `verified` into `pending` and leaves
`non_compliant` exactly where it was.

> **The model can ask for a human. It can never clear one.**

Whatever made it disagree is usually a donation whose facts read ambiguously —
precisely the kind a person should look at. That asymmetry is the only shape in
which a language model belongs anywhere near an electoral record.

### Measuring it

```bash
npm run qvac:bench -- 20    # N runs per scenario: accepted, overruled, unusable, latency
npm run qvac:raw            # the model's output before any parsing touches it
```

Running a demo once proves nothing about a small model; the failure modes that
matter are intermittent.

---

## The views

### Public — no account required

| View | What it does |
|:--|:--|
| **Donate** `/#/donate` | Address and QR for each party. The QR is an EIP-681 link that opens the donor's wallet pre-filled with the right recipient, network and token contract |
| **Sign in** `/#/login` | Institutional access, with the three demonstration roles |

### For the tribunal and the parties

| View | What it does | Who |
|:--|:--|:--|
| **Overview** | Totals, distribution by status, recent activity | All |
| **Donations** | Reference, party, amount, asset, donor country, attestation hash, status, date. Filters by status and asset; search by reference, transaction hash or sending address | All |
| **Donation detail** | One donation's file: chain data, attestation, verdict with findings, evidence anchors, return action | All |
| **Compliance centre** | Only what needs attention — awaiting attestation with the cure window running, and non-compliant awaiting return. Assess and execute returns here | All |
| **Wallets** | Party addresses with native and token balances, read from the chain | All |
| **Audit trail** | Every evidence anchor: kind, hash, Merkle root, transaction reference, with a link to the explorer | All |
| **Public audit view** | What a third party can verify knowing nobody: donations, statuses and evidence, no personal data at all. Issues audit certificates | **TSE** |

**Party isolation.** A treasurer at Alfa sees only Alfa's donations and only
Alfa's wallet; the global anchor registry and the overdue sweep return `403`.
The TSE sees everything. Scope is resolved on the server, not by hiding rows in
the browser.

---

## One chain, always real

There is no simulated mode. The product's claim is that evidence is verifiable
on a public ledger, and a code path that fakes that claim is a code path that
can be demonstrated by accident.

The network is Sepolia and the asset is test USD₮. The transactions are real,
the anchors are real, and anyone can open them in the explorer.

---

<div align="center">

**MIT**

</div>
