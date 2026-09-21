/**
 * Warm the snapshot cache for the threads David is most likely to open next,
 * while he is looking at the list — so tapping one paints from the phone and
 * the network only confirms it.
 *
 * Deliberately gentle, because the link is slow (~0.43 s a round trip, 2 s+
 * for a log) and the list's own polls share it:
 *  - the top PREFETCH_COUNT rows only (the list is live-first, so live ones
 *    come first), one request at a time, at `priority: 'low'`;
 *  - a thread fetched in the last FRESH_ENOUGH_MS is skipped (an open thread
 *    polls, and that counts);
 *  - once per list visit, after the fresh /targets answer — never on the
 *    /sessions/state poll — and not again within RUN_EVERY_MS of the last run;
 *  - everything is aborted when the list goes away, so the thread page's own
 *    requests are not queued behind a prefetch.
 */
import { useEffect } from 'react'
import { getConversationLog, getSessionConversation } from '../api'
import type { SessionRow } from '../api/types'
import { lastChecked, loadThread, saveThreadItem, saveThreadLog } from '../lib/snapshots'

const PREFETCH_COUNT = 5
const FRESH_ENOUGH_MS = 3 * 60 * 1000
const RUN_EVERY_MS = 60 * 1000
/** Let the list paint and its first poll land before adding traffic. */
const START_DELAY_MS = 1000

let lastRunAt = 0

async function prefetchOne(session: string, signal: AbortSignal) {
  if (Date.now() - (await lastChecked(session)) < FRESH_ENOUGH_MS) return
  let item = (await loadThread(session))?.item || null
  if (!item) {
    const info = await getSessionConversation(session, { signal, priority: 'low' })
    if (!info.item || info.scanning) return // not on the shelf yet: nothing to warm
    item = info.item
    saveThreadItem(session, item)
  }
  if (signal.aborted) return
  const log = await getConversationLog(item, { signal, priority: 'low' })
  saveThreadLog(session, item, log)
}

/** `ready`: the list holds the server's fresh answer (not a snapshot). */
export function usePrefetch(rows: SessionRow[], ready: boolean) {
  useEffect(() => {
    if (!ready || !rows.length) return
    if (Date.now() - lastRunAt < RUN_EVERY_MS) return
    const ctl = new AbortController()
    const timer = window.setTimeout(async () => {
      lastRunAt = Date.now()
      for (const row of rows.slice(0, PREFETCH_COUNT)) {
        if (ctl.signal.aborted || document.hidden) return
        try {
          await prefetchOne(row.session, ctl.signal)
        } catch {
          // Best-effort: a failed warm-up just means that thread opens cold.
          if (ctl.signal.aborted) return
        }
      }
    }, START_DELAY_MS)
    return () => {
      window.clearTimeout(timer)
      ctl.abort()
    }
    // Once per fresh list, not per re-render of the same rows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])
}
