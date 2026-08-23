/**
 * Print exactly what the model returns, before any of our parsing touches it.
 *
 * The agent reports "empty or overlong" for every run, which is the guard
 * firing but says nothing about why. This is the only way to find out.
 */
import 'dotenv/config'
import { config } from '../config.js'

const QVAC_MODULE = '@qvac/sdk'
const sdk: any = await import(QVAC_MODULE)

const modelId = await sdk.loadModel({ modelSrc: sdk[config.qvac.model] })
console.log(`model ready: ${modelId}\n`)

const t0 = Date.now()
const run = sdk.completion({
  modelId,
  history: [
    { role: 'system', content: 'Restate the decision in one sentence. Reply only with JSON: {"rationale": "..."}' },
    { role: 'user', content: 'DONATION: 500 USDT from a donor in CR\nDECIDED RESULT: verified\nFINDINGS:\n- Valid attestation, domestic donor, within the annual cap.' },
  ],
  generationParams: { temp: 0.1, predict: 800 },
  stream: true,
})

let text = ''
for await (const token of run.tokenStream) text += token

console.log('─── RAW ───')
console.log(JSON.stringify(text))
console.log('───────────')
console.log(`length: ${text.length} chars · ${Date.now() - t0} ms`)

const m = text.match(/\{[\s\S]*\}/)
console.log(`\nregex match: ${m ? JSON.stringify(m[0]).slice(0, 300) : 'NONE'}`)
if (m) {
  try {
    const p = JSON.parse(m[0])
    console.log(`parsed.rationale length: ${(p.rationale ?? '').length}`)
    console.log(`parsed.rationale: ${JSON.stringify(p.rationale)}`)
  } catch (e) {
    console.log(`parse failed: ${(e as Error).message}`)
  }
}
process.exit(0)
