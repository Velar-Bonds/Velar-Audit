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
   * Demo mode swaps the chain for a simulator and the local model for the rules
   * engine. The pipeline, the data model, and the dashboard are identical either
   * way — which is the point: the demo never dies because an RPC went down.
   */
  demoMode: str('DEMO_MODE', '1') === '1',

  wdk: {
    seedPhrase: str('WDK_SEED_PHRASE'),
    chain: str('WDK_CHAIN', 'ethereum') as 'ethereum' | 'bitcoin',
    network: str('WDK_NETWORK', 'sepolia'),
    rpcUrl: str('WDK_RPC_URL', 'https://ethereum-sepolia-rpc.publicnode.com'),
    token: {
      symbol: str('WDK_TOKEN_SYMBOL', 'USDT'),
      address: str('WDK_TOKEN_ADDRESS'),
      decimals: num('WDK_TOKEN_DECIMALS', 6),
    },
  },

  indexer: {
    pollMs: num('INDEXER_POLL_MS', 15_000),
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
