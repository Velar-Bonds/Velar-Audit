import { config } from '../config.ts'

/**
 * The party's donation wallet, built on Tether's WDK.
 *
 * Self-custodial by construction: the seed phrase is the party's, and no
 * exchange or custodian sits between a donor and the party. That is precisely
 * the property the TSE cares about — nobody can quietly move or hide a
 * donation, because there is no intermediary with the authority to.
 */

export interface PartyWallet {
  address: string
  /** Send an ERC-20 refund back to a donor. Rejected by policy for any other recipient. */
  refund(to: string, amountRaw: bigint): Promise<{ hash: string }>
  /** Write a 32-byte evidence hash into calldata on a zero-value self-transaction. */
  anchor(hash: string): Promise<{ hash: string }>
  dispose(): void
}

let cached: PartyWallet | null = null

/**
 * Addresses the wallet is permitted to send to — every address that has donated
 * to us. Populated by the indexer as donations arrive.
 */
const knownDonors = new Set<string>()

export function registerDonorAddress(address: string): void {
  knownDonors.add(address.toLowerCase())
}

export function isKnownDonor(address: string): boolean {
  return knownDonors.has(address.toLowerCase())
}

export async function getPartyWallet(): Promise<PartyWallet> {
  if (cached) return cached

  if (config.demoMode || !config.wdk.seedPhrase) {
    cached = simulatedWallet()
    return cached
  }

  const { default: WDK } = await import('@tetherto/wdk')
  const { default: WalletManagerEvm } = await import('@tetherto/wdk-wallet-evm')

  const wdk = new WDK(config.wdk.seedPhrase)
    .registerWallet(config.wdk.chain, WalletManagerEvm, {
      provider: config.wdk.rpcUrl,
    })
    /**
     * The wallet cannot send money to anyone who has not donated to it.
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
          conditions: [({ args }: any) => isKnownDonor(String(args?.[0]?.recipient ?? ''))],
        },
        {
          name: 'allow-self-anchor',
          operation: 'sendTransaction',
          action: 'ALLOW',
          conditions: [
            ({ args }: any) =>
              String(args?.[0]?.to ?? '').toLowerCase() === cached?.address.toLowerCase(),
          ],
        },
      ],
    })

  const account = await wdk.getAccount(config.wdk.chain, 0)
  const address: string = await account.getAddress()

  console.log(`[wdk] party donation wallet ready on ${config.wdk.network}: ${address}`)

  cached = {
    address,
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
      const result = await account.sendTransaction({
        to: address,
        value: 0n,
        data: `0x${hash}`,
      })
      return { hash: result.hash }
    },
    dispose: () => wdk.dispose(),
  }
  return cached
}

/** Demo-mode stand-in. Same interface, deterministic fake hashes. */
function simulatedWallet(): PartyWallet {
  const address = '0xPARTY000000000000000000000000000000DEMO'
  const fakeHash = () =>
    '0x' + Array.from({ length: 64 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('')
  return {
    address,
    async refund() {
      return { hash: fakeHash() }
    },
    async anchor() {
      return { hash: fakeHash() }
    },
    dispose() {},
  }
}
