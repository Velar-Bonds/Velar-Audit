import { config } from '../config.ts'
import { evaluateRules, statusFrom } from './rules.ts'
import type { RuleContext } from './rules.ts'
import type { Attestation, ComplianceFinding, ComplianceVerdict, Donation } from '../types.ts'

/**
 * QVAC compliance agent — runs a language model ON THIS MACHINE.
 *
 * The whole reason this is local: the agent reasons over KYC and source-of-funds
 * data. Shipping that to a cloud API would hand a third party the donor list of
 * every political party in the country. Nothing leaves the device.
 *
 * The model does NOT get the final word. `rules.ts` decides status, because a
 * regulator must be able to reproduce a verdict that carries a legal
 * consequence. The model contributes the rationale a human auditor reads, and
 * may raise concerns the rules did not encode — those escalate to review, never
 * clear a violation.
 */

interface AgentOutput {
  rationale: string
  additional_concerns: string[]
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
          description: 'Dos frases en español dirigidas al auditor del TSE.',
        },
        additional_concerns: {
          type: 'array',
          items: { type: 'string' },
          description: 'Preocupaciones no cubiertas por el motor de reglas.',
        },
      },
      required: ['rationale', 'additional_concerns'],
      additionalProperties: false,
    },
  },
} as const

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
      sdk = await import('@qvac/sdk')

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
  findings: ComplianceFinding[],
): string {
  return `Eres un auditor de financiamiento político en Costa Rica. Analiza esta donación.

DONACIÓN
  monto: ${donation.amountDecimal} ${donation.asset}
  recibida: ${new Date(donation.receivedAt).toISOString()}
  tx: ${donation.txHash}

ATESTACIÓN
${
  attestation
    ? `  país del donante: ${attestation.donorCountry}
  KYC verificado: ${attestation.kycVerified ? 'sí' : 'no'}
  origen de fondos: ${attestation.sourceOfFunds}
  persona expuesta políticamente: ${attestation.isPep ? 'sí' : 'no'}`
    : '  ninguna — el donante no ha presentado atestación'
}

HALLAZGOS DEL MOTOR DE REGLAS
${findings.map((f) => `  [${f.severity}] ${f.code}: ${f.message}`).join('\n')}

Explica el resultado para el auditor y señala cualquier preocupación que las reglas no cubran.`
}

async function runModel(modelId: string, prompt: string): Promise<AgentOutput | null> {
  const run = sdk.completion({
    modelId,
    history: [{ role: 'user', content: prompt }],
    responseFormat: RESPONSE_SCHEMA,
    generationParams: { temp: 0.1, predict: 400 },
    stream: true,
  })

  let text = ''
  for await (const token of run.tokenStream) text += token

  try {
    const parsed = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? text)
    return {
      rationale: typeof parsed.rationale === 'string' ? parsed.rationale : '',
      additional_concerns: Array.isArray(parsed.additional_concerns)
        ? parsed.additional_concerns.filter((c: unknown) => typeof c === 'string')
        : [],
    }
  } catch {
    console.warn('[qvac] model returned unparseable output; keeping rules findings only')
    return null
  }
}

export async function assess(ctx: RuleContext): Promise<ComplianceVerdict> {
  const findings = evaluateRules(ctx)
  const modelId = await getModelId()

  const verdict = (engine: 'qvac' | 'rules', all: ComplianceFinding[], rationale: string) => {
    const status = statusFrom(all)
    return {
      donationId: ctx.donation.id,
      status,
      findings: all,
      engine,
      rationale,
      evaluatedAt: ctx.now,
      cureDeadline:
        status === 'pending' ? ctx.donation.receivedAt + config.compliance.cureWindowMs : null,
    } satisfies ComplianceVerdict
  }

  if (!modelId) return verdict('rules', findings, '')

  try {
    const out = await runModel(modelId, buildPrompt(ctx.donation, ctx.attestation, findings))
    if (!out) return verdict('rules', findings, '')

    const enriched = [
      ...findings,
      ...out.additional_concerns.map((message) => ({
        code: 'agent_concern',
        message,
        severity: 'warning' as const,
      })),
    ]
    return verdict('qvac', enriched, out.rationale)
  } catch (err) {
    console.warn(`[qvac] inference failed: ${(err as Error).message}`)
    return verdict('rules', findings, '')
  }
}
