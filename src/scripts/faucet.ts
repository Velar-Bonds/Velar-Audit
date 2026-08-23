/**
 * Mint test USD₮ straight from the token's faucet contract.
 *
 * The token on Sepolia is owned by Aave's faucet, whose `mint` is
 * permissionless — so there is no need to fight a web UI, connect a wallet to a
 * third-party site, or solve a CAPTCHA. This calls the contract directly.
 *
 *   npm run faucet:usdt                 # mint to donor account 0
 *   npm run faucet:usdt -- 0xabc…       # mint to any address
 *
 * Gas is paid by the donor wallet, so it needs Sepolia ETH first. That still
 * comes from an ordinary faucet: https://cloud.google.com/application/web3/faucet/ethereum/sepolia
 */
import 'dotenv/config'
import { ethers } from 'ethers'
import WDK from '@tetherto/wdk'
import WalletManagerEvm from '@tetherto/wdk-wallet-evm'
import { config } from '../config.js'

/** Aave's Sepolia faucet — the owner of the test token, and open to anyone. */
const FAUCET = '0xC959483DBa39aa9E78757139af0e9a2EDEb3f42D'
const FAUCET_ABI = ['function mint(address token, address to, uint256 amount) returns (uint256)']

const AMOUNT = 10_000
const seed = process.env.DONOR_SEED_PHRASE?.trim()

if (!seed) {
  console.error('DONOR_SEED_PHRASE is not set. Run `npm run donor:new` first.')
  process.exit(1)
}
if (!config.wdk.token.address) {
  console.error('WDK_TOKEN_ADDRESS is not set.')
  process.exit(1)
}

const wdk = new WDK(seed)
  .registerWallet('ethereum', WalletManagerEvm, { provider: config.wdk.rpcUrl })

const account = await wdk.getAccount('ethereum', 0)
const from: string = await account.getAddress()
const to = process.argv[2] ?? from

const units = BigInt(AMOUNT) * 10n ** BigInt(config.wdk.token.decimals)
const data = new ethers.Interface(FAUCET_ABI)
  .encodeFunctionData('mint', [config.wdk.token.address, to, units])

const gas: bigint = await account.getBalance()
if (gas === 0n) {
  console.error(
    `\n  ${from} has no Sepolia ETH, so it cannot pay for the mint.\n` +
    `  Get some first: https://cloud.google.com/application/web3/faucet/ethereum/sepolia\n`)
  process.exit(1)
}

console.log(`\n  Minting ${AMOUNT} ${config.wdk.token.symbol}`)
console.log(`  to   ${to}`)
console.log(`  from ${from}\n`)

const result = await account.sendTransaction({ to: FAUCET, value: 0n, data })

console.log(`  ${config.wdk.explorerUrl}/tx/${result.hash}\n`)
console.log('  Run it again for another 10,000. Nothing rate-limits it but gas.\n')

wdk.dispose()
process.exit(0)
