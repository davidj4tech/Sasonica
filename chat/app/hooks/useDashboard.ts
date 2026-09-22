/**
 * GET /dashboard (§6.11) for the home screen: polled every 5 s while the
 * page is visible (usePoll stops while hidden and ticks at once on return),
 * painted first from the last saved answer (lib/snapshots.ts) with `stale`
 * until the server confirms it.
 *
 * Optimistic: a card answered here leaves Needs you at once (`answered`),
 * and stays gone until an answer from the server asked AFTER the press no
 * longer lists that question — a poll already in flight when the press went
 * out must not bring it back.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { getDashboard } from '../api'
import type { Approval, DashboardResponse, DashNeed } from '../api/types'
import { loadDashboard, peekDashboard, saveDashboard } from '../lib/snapshots'
import { usePoll } from './usePoll'

export const DASHBOARD_POLL_MS = 5000

export function useDashboard() {
  const [data, setData] = useState<DashboardResponse | undefined>(() => peekDashboard())
  const [stale, setStale] = useState(() => !!peekDashboard())
  const [error, setError] = useState('')
  /** approval key → when it was answered here (ms). */
  const answered = useRef(new Map<string, number>())
  /** session → the question the server handed back (a 409, or the next dialog), until a newer poll. */
  const replaced = useRef(new Map<string, { approval: Approval; at: number }>())
  const [, bump] = useState(0)

  useEffect(() => {
    if (peekDashboard()) return
    void loadDashboard().then((res) => {
      if (!res) return
      setData((d) => d || res)
      setStale(true)
    })
  }, [])

  const kick = usePoll(
    async () => {
      const askedAt = Date.now()
      try {
        const res = await getDashboard()
        saveDashboard(res)
        // Forget a hidden card once an answer asked after the press agrees.
        for (const [key, at] of answered.current) {
          if (askedAt > at && !res.needs_you.some((n) => n.approval?.key === key)) answered.current.delete(key)
        }
        for (const [session, r] of replaced.current) if (askedAt > r.at) replaced.current.delete(session)
        setData(res)
        setStale(false)
        setError('')
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    },
    () => DASHBOARD_POLL_MS,
    true
  )

  /**
   * A card was answered here: hide it now (`next` null), or show the
   * question the server answered with instead (a 409 "the question has
   * changed", or the next dialog) — then ask again soon.
   */
  const settle = useCallback(
    (session: string, key: string, next: Approval | null) => {
      const at = Date.now()
      answered.current.set(key, at)
      if (next) replaced.current.set(session, { approval: next, at })
      else replaced.current.delete(session)
      bump((n) => n + 1)
      window.setTimeout(kick, 800)
    },
    [kick]
  )

  let view = data
  if (data && (answered.current.size || replaced.current.size)) {
    const needs: DashNeed[] = []
    for (const n of data.needs_you) {
      const r = replaced.current.get(n.session)
      if (r) needs.push({ ...n, approval: r.approval, kind: r.approval.kind === 'question' ? 'question' : 'approval' })
      else if (!answered.current.has(n.approval?.key)) needs.push(n)
    }
    view = { ...data, needs_you: needs }
  }
  return { data: view, stale, error, reload: kick, settle }
}
