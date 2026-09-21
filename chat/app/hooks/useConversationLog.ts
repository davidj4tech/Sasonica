/**
 * One thread's transcript, kept up to date by polling GET /conversation/log.
 *
 * v0 has no stream (§11 is v1), so this is the §6.2 adaptive poll, by
 * setTimeout: 1 s while a line is live (the bold has to keep up with the
 * voice) or just after anything changed, 2 s while a turn is `working` or an
 * `approval` is on screen, 15 s idle. The behaviour and the reasons for each
 * number come from Sasonica's ConversationLog.vue.
 *
 * When §11 lands, the stream's `snapshot` replaces `apply(res)` wholesale and
 * `line` / `live` / `working` / `approval` / `suggestion` events patch the
 * same state; this poll stays as the fallback.
 *
 * Stale-while-revalidate: the thread opens on its last saved lines
 * (lib/snapshots.ts), marked `stale`, and the first good poll replaces them.
 * Lines keep their ids (`${session}:${at}`), so the swap updates messages in
 * place rather than remounting them. Every good poll saves the lines back
 * (only when they changed).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError, fetchLogTail, getConversationLog } from '../api'
import type { Approval, ConversationLog, Line, Working } from '../api/types'
import { liveClockOf, type LiveClock } from '../lib/followAlong'
import { unmatched, type PendingSend } from '../lib/pending'
import { loadThread, peekThread, plainLine, saveThreadLog } from '../lib/snapshots'
import { usePoll } from './usePoll'

const POLL_IDLE_MS = 15000
const POLL_FAST_MS = 1000
const POLL_WORKING_MS = 2000
/** A session the server knows nothing about yet (404): ask again soon. */
const POLL_MISSING_MS = 3000
/** Keep the fast cadence this long after the transcript last changed. */
const FAST_LINGER_MS = 20 * 1000
/** Ceiling on the fast cadence while merely waiting for an answer. */
const FAST_WINDOW_MS = 3 * 60 * 1000
/** How long an ended live line is held while the server catches up. */
const ENDED_LIVE_HOLD_MS = 30 * 1000
/**
 * A cold open (nothing cached) asks for this many newest lines first, once
 * the server supports `?tail=` (api fetchLogTail); today it gets them all.
 */
const COLD_TAIL_LINES = 40

export interface LogState {
  lines: Line[]
  pending: boolean
  working: Working | null
  /** Local ms when `working` was read, to run its timer between polls. */
  workingAt: number
  approval: Approval | null
  suggestion: string
  live: LiveClock | null
  error: string
  loaded: boolean
  /**
   * 404 "no conversation for that session yet" (§10): nothing at all is
   * known about it — no line, no pane, no transcript. Rare (a session the
   * app just started has a pane); the poll keeps asking.
   */
  missing: boolean
  /**
   * The lines are the saved snapshot, not yet confirmed by the server. The
   * header says "updating…"; nothing live (bold, approval, working) is shown
   * from a snapshot.
   */
  stale: boolean
}

const EMPTY: LogState = {
  lines: [],
  pending: false,
  working: null,
  workingAt: 0,
  approval: null,
  suggestion: '',
  live: null,
  error: '',
  loaded: false,
  missing: false,
  stale: false
}

function fromSnapshot(lines: Line[]): LogState {
  // Already plain (snapshots strips live fields); again here so a cached
  // live line can never start a follow-along clock whatever wrote it.
  return { ...EMPTY, lines: lines.map(plainLine), loaded: true, stale: true }
}

/**
 * Keyed by `session`, for the snapshot and the log itself (§10) — polling
 * starts at once, with no lookup in front of it. Mount one per thread (the
 * page keys it by session).
 */
