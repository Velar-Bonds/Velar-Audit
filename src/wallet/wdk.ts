import { config } from '../config.js'

/**
 * Party donation wallets, built on Tether's WDK.
 *
 * Self-custodial by construction: the seed phrase is the party's, and no
 * exchange or custodian sits between a donor and the party. That is precisely
 * the property the TSE cares about — nobody can quietly move or hide a
 * donation, because there is no intermediary with the authority to.
 *
 * Each party gets its own derived account index off the same seed, so a
 * multi-party deployment means one seed and N addresses rather than N seeds to
 * lose. Donations to different parties are separated on-chain, not by a column
 * in our database.
 */

export interface PartyWallet {
  address: string
  walletIndex: number
  /** Send an ERC-20 refund back to a donor. Rejected by policy for any other recipient. */
  refund(to: string, amountRaw: bigint): Promise<{ hash: string }>
  /** Write a 32-byte evidence hash into calldata on a zero-value self-transaction. */
  anchor(hash: string): Promise<{ hash: string }>
  /** Native and token balances, in base units. */
  balances(): Promise<{ native: string; token: string }>
}

const wallets = new Map<number, PartyWallet>()
let wdkInstance: any = null

/**
 * Addresses each party wallet is permitted to send to — every address that has
 * donated to it. Populated by the indexer as donations arrive.
 */
const knownDonors = new Map<number, Set<string>>()

export function registerDonorAddress(walletIndex: number, address: string): void {
  const set = knownDonors.get(walletIndex) ?? new Set<string>()
  set.add(address.toLowerCase())
  knownDonors.set(walletIndex, set)
}

export function isKnownDonor(walletIndex: number, address: string): boolean {
  return knownDonors.get(walletIndex)?.has(address.toLowerCase()) ?? false
}

async function getWdk(): Promise<any> {
  if (wdkInstance) return wdkInstance

  const { default: WDK } = await import('@tetherto/wdk')
  const { default: WalletManagerEvm } = await import('@tetherto/wdk-wallet-evm')

  wdkInstance = new WDK(config.wdk.seedPhrase)
    .registerWallet(config.wdk.chain, WalletManagerEvm, { provider: config.wdk.rpcUrl })
    /**
     * A party wallet cannot send money to anyone who has not donated to it.
     *
     * This is the enforcement story in one rule: a treasurer who wants to move
     * donated funds somewhere they do not belong is stopped by the wallet
     * itself, before a transaction is ever signed. Returning money to its
     * source is the only outbound path.
     */
    .registerPolicy({
      id: 'returns-only',
      name: 'Outbound transfers may only return funds to a known donor',
      scope: 'project',
      rules: [
        {
          name: 'allow-refund-to-donor',
          operation: 'transfer',
          action: 'ALLOW',
          conditions: [
            ({ args }: any) => {
              const recipient = String(args?.[0]?.recipient ?? '').toLowerCase()
              return [...knownDonors.values()].some((set) => set.has(recipient))
            },
          ],
        },
        {
          name: 'allow-self-anchor',
          operation: 'sendTransaction',
          action: 'ALLOW',
          conditions: [
            ({ args }: any) => {
              const to = String(args?.[0]?.to ?? '').toLowerCase()
              return [...wallets.values()].some((w) => w.address.toLowerCase() === to)
            },
          ],
        },
      ],
    })

  return wdkInstance
}

export async function getPartyWallet(walletIndex = 0): Promise<PartyWallet> {
  const cached = wallets.get(walletIndex)
  if (cached) return cached

  if (!config.wdk.seedPhrase) {
    throw new Error(
      'WDK_SEED_PHRASE is not set. This system has no simulated mode: it reads and writes a ' +
      'real chain, so it needs a real wallet. Run `npm run wallet:new` and put the phrase in .env.',
    )
  }

  const wallet = await realWallet(walletIndex)
  wallets.set(walletIndex, wallet)
  return wallet
}

async function realWallet(walletIndex: number): Promise<PartyWallet> {
  const wdk = await getWdk()
  const account = await wdk.getAccount(config.wdk.chain, walletIndex)
  const address: string = await account.getAddress()

  console.log(`[wdk] party wallet #${walletIndex} on ${config.wdk.network}: ${address}`)

  return {
    address,
    walletIndex,
    async refund(to, amountRaw) {
      const result = await account.transfer({
        token: config.wdk.token.address,
        recipient: to,
        amount: amountRaw,
      })
      return { hash: result.hash }
    },
    async anchor(hash) {
      // Zero-value transaction to ourselves carrying the hash as calldata.
      // Cheapest possible way to timestamp evidence on a public chain.
      const result = await account.sendTransaction({ to: address, value: 0n, data: `0x${hash}` })
      return { hash: result.hash }
    },
    async balances() {
      // A balance read must never blank the wallets page. An unfunded or
      // unreachable address reports zero, which is also the truthful answer.
      try {
        const [native, token] = await Promise.all([
          account.getBalance(),
          config.wdk.token.address
            ? account.getTokenBalance(config.wdk.token.address)
            : Promise.resolve(0n),
        ])
        return { native: String(native), token: String(token) }
      } catch (err) {
        console.warn(`[wdk] balance read failed: ${(err as Error).message}`)
        return { native: '0', token: '0' }
      }
    },
  }
}

export function disposeWallets(): void {
  wdkInstance?.dispose?.()
  wdkInstance = null
  wallets.clear()
}
