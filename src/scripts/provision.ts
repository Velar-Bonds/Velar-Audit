/**
 * Bring every wallet in the demonstration to a usable state, in one pass.
 *
 * Gas for the party wallets so they can anchor evidence, and minted USD₮ for
 * whoever is going to donate. Everything is paid by the donor wallet, so that
 * is the only address a human has to fund from a faucet.
 *
 *   npm run provision              # mint to the donor wallet itself
 *   npm run provision -- 0xabc…    # mint to a phone wallet, and top up its gas
 */
import 'dotenv/config'
import { ethers } from 'ethers'
import WDK from '@tetherto/wdk'
import WalletManagerEvm from '@tetherto/wdk-wallet-evm'
import { config } from '../config.js'
import { store } from '../store.js'
import { seedIdentity } from '../seed.js'
import { getPartyWallet } from '../wallet/wdk.js'

/** Aave's Sepolia faucet: the token's owner, and open to anyone. */
const FAUCET = '0xC959483DBa39aa9E78757139af0e9a2EDEb3f42D'
const FAUCET_ABI = ['function mint(address token, address to, uint256 amount) returns (uint256)']

const MINT_AMOUNT = 10_000
const GAS_PER_PARTY = 8_000_000_000_000_000n   // 0.008 ETH — hundreds of anchors
const GAS_FOR_RECIPIENT = 5_000_000_000_000_000n // 0.005 ETH

const seed = process.env.DONOR_SEED_PHRASE?.trim()
if (!seed) {
  console.error('DONOR_SEED_PHRASE is not set. Run `npm run donor:new` first.')
  process.exit(1)
}

const wdk = new WDK(seed)
  .registerWallet('ethereum', WalletManagerEvm, { provider: config.wdk.rpcUrl })

const donor = await wdk.getAccount('ethereum', 0)
const donorAddress: string = await donor.getAddress()
const recipient = process.argv[2] ?? donorAddress

const available: bigint = await donor.getBalance()
console.log(`\n  Donor wallet ${donorAddress}`)
console.log(`  Holding      ${ethers.formatEther(available)} ETH\n`)

const needed = GAS_PER_PARTY * 2n + (recipient === donorAddress ? 0n : GAS_FOR_RECIPIENT)
if (available < needed + 3_000_000_000_000_000n) {
  console.error(
    `  Not enough gas. Send at least ${ethers.formatEther(needed + 3_000_000_000_000_000n)} ETH to\n` +
    `  ${donorAddress}\n\n` +
    `  Faucet: https://cloud.google.com/application/web3/faucet/ethereum/sepolia\n`)
  process.exit(1)
}

await seedIdentity()

// Party wallets need gas of their own: evidence is anchored by each party's own
// wallet, so a party with an empty balance cannot record anything.
for (const party of store.parties()) {
  const wallet = await getPartyWallet(party.walletIndex)
  const balance: bigint = await wallet.balances().then((b) => BigInt(b.native))

  if (balance >= GAS_PER_PARTY / 2n) {
    console.log(`  ${party.name.padEnd(12)} already funded`)
    continue
  }

  const tx = await donor.sendTransaction({ to: wallet.address, value: GAS_PER_PARTY })
  console.log(`  ${party.name.padEnd(12)} gas sent    ${tx.hash}`)
}

if (recipient !== donorAddress) {
  const provider = new ethers.JsonRpcProvider(config.wdk.rpcUrl)
  const balance = await provider.getBalance(recipient)
  if (balance < GAS_FOR_RECIPIENT / 2n) {
    const tx = await donor.sendTransaction({ to: recipient, value: GAS_FOR_RECIPIENT })
    console.log(`  recipient    gas sent    ${tx.hash}`)
  } else {
    console.log('  recipient    already has gas')
  }
}

const units = BigInt(MINT_AMOUNT) * 10n ** BigInt(config.wdk.token.decimals)
const data = new ethers.Interface(FAUCET_ABI)
  .encodeFunctionData('mint', [config.wdk.token.address, recipient, units])

const mint = await donor.sendTransaction({ to: FAUCET, value: 0n, data })
console.log(`\n  ${MINT_AMOUNT} ${config.wdk.token.symbol} → ${recipient}`)
console.log(`  ${config.wdk.explorerUrl}/tx/${mint.hash}\n`)
console.log('  Re-run for another 10,000. Nothing rate-limits it but gas.\n')

wdk.dispose()
process.exit(0)