export function useConversationLog(session: string) {
  const [state, setState] = useState<LogState>(() => {
    // Memory hit (moved here from inside the app): paint on the first render.
    const snap = peekThread(session)
    return snap?.lines.length ? fromSnapshot(snap.lines) : EMPTY
  })
  // Sent from here and not yet back as a "you" line (lib/pending.ts).
  const [sends, setSends] = useState<PendingSend[]>([])
  const [awaiting, setAwaiting] = useState(false)

  const stateRef = useRef(state)
  stateRef.current = state
  const awaitingRef = useRef(awaiting)
  awaitingRef.current = awaiting
  const sigRef = useRef('')
  const changedAtRef = useRef(0)
  const endedLiveRef = useRef<{ line: Line; until: number } | null>(null)
  /** A fresh answer has been applied; the snapshot must not overwrite it. */
  const freshRef = useRef(false)
  /** The next poll must fetch the whole log (after a partial tail). */
  const needFullRef = useRef(false)

  // Disk hit (a cold start of the app): paint as soon as IndexedDB answers,
  // which is milliseconds, unless the network somehow beat it.
  useEffect(() => {
    let cancelled = false
    if (stateRef.current.loaded) return
    void loadThread(session).then((snap) => {
      if (cancelled || freshRef.current || !snap?.lines.length) return
      setState((s) => (s.loaded ? s : fromSnapshot(snap.lines)))
    })
    return () => {
      cancelled = true
    }
  }, [session])

  /**
   * A reply stops being live a beat before it lands in history; a poll in
   * between gets the conversation without it and the page shrinks by a whole
   * reply. Hold the ended line until the same `at` comes back (or 30 s).
   * (ConversationLog.vue `carryEndedLive`.)
   */
  const carryEndedLive = useCallback((lines: Line[]): Line[] => {
    const wasLive = stateRef.current.lines.find((l) => l.live)
    if (wasLive && !lines.some((l) => l.at === wasLive.at)) {
      endedLiveRef.current = { line: { ...wasLive, live: false }, until: Date.now() + ENDED_LIVE_HOLD_MS }
    }
    const held = endedLiveRef.current
    if (!held) return lines
    if (lines.some((l) => l.at === held.line.at) || Date.now() > held.until) {
      endedLiveRef.current = null
      return lines
    }
    return [...lines, held.line]
  }, [])

  const apply = useCallback(
    (res: ConversationLog, askedAt: number) => {
      const now = Date.now()
      const lines = carryEndedLive(res.lines || [])
      const last = lines[lines.length - 1]
      if (last && last.who !== 'you') setAwaiting(false)

      // A cheap signature of what is on screen; any change re-arms the fast
      // cadence, whoever caused it.
      const sig =
        lines.length +
        '|' +
        (last ? `${last.who}:${last.text}#${last.live ? last.sentence : ''}` : '') +
        '|' +
        (res.approval ? res.approval.key : '') +
        '|' +
        (res.working ? res.working.count : '')
      if (sig !== sigRef.current) {
        sigRef.current = sig
        changedAtRef.current = now
      }

      // Retire sends whose own line is back (lib/pending.ts: no clocks).
      setSends((cur) => unmatched(cur, lines, now))

      const liveLine = lines.find((l) => l.live)
      setState({
        lines,
        pending: !!res.pending,
        working: res.working || null,
        workingAt: now,
        approval: res.approval || null,
        suggestion: res.pending ? '' : res.suggestion || '',
        live: liveLine ? liveClockOf(liveLine, now, now - askedAt) : null,
        error: '',
        loaded: true,
        missing: false,
        stale: false
      })
    },
    [carryEndedLive]
  )

  const fetchOnce = useCallback(async () => {
    if (!session) return
    const askedAt = Date.now()
    try {
      let res: ConversationLog
      if (!freshRef.current && !stateRef.current.lines.length && !needFullRef.current) {
        // Cold open with nothing to show: the newest lines first (see
        // COLD_TAIL_LINES), the rest on the very next tick.
        const tail = await fetchLogTail(session, COLD_TAIL_LINES)
        needFullRef.current = !tail.complete
        res = tail
      } else {
        res = await getConversationLog(session)
        needFullRef.current = false
      }
      freshRef.current = true
      apply(res, askedAt)
      // A partial tail must not replace a fuller snapshot on disk.
      if (!needFullRef.current) saveThreadLog(session, res)
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setState((s) => ({ ...s, error: '', loaded: true, missing: true }))
        return
      }
      // Keep the lines: blanking a transcript over a blinked network is
      // worse than showing one a few seconds old.
      setState((s) => ({ ...s, error: err instanceof Error ? err.message : String(err), loaded: true }))
    }
  }, [session, apply])

  const nextDelay = useCallback(() => {
    const s = stateRef.current
    // A tail arrived; fetch the older lines above it straight away.
    if (needFullRef.current) return 0
    if (s.missing) return POLL_MISSING_MS
    if (s.live) return POLL_FAST_MS
    if (s.working || s.approval) return POLL_WORKING_MS
    const since = Date.now() - changedAtRef.current
    if (since < FAST_LINGER_MS) return POLL_FAST_MS
    if ((awaitingRef.current || s.pending) && since < FAST_WINDOW_MS) return POLL_FAST_MS
    return POLL_IDLE_MS
  }, [])

  const kick = usePoll(fetchOnce, nextDelay, !!session, [session])

  /**
   * A message is going out: show it at once ("sending…"), remembering which
   * "you" lines the thread already had, and poll fast. Returns its local id
   * for sent() / failed().
   */
  const seqRef = useRef(0)
  const sending = useCallback(
    (text: string): string => {
      const id = `${Date.now()}-${++seqRef.current}`
      const before = stateRef.current.lines.filter((l) => l.who === 'you').map((l) => l.at)
      setSends((cur) => [...cur, { id, text, at: Date.now() / 1000, before, state: 'sending' }])
      setAwaiting(true)
      changedAtRef.current = Date.now()
      kick()
      return id
    },
    [kick]
  )
  /** The server took it; it stays until its own line comes back. */
  const sent = useCallback(
    (id: string) => {
      setSends((cur) => cur.map((s) => (s.id === id && s.state === 'sending' ? { ...s, state: 'sent' } : s)))
      changedAtRef.current = Date.now()
      kick()
    },
    [kick]
  )
  /** It did not go (or was typed but not taken): keep the words, with why. */
  const failed = useCallback((id: string, error: string, untaken = false) => {
    setSends((cur) => cur.map((s) => (s.id === id ? { ...s, state: untaken ? 'untaken' : 'failed', error } : s)))
    setAwaiting(false)
  }, [])
  /** Take a failed send away (retry sends it again as a new one). */
  const discard = useCallback((id: string) => {
    setSends((cur) => cur.filter((s) => s.id !== id))
  }, [])

  /**
   * Re-render from the answer's `approval` (the next dialog, or a 409's
   * current one) without waiting for the next poll. Not followed by a poll:
   * the answer is the newer reading, and the 2 s cadence confirms it.
   */
  const setApproval = useCallback((approval: Approval | null) => {
    changedAtRef.current = Date.now()
    setState((s) => ({ ...s, approval }))
  }, [])

  const isRunning = state.pending || awaiting || !!state.working
  // Reconciled against the lines being drawn too, not only in apply(): a
  // line that arrived before the send was even marked never shows beside it.
  const optimistic = useMemo(() => unmatched(sends, state.lines), [sends, state.lines])
  return useMemo(
    () => ({ ...state, optimistic, isRunning, sending, sent, failed, discard, setApproval, refresh: kick }),
    [state, optimistic, isRunning, sending, sent, failed, discard, setApproval, kick]
  )
}
