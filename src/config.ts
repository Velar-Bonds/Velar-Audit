import 'dotenv/config'

function num(key: string, fallback: number): number {
  const raw = process.env[key]
  if (!raw) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : fallback
}

function str(key: string, fallback = ''): string {
  return process.env[key]?.trim() || fallback
}

export const config = {
  port: num('PORT', 3400),

  /**
   * One chain, always real. There is no simulated mode: the product's claim is
   * that evidence is verifiable on a public ledger, and a code path that fakes
   * that claim is a code path that can be demonstrated by accident.
   */
  wdk: {
    seedPhrase: str('WDK_SEED_PHRASE'),
    chain: 'ethereum' as const,
    network: str('WDK_NETWORK', 'sepolia'),
    chainId: num('WDK_CHAIN_ID', 11155111),
    rpcUrl: str('WDK_RPC_URL', 'https://ethereum-sepolia-rpc.publicnode.com'),
    /** Public RPCs rate-limit. A second endpoint is cheap insurance mid-demo. */
    rpcFallbackUrl: str('WDK_RPC_FALLBACK_URL', 'https://rpc.sepolia.org'),
    explorerUrl: str('WDK_EXPLORER_URL', 'https://sepolia.etherscan.io'),
    token: {
      symbol: str('WDK_TOKEN_SYMBOL', 'USDT'),
      address: str('WDK_TOKEN_ADDRESS'),
      decimals: num('WDK_TOKEN_DECIMALS', 6),
    },
  },

  indexer: {
    pollMs: num('INDEXER_POLL_MS', 15_000),
    /** Where a cold start begins replaying from. 0 means "just behind the tip". */
    startBlock: num('INDEXER_START_BLOCK', 0),
  },

  evidence: {
    batchSize: num('EVIDENCE_BATCH_SIZE', 12),
    batchMaxAgeMs: num('EVIDENCE_BATCH_MAX_AGE_SECONDS', 20) * 1000,
  },

  sync: {
    /** Serverless has no background process; requests drive the indexer instead. */
    minIntervalMs: num('SYNC_MIN_INTERVAL_SECONDS', 10) * 1000,
  },

  qvac: {
    model: str('QVAC_MODEL', 'QWEN3_4B_INST_Q4_K_M'),
  },

  compliance: {
    country: str('COMPLIANCE_COUNTRY', 'CR'),
    donorCapUsd: num('COMPLIANCE_DONOR_CAP_USD', 25_000),
    cureWindowMs: num('COMPLIANCE_CURE_WINDOW_HOURS', 72) * 60 * 60 * 1000,
  },
} as const
