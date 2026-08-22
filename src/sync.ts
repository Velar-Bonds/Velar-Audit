import { config } from './config.js'
import { scanAllParties } from './wallet/indexer.js'
import { sealDueBatches, sealAll } from './evidence/anchor.js'
import { onDonation, sweepOverdue } from './pipeline.js'

/**
 * Request-driven synchronisation.
 *
 * A serverless function has no process to hold a polling interval in, so
 * requests drive the indexer instead. Two things guard against that being
 * wasteful or racy: a minimum interval, and a shared in-flight promise so that
 * concurrent requests during a cold start join one pass rather than each
 * starting their own and re-ingesting the same logs.
 */

export interface SyncResult {
  ranAt: number
  skipped: boolean
  batchesSealed: number
  escalated: number
}

let lastRun = 0
let inFlight: Promise<SyncResult> | null = null

async function runSync(sealEverything: boolean): Promise<SyncResult> {
  const ranAt = Date.now()

  try {
    await scanAllParties(onDonation)
  } catch (err) {
    console.warn(`[sync] indexer pass failed: ${(err as Error).message}`)
  }

  let escalated = 0
  try {
    escalated = await sweepOverdue()
  } catch (err) {
    console.warn(`[sync] overdue sweep failed: ${(err as Error).message}`)
  }

  let batchesSealed = 0
  try {
    batchesSealed = sealEverything ? await sealAll() : await sealDueBatches()
  } catch (err) {
    console.warn(`[sync] sealing failed: ${(err as Error).message}`)
  }

  lastRun = Date.now()
  return { ranAt, skipped: false, batchesSealed, escalated }
}

/** Run a pass unless one ran recently. Cheap enough to call on every request. */
export async function syncIfStale({ force = false } = {}): Promise<SyncResult> {
  if (inFlight) return inFlight

  if (!force && Date.now() - lastRun < config.sync.minIntervalMs) {
    return { ranAt: lastRun, skipped: true, batchesSealed: 0, escalated: 0 }
  }

  inFlight = runSync(force).finally(() => { inFlight = null })
  return inFlight
}

/**
 * Force a pass and seal everything outstanding, whether or not the batch is
 * due. This is what the interface's sync control calls: someone who presses it
 * wants the evidence on-chain now, not at the next interval.
 */
export async function syncNow(): Promise<SyncResult> {
  if (inFlight) await inFlight
  inFlight = runSync(true).finally(() => { inFlight = null })
  return inFlight
}
