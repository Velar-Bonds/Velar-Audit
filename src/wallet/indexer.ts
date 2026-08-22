import { config } from '../config.ts'
import { store } from '../store.ts'
import { newId } from '../attestation/hash.ts'
import { getPartyWallet, registerDonorAddress } from './wdk.ts'
import type { AssetSymbol, Donation } from '../types.ts'

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

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(config.wdk.rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const body = (await res.json()) as { result?: T; error?: { message: string } }
  if (body.error) throw new Error(`${method}: ${body.error.message}`)
  return body.result as T
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

async function scanOnce(partyAddress: string, onDonation: DonationHandler): Promise<void> {
  const headHex = await rpc<string>('eth_blockNumber', [])
  const head = Number(BigInt(headHex))

  // First run: start a little behind the tip rather than replaying all history.
  const from = store.cursor() || Math.max(head - 5_000, 0)
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
      receivedAt: Date.now(),
      partyId: 'party-demo',
    }

    const { donation: saved, isNew } = store.addDonation(donation)
    if (!isNew) continue

    registerDonorAddress(fromAddress)
    console.log(
      `[indexer] donation ${saved.amountDecimal} ${saved.asset} from ${fromAddress} (${saved.txHash})`,
    )
    await onDonation(saved)
  }

  store.setCursor(head + 1)
}

export async function startIndexer(onDonation: DonationHandler): Promise<void> {
  if (config.demoMode) {
    console.log('[indexer] demo mode — chain polling disabled, use POST /api/simulate/donation')
    return
  }

  const wallet = await getPartyWallet()

  const tick = async () => {
    try {
      await scanOnce(wallet.address, onDonation)
    } catch (err) {
      // A flaky RPC must never take the indexer down mid-demo.
      console.warn(`[indexer] scan failed: ${(err as Error).message}`)
    }
  }

  await tick()
  timer = setInterval(tick, config.indexer.pollMs)
  console.log(`[indexer] watching ${wallet.address} every ${config.indexer.pollMs}ms`)
}

export function stopIndexer(): void {
  if (timer) clearInterval(timer)
  timer = null
}

/**
 * Inject a donation without a chain. Used by demo mode and by `npm run
 * donate:sim` so the pipeline can be rehearsed with no testnet dependency.
 */
export async function injectDonation(
  input: Partial<Donation> & Pick<Donation, 'amountDecimal' | 'fromAddress'>,
  onDonation: DonationHandler,
): Promise<Donation> {
  const wallet = await getPartyWallet()
  const asset = input.asset ?? (config.wdk.token.symbol as AssetSymbol)
  const decimals = config.wdk.token.decimals

  const donation: Donation = {
    id: newId('don'),
    txHash:
      input.txHash ??
      '0x' + Array.from({ length: 64 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join(''),
    chain: input.chain ?? config.wdk.chain,
    asset,
    amountRaw: BigInt(Math.round(input.amountDecimal * 10 ** decimals)).toString(),
    amountDecimal: input.amountDecimal,
    fromAddress: input.fromAddress,
    toAddress: wallet.address,
    blockNumber: input.blockNumber ?? null,
    receivedAt: input.receivedAt ?? Date.now(),
    partyId: input.partyId ?? 'party-demo',
  }

  const { donation: saved, isNew } = store.addDonation(donation)
  if (isNew) {
    registerDonorAddress(saved.fromAddress)
    await onDonation(saved)
  }
  return saved
}
