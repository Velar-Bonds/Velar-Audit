/**
 * Seed the chain with real donations.
 *
 * Every record this system shows comes from a transaction that actually
 * happened, so the demonstration history has to be sent rather than inserted.
 * This script picks donor accounts whose derived identities produce the
 * compliance outcomes worth showing, funds them, and sends the transfers.
 *
 *   npm run seed:chain
 */
import 'dotenv/config'
import WDK from '@tetherto/wdk'
import WalletManagerEvm from '@tetherto/wdk-wallet-evm'
import { config } from '../config.js'
import { identityFor } from '../attestation/stub-provider.js'
import { store } from '../store.js'
import { seedIdentity } from '../seed.js'
import { getPartyWallet } from '../wallet/wdk.js'

const DONOR_SEED = process.env.DONOR_SEED_PHRASE?.trim()
const DECIMALS = config.wdk.token.decimals
const units = (amount: number) => BigInt(Math.round(amount * 10 ** DECIMALS))

/** Gas handed to each secondary donor, enough for a few ERC-20 transfers. */
const GAS_PER_DONOR = 2_000_000_000_000_000n // 0.002 ETH

if (!DONOR_SEED) {
  console.error('DONOR_SEED_PHRASE is not set. Run `npm run donor:new` first.')
  process.exit(1)
}

const wdk = new WDK(DONOR_SEED)
  .registerWallet('ethereum', WalletManagerEvm, { provider: config.wdk.rpcUrl })

/** Look ahead over derived accounts and label what the provider will say. */
async function surveyDonors(count: number) {
  const donors = []
  for (let index = 0; index < count; index++) {
    const account = await wdk.getAccount('ethereum', index)
    const address: string = await account.getAddress()
    donors.push({ index, address, account, identity: identityFor(address) })
  }
  return donors
}

async function waitForConfirmation(hash: string, timeoutMs = 60_000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(config.wdk.rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionReceipt', params: [hash] }),
    })
    const body = (await res.json()) as { result?: { status: string } | null }
    if (body.result) return
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
  throw new Error(`transaction ${hash} did not confirm within ${timeoutMs}ms`)
}

