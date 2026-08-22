import { config } from '../config.js'
import { newId } from '../attestation/hash.js'
import { getPartyWallet, registerDonorAddress } from './wdk.js'
import { store } from '../store.js'
import type { AssetSymbol, Donation } from '../types.js'

/**
 * Watches the party's donation wallet for incoming transfers.
 *
 * The WDK EVM module exposes balances and transfers but no history API, so we
 * read ERC-20 Transfer logs straight from the RPC. Every donation the chain
 * shows us becomes a record here — there is no path by which a donation arrives
 * and goes unrecorded, which is the whole point of indexing rather than
 * trusting the party to self-report.
 */

/** keccak256("Transfer(address,address,uint256)") */
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

type DonationHandler = (donation: Donation) => unknown | Promise<unknown>

let timer: NodeJS.Timeout | null = null

/**
 * JSON-RPC with a fallback endpoint.
 *
 * Public RPCs rate-limit, and losing the indexer mid-demonstration because one
 * provider throttled is an avoidable way to fail.
 */
async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const endpoints = [config.wdk.rpcUrl, config.wdk.rpcFallbackUrl].filter(Boolean)
  let lastError: Error | null = null

  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      })
      const body = (await res.json()) as { result?: T; error?: { message: string } }
      if (body.error) throw new Error(body.error.message)
      return body.result as T
    } catch (err) {
      lastError = err as Error
    }
  }

  throw new Error(`${method}: ${lastError?.message ?? 'no RPC endpoint answered'}`)
}

/**
 * Block timestamps, cached.
 *
 * A donation's time is when the chain accepted it, not when we happened to
 * index it. Using ingestion time would mean every replay shifted the whole
 * history forward, which would break both the cure window and the claim that
 * state can be rebuilt from the chain.
 */
const blockTimes = new Map<number, number>()

async function blockTime(blockNumber: number): Promise<number> {
  const cached = blockTimes.get(blockNumber)
  if (cached !== undefined) return cached

  const block = await rpc<{ timestamp: string } | null>(
    'eth_getBlockByNumber', [`0x${blockNumber.toString(16)}`, false],
  )
  const seconds = block ? Number(BigInt(block.timestamp)) : Math.floor(Date.now() / 1000)
  const ms = seconds * 1000

  blockTimes.set(blockNumber, ms)
  return ms
}

/** Left-pad an address to a 32-byte log topic. */
function addressTopic(address: string): string {
  return `0x${address.replace(/^0x/, '').toLowerCase().padStart(64, '0')}`
}

function topicToAddress(topic: string): string {
  return `0x${topic.slice(-40)}`
}

function toDecimal(raw: bigint, decimals: number): number {
  return Number(raw) / 10 ** decimals
}

async function scanOnce(
  partyAddress: string,
  partyId: string,
  walletIndex: number,
  onDonation: DonationHandler,
): Promise<void> {
  const headHex = await rpc<string>('eth_blockNumber', [])
  const head = Number(BigInt(headHex))

  // A cold start replays from the configured block so state rebuilds from the
  // chain. Left at 0, it starts just behind the tip instead of replaying years.
  const from = store.cursor() || config.indexer.startBlock || Math.max(head - 5_000, 0)
  if (from > head) return

  const logs = await rpc<Array<{
    transactionHash: string
    blockNumber: string
    topics: string[]
    data: string
  }>>('eth_getLogs', [
    {
      fromBlock: `0x${from.toString(16)}`,
      toBlock: `0x${head.toString(16)}`,
      address: config.wdk.token.address,
      topics: [TRANSFER_TOPIC, null, addressTopic(partyAddress)],
    },
  ])

  for (const log of logs) {
    const fromAddress = topicToAddress(log.topics[1] ?? '')
    const amountRaw = BigInt(log.data || '0x0')
    const blockNumber = Number(BigInt(log.blockNumber))

    const donation: Donation = {
      id: newId('don'),
      txHash: log.transactionHash,
      chain: config.wdk.chain,
      asset: config.wdk.token.symbol as AssetSymbol,
      amountRaw: amountRaw.toString(),
      amountDecimal: toDecimal(amountRaw, config.wdk.token.decimals),
      fromAddress,
      toAddress: partyAddress,
      blockNumber,
      receivedAt: await blockTime(blockNumber),
      partyId,
    }

    const { donation: saved, isNew } = store.addDonation(donation)
    if (!isNew) continue

    registerDonorAddress(walletIndex, fromAddress)
    console.log(
      `[indexer] donation ${saved.amountDecimal} ${saved.asset} from ${fromAddress} (${saved.txHash})`,
    )
    await onDonation(saved)
  }

  store.setCursor(head + 1)
}

/** One pass over every party wallet. Shared by the timer and by request-driven sync. */
export async function scanAllParties(onDonation: DonationHandler): Promise<void> {
  for (const party of store.parties()) {
    try {
      const wallet = await getPartyWallet(party.walletIndex)
      await scanOnce(wallet.address, party.id, party.walletIndex, onDonation)
    } catch (err) {
      // A flaky RPC must never take the indexer down, and one party's failure
      // must not stop the others from being watched.
      console.warn(`[indexer] scan failed for ${party.code}: ${(err as Error).message}`)
    }
  }
}

export async function startIndexer(onDonation: DonationHandler): Promise<void> {
  const tick = () => scanAllParties(onDonation)

  await tick()
  timer = setInterval(tick, config.indexer.pollMs)
  console.log(`[indexer] watching ${store.parties().length} party wallets every ${config.indexer.pollMs}ms`)
}

export function stopIndexer(): void {
  if (timer) clearInterval(timer)
  timer = null
}
