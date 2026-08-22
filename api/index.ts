import type { IncomingMessage, ServerResponse } from 'node:http'
import app, { bootstrap } from '../src/app.js'

/**
 * Serverless entry point.
 *
 * Each cold start begins with an empty in-memory store, so bootstrap() runs
 * once per instance and is memoised — without the guard, concurrent requests
 * during a cold start would each seed the demonstration data and the dashboard
 * would show every donation several times over.
 */
let ready: Promise<void> | null = null

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  ready ??= bootstrap().catch((err) => {
    // A failed bootstrap must not poison the instance forever; clear it so the
    // next request can try again rather than serving an empty dashboard.
    ready = null
    throw err
  })
  await ready
  return (app as unknown as (q: IncomingMessage, s: ServerResponse) => void)(req, res)
}
