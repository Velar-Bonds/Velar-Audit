import { config } from '../config.js'
import { evaluateRules, statusFrom } from './rules.js'
import type { RuleContext } from './rules.js'
import type {
  Attestation, ComplianceFinding, ComplianceStatus, ComplianceVerdict, Donation,
} from '../types.js'

/**
 * QVAC compliance agent — runs a language model ON THIS MACHINE.
 *
 * The whole reason this is local: the agent reasons over KYC and source-of-funds
 * data. Shipping that to a cloud API would hand a third party the donor list of
 * every political party in the country. Nothing leaves the device.
 *
 * The model's job is deliberately narrow: it RESTATES a decision that has
 * already been made. `rules.ts` determines the status; the model turns the
 * rule codes into one sentence an auditor can read.
 *
 * It is not allowed to reason about the law, and it is not asked to. We tried
 * that: a 1B model asked whether a foreign donation was legal answered "el
 * financiamiento extranjero es ilegal, pero esta donación no es ilegal" in a
 * single sentence, and invented a statute requiring politically exposed persons
 * to be "expuestas públicamente". Fabricated electoral law reaching a TSE
 * auditor is a real harm, not a cosmetic one — so the model never sees a
 * question it could answer wrongly.
 */

interface AgentOutput {
  rationale: string
}

/** Strict schema so the model returns parseable JSON instead of prose. */
const RESPONSE_SCHEMA = {
  type: 'json_schema',
  json_schema: {
    name: 'compliance_assessment',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        rationale: {
          type: 'string',
          description: 'A single English sentence restating the findings given.',
        },
      },
      required: ['rationale'],
      additionalProperties: false,
    },
  },
} as const

const SYSTEM_PROMPT = `You are a technical writer for an electoral tribunal.
You restate findings that have already been decided, in ONE English sentence of at most 40 words.
You never add information, never opine on legality, and never cite laws or articles.
You write only the final sentence, with no preamble and no commentary about these instructions.`

const FEW_SHOT = [
  {
    role: 'user',
    content: `DONATION: 12000 USDT from a donor in US
DECIDED RESULT: non_compliant
FINDINGS:
- Foreign donor (US). Foreign political financing is illegal.`,
  },
  {
    role: 'assistant',
    content:
      '{"rationale": "Donation of 12000 USDT rejected because it came from a foreign donor (US)."}',
  },
  {
    role: 'user',
    content: `DONATION: 1500 USDT from a donor in CR
DECIDED RESULT: verified
FINDINGS:
- Valid attestation, domestic donor, within the annual cap.`,
  },
  {
    role: 'assistant',
    content:
      '{"rationale": "Donation of 1500 USDT verified: domestic donor with a valid attestation and within the cap."}',
  },
]

const QVAC_MODULE = '@qvac/sdk'

let modelIdPromise: Promise<string | null> | null = null
let sdk: any = null

/**
 * Load the local model once and reuse it across donations. Returns null when
 * QVAC is unavailable — not an error, the caller falls back to the rules engine.
 */
async function getModelId(): Promise<string | null> {
  modelIdPromise ??= (async () => {
    if (config.demoMode) return null
    try {
      // Specifier held in a variable on purpose: '@qvac/sdk' is a genuinely
      // optional dependency — a 4.7 GB local-inference runtime that cannot be
      // installed everywhere this server runs — and a literal import would make
      // the type checker demand it be present at build time.
      sdk = await import(/* @vite-ignore */ QVAC_MODULE)

      const modelSrc = sdk[config.qvac.model]
      if (!modelSrc) {
        throw new Error(
          `unknown model constant '${config.qvac.model}' — see the exports of @qvac/sdk`,
        )
      }

      let lastPct = -1
      const modelId: string = await sdk.loadModel({
        modelSrc,
        onProgress: (p: any) => {
          const pct = Math.floor((p?.progress ?? 0) * 100)
          if (pct > lastPct && pct % 10 === 0) {
            console.log(`[qvac] downloading model… ${pct}%`)
            lastPct = pct
          }
        },
      })

      console.log(`[qvac] local model ready: ${config.qvac.model}`)
      return modelId
    } catch (err) {
      console.warn(
        `[qvac] local model unavailable (${(err as Error).message}). ` +
          'Falling back to the deterministic rules engine.',
      )
      return null
    }
  })()
  return modelIdPromise
}

