/**
 * Push a donation into a running server. Handy for showing the dashboard
 * update live during the demo:
 *   npm run donate:sim -- 2500 0xdeadbeef…
 */
import { config } from '../config.js'

const amountDecimal = Number(process.argv[2] ?? 1000)
const fromAddress = process.argv[3] ?? `0x${'d0n0r'.padEnd(40, '0')}`

const res = await fetch(`http://localhost:${config.port}/api/simulate/donation`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ amountDecimal, fromAddress }),
})

console.log(JSON.stringify(await res.json(), null, 2))
