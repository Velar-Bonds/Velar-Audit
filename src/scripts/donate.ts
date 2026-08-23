/**
 * Send a donation from the donor wallet to a party, by hand.
 *
 * The product's position is that donations arrive from a donor's own wallet and
 * the system only observes them — so there is no "create donation" endpoint to
 * call, and there never should be. This is the same ordinary ERC-20 transfer a
 * phone wallet would make, issued from a terminal instead, for the times when
 * fighting a wallet UI is not the point of the exercise.
 *
 *   npm run donate -- alfa 1500
 *   npm run donate -- beta 800
 */
import 'dotenv/config'
import { ethers } from 'ethers'
import WDK from '@tetherto/wdk'
import WalletManagerEvm from '@tetherto/wdk-wallet-evm'
import { config } from '../config.js'
import { store } from '../store.js'
import { seedIdentity } from '../seed.js'
import { getPartyWallet } from '../wallet/wdk.js'

const seed = process.env.DONOR_SEED_PHRASE?.trim()
if (!seed) {
  console.error('DONOR_SEED_PHRASE is not set. Run `npm run donor:new` first.')
  process.exit(1)
}

const [rawParty, rawAmount] = process.argv.slice(2)
if (!rawParty || !rawAmount) {
  console.error('\n  usage: npm run donate -- <party> <amount>')
  console.error('  e.g.   npm run donate -- alfa 1500\n')
  process.exit(1)
}

const amount = Number(rawAmount)
if (!Number.isFinite(amount) || amount <= 0) {
  console.error(`  "${rawAmount}" is not a positive amount.`)
  process.exit(1)
}

await seedIdentity()

const wanted = rawParty.trim().toLowerCase()
const party = store
  .parties()
  .find((p) => p.code.toLowerCase() === wanted || p.id.toLowerCase() === wanted)

if (!party) {
  const known = store.parties().map((p) => p.code.toLowerCase()).join(', ')
  console.error(`\n  Unknown party "${rawParty}". Known: ${known}\n`)
  process.exit(1)
}

const wallet = await getPartyWallet(party.walletIndex)

const wdk = new WDK(seed)
  .registerWallet('ethereum', WalletManagerEvm, { provider: config.wdk.rpcUrl })
const donor = await wdk.getAccount('ethereum', 0)
const from: string = await donor.getAddress()

// Gas is checked before the transfer is built: a donation that fails to send is
// far less confusing than one that is signed and then silently never mined.
const gas: bigint = await donor.getBalance()
if (gas === 0n) {
  console.error(
    `\n  ${from} has no Sepolia ETH, so it cannot pay for the transfer.\n` +
    `  Faucet: https://cloud.google.com/application/web3/faucet/ethereum/sepolia\n`)
  process.exit(1)
}

const units = ethers.parseUnits(String(amount), config.wdk.token.decimals)
const data = new ethers.Interface(['function transfer(address,uint256) returns (bool)'])
  .encodeFunctionData('transfer', [wallet.address, units])

console.log(`\n  ${amount} ${config.wdk.token.symbol} → ${party.name}`)
console.log(`  from ${from}`)
console.log(`  to   ${wallet.address}\n`)

const result = await donor.sendTransaction({ to: config.wdk.token.address, value: 0n, data })

console.log(`  ${config.wdk.explorerUrl}/tx/${result.hash}\n`)
console.log('  The indexer picks it up within a poll cycle, or press "Sync now".\n')

wdk.dispose?.()
process.exit(0)