/** Free the model's memory. Call on shutdown. */
export async function shutdown(): Promise<void> {
  const modelId = await modelIdPromise
  if (modelId && sdk) await sdk.unloadModel({ modelId }).catch(() => {})
}

function buildPrompt(
  donation: Donation,
  attestation: Attestation | null,
  status: string,
  findings: ComplianceFinding[],
): string {
  return `DONATION: ${donation.amountDecimal} ${donation.asset}${
    attestation ? ` from a donor in ${attestation.donorCountry}` : ' with no attestation'
  }
DECIDED RESULT: ${status}
FINDINGS:
${findings.map((f) => `- ${f.message}`).join('\n')}`
}

async function runModel(modelId: string, prompt: string): Promise<AgentOutput | null> {
  const run = sdk.completion({
    modelId,
    history: [
      // Constraints live in the system turn. Put them in the user turn and the
      // model echoes them back into the rationale as if they were findings.
      { role: 'system', content: SYSTEM_PROMPT },
      // Few-shot. A 1B model told the rules in prose keeps prefacing its answer
      // with commentary about the rules; shown two answers, it copies the form.
      ...FEW_SHOT,
      { role: 'user', content: prompt },
    ],
    responseFormat: RESPONSE_SCHEMA,
    // predict was 400 and truncated the JSON mid-string, which surfaced as a
    // parse failure rather than as what it actually was. One short sentence
    // needs far less than this, but the headroom costs nothing.
    generationParams: { temp: 0.1, predict: 800 },
    stream: true,
  })

  let text = ''
  for await (const token of run.tokenStream) text += token

  let rationale: string
  try {
    const parsed = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? text)
    rationale = typeof parsed.rationale === 'string' ? parsed.rationale.trim() : ''
  } catch {
    console.warn('[qvac] model returned unparseable output; keeping rules findings only')
    return null
  }

  // A rephrasing that ran long stopped being a rephrasing. Discard it rather
  // than show an auditor a sentence the model started improvising into.
  if (!rationale || rationale.length > 400) {
    console.warn('[qvac] rationale empty or overlong; discarded')
    return null
  }

  return { rationale }
}

/**
 * Reject a rationale that contradicts the verdict it is supposed to restate.
 *
 * A small model asked to rephrase "non_compliant / foreign donor" produced
 * "...de un donante extranjero (US) no rechazada". Next to a red badge that
 * sentence is worse than no sentence at all, so a rationale that negates its
 * own verdict is dropped and the row falls back to the rule findings.
 */
function contradictsVerdict(rationale: string, status: ComplianceStatus): boolean {
  const text = rationale.toLowerCase()
  const negated = /\bnot (rejected|returned|flagged|illegal|a violation|in breach)\b/.test(text)
  const cleared = /\b(is|was) (legal|valid|compliant|acceptable|permitted)\b/.test(text)

  if (status === 'non_compliant') return negated || cleared
  if (status === 'verified') return /\b(rejected|illegal|non-compliant|violat)/.test(text)
  return false
}

export async function assess(ctx: RuleContext): Promise<ComplianceVerdict> {
  const findings = evaluateRules(ctx)
  const modelId = await getModelId()

  const verdict = (engine: 'qvac' | 'rules', rationale: string) => {
    const status = statusFrom(findings)
    return {
      donationId: ctx.donation.id,
      status,
      findings,
      engine,
      rationale,
      evaluatedAt: ctx.now,
      cureDeadline:
        status === 'pending' ? ctx.donation.receivedAt + config.compliance.cureWindowMs : null,
    } satisfies ComplianceVerdict
  }

  if (!modelId) return verdict('rules', '')

  try {
    const status = statusFrom(findings)
    const out = await runModel(modelId, buildPrompt(ctx.donation, ctx.attestation, status, findings))
    if (!out) return verdict('rules', '')

    if (contradictsVerdict(out.rationale, status)) {
      console.warn(`[qvac] rationale contradicted the '${status}' verdict; discarded`)
      return verdict('rules', '')
    }

    return verdict('qvac', out.rationale)
  } catch (err) {
    console.warn(`[qvac] inference failed: ${(err as Error).message}`)
    return verdict('rules', '')
  }
}
