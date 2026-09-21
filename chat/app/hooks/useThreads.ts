import { useCallback, useEffect, useState } from 'react'
import { getSessionsState, getTargets } from '../api'
import type { Place, SessionRow, SessionState, SessionsStateResponse, TargetsResponse } from '../api/types'
import { loadStates, loadTargets, peekStates, peekTargets, saveStates, saveTargets } from '../lib/snapshots'
import { usePoll } from './usePoll'

/**
 * Rows seen in /targets, so a thread page has a heading (and knows whether
 * the session is live) before it asks anything — the page itself asks only
 * for the log (§10).
 */
const known = new Map<string, SessionRow>()
export function knownTitle(session: string): string {
  return (known.get(session) || peekTargets()?.sessions.find((r) => r.session === session))?.title || ''
}
/** Live per the last /targets seen; undefined when the list never showed it. */
export function knownLive(session: string): boolean | undefined {
  return (known.get(session) || peekTargets()?.sessions.find((r) => r.session === session))?.live
}

function rowsOf(res: TargetsResponse): SessionRow[] {
  for (const row of res.sessions) known.set(row.session, row)
  // Live first (the server already orders them so; kept explicit).
  return [...res.sessions].sort((a, b) => Number(b.live) - Number(a.live))
}

/**
 * GET /targets — on open, and on demand (§6.1: "on open"). Paints from the
 * last saved answer first (lib/snapshots.ts); `stale` until the server
 * confirms it.
 */
export function useTargets() {
  const [cached] = useState(() => peekTargets())
  const [sessions, setSessions] = useState<SessionRow[]>(() => (cached ? rowsOf(cached) : []))
  const [places, setPlaces] = useState<Place[]>(() => cached?.places || [])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [stale, setStale] = useState(!!cached)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getTargets()
      saveTargets(res)
      setSessions(rowsOf(res))
      setPlaces(res.places || [])
      setError('')
      setStale(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let fresh = false
    // Disk snapshot (a cold start of the app), unless the network beat it.
    if (!cached) {
      void loadTargets().then((res) => {
        if (fresh || !res) return
        setSessions((s) => (s.length ? s : rowsOf(res)))
        setPlaces((p) => (p.length ? p : res.places || []))
        setStale(true)
      })
    }
    void load().then(() => {
      fresh = true
    })
  }, [load, cached])

  return { sessions, places, error, loading, stale, reload: load }
}

function stateMap(res: SessionsStateResponse | undefined): Record<string, SessionState> {
  const next: Record<string, SessionState> = {}
  for (const row of res?.sessions || []) next[row.session] = row.state
  return next
}

/**
 * GET /sessions/state, polled every 5 s (§6.1). Absent = not live. Starts
 * from the last saved answer, so the list's badges paint with it.
 */
export function useSessionStates(enabled = true) {
  const [states, setStates] = useState<Record<string, SessionState>>(() => stateMap(peekStates()))
  useEffect(() => {
    if (peekStates()) return
    void loadStates().then((res) => {
      if (res) setStates((s) => (Object.keys(s).length ? s : stateMap(res)))
    })
  }, [])
  usePoll(
    async () => {
      try {
        const res = await getSessionsState()
        saveStates(res)
        setStates(stateMap(res))
      } catch {
        // Keep the last map; the list's own error line says what is wrong.
      }
    },
    () => 5000,
    enabled
  )
  return states
}
