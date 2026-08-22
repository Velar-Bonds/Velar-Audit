/**
 * Download the QVAC model weights ahead of time.
 *
 * Run this the moment you sit down. Pulling a model over venue wifi during the
 * demo is how a working project looks broken.
 */
import { config } from '../config.js'

// Same reason as in qvac-agent.ts: the module is optional at build time.
const QVAC_MODULE = '@qvac/sdk'
const sdk: any = await import(QVAC_MODULE)
const modelSrc = sdk[config.qvac.model]

if (!modelSrc) {
  console.error(`Unknown model constant '${config.qvac.model}'.`)
  console.error('Pick one exported by @qvac/sdk, e.g. LLAMA_3_2_1B_INST_Q4_0.')
  process.exit(1)
}

console.log(`Pulling ${config.qvac.model}…`)
let last = -1
const modelId = await sdk.loadModel({
  modelSrc,
  onProgress: (p: any) => {
    const pct = Math.floor((p?.progress ?? 0) * 100)
    if (pct > last) {
      process.stdout.write(`\r  ${pct}%   `)
      last = pct
    }
  },
})

console.log(`\n  ready: ${modelId}`)
await sdk.unloadModel({ modelId })