async function main() {
  await seedIdentity()
  const parties = store.parties()
  if (parties.length < 2) throw new Error('expected at least two parties to donate to')

  const partyAddresses = await Promise.all(
    parties.map(async (p) => ({ party: p, address: (await getPartyWallet(p.walletIndex)).address })),
  )

  console.log('\nSurveying donor accounts…')
  const donors = await surveyDonors(24)

  // Pick donors whose derived identities produce each outcome worth showing.
  const clean = donors.filter((d) =>
    d.identity.donorCountry === 'CR' && d.identity.kycVerified &&
    d.identity.sourceOfFunds !== 'undisclosed')
  const foreign = donors.find((d) => d.identity.donorCountry !== 'CR')
  const flagged = donors.find((d) => !d.identity.kycVerified || d.identity.sourceOfFunds === 'undisclosed')

  if (clean.length < 3 || !foreign) {
    throw new Error('the derived donor set does not cover the scenario; widen the survey')
  }

  const funder = donors[0]!
  console.log(`\nFunder      ${funder.address}`)
  console.log(`Foreign     ${foreign.address}  (${foreign.identity.donorCountry})`)
  if (flagged) console.log(`Flagged     ${flagged.address}`)

  const nativeBalance: bigint = await funder.account.getBalance()
  const tokenBalance: bigint = await funder.account.getTokenBalance(config.wdk.token.address)

  console.log(`\nFunder holds ${Number(nativeBalance) / 1e18} ETH and ` +
    `${Number(tokenBalance) / 10 ** DECIMALS} ${config.wdk.token.symbol}`)

  if (tokenBalance < units(3000) || nativeBalance < 10n * GAS_PER_DONOR) {
    console.error(
      `\nNot enough funds. Send Sepolia ETH and ${config.wdk.token.symbol} to:\n  ${funder.address}\n` +
      `  ETH   faucet: https://www.alchemy.com/faucets/ethereum-sepolia\n` +
      `  USDT  faucet: https://app.aave.com/faucet/  (Ethereum Sepolia, USDT)\n`)
    process.exit(1)
  }

  /**
   * The scenario. Amounts are scaled to what the Aave faucet dispenses, and the
   * cap in .env is set below the over-cap donor's running total so the rule
   * actually fires rather than being described in a slide.
   */
  const plan: Array<{ donor: typeof funder; to: string; amount: number; label: string }> = [
    { donor: clean[0]!, to: partyAddresses[0]!.address, amount: 420, label: 'clean domestic' },
    { donor: clean[0]!, to: partyAddresses[0]!.address, amount: 310, label: 'clean domestic' },
    { donor: clean[1]!, to: partyAddresses[0]!.address, amount: 680, label: 'clean domestic' },
    { donor: clean[1]!, to: partyAddresses[1]!.address, amount: 240, label: 'clean domestic' },
    { donor: clean[2]!, to: partyAddresses[1]!.address, amount: 1_450, label: 'over cap, part 1' },
    { donor: clean[2]!, to: partyAddresses[1]!.address, amount: 1_300, label: 'over cap, part 2' },
    { donor: foreign, to: partyAddresses[0]!.address, amount: 900, label: 'foreign donor' },
    { donor: foreign, to: partyAddresses[1]!.address, amount: 550, label: 'foreign donor' },
  ]
  if (flagged) {
    plan.push({ donor: flagged, to: partyAddresses[0]!.address, amount: 380, label: 'identity or source problem' })
  }

  // Fund the donors that are not the funder, so their transfers can pay gas.
  const others = [...new Set(plan.map((p) => p.donor).filter((d) => d.index !== funder.index))]
  console.log(`\nFunding ${others.length} donor accounts…`)

  for (const donor of others) {
    const balance: bigint = await donor.account.getBalance()
    if (balance < GAS_PER_DONOR / 2n) {
      const gas = await funder.account.sendTransaction({ to: donor.address, value: GAS_PER_DONOR })
      await waitForConfirmation(gas.hash)
      console.log(`  gas  → ${donor.address}  ${gas.hash}`)
    }

    const needed = units(plan.filter((p) => p.donor === donor).reduce((sum, p) => sum + p.amount, 0))
    const held: bigint = await donor.account.getTokenBalance(config.wdk.token.address)
    if (held < needed) {
      const top = await funder.account.transfer({
        token: config.wdk.token.address, recipient: donor.address, amount: needed - held,
      })
      await waitForConfirmation(top.hash)
      console.log(`  ${config.wdk.token.symbol} → ${donor.address}  ${top.hash}`)
    }
  }

  /*
   * Group by donor so each account's transfers run in its own nonce sequence.
   * Sent one after another from a single account they would serialise on nonce
   * and take a block interval each; grouped this way they confirm in parallel.
   */
  console.log('\nSending donations…')
  const byDonor = new Map<number, typeof plan>()
  for (const item of plan) {
    const list = byDonor.get(item.donor.index) ?? []
    list.push(item)
    byDonor.set(item.donor.index, list)
  }

  const results = await Promise.all([...byDonor.values()].map(async (items) => {
    const sent: string[] = []
    for (const item of items) {
      const tx = await item.donor.account.transfer({
        token: config.wdk.token.address,
        recipient: item.to,
        amount: units(item.amount),
      })
      console.log(`  ${String(item.amount).padStart(5)} ${config.wdk.token.symbol}  ${item.label.padEnd(26)} ${tx.hash}`)
      sent.push(tx.hash)
    }
    return sent
  }))

  const total = plan.reduce((sum, p) => sum + p.amount, 0)
  console.log(`\n${results.flat().length} donations sent, ${total} ${config.wdk.token.symbol} in total.`)
  console.log(`Check them at ${config.wdk.explorerUrl}/address/${partyAddresses[0]!.address}`)
  console.log('\nStart the server and the indexer will pick them up.\n')

  wdk.dispose()
}

main().catch((err) => {
  console.error(`\nSeeding failed: ${err.message}\n`)
  process.exit(1)
})
