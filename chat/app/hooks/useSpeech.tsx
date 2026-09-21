/**
 * The voice, app-wide: ONE poll of GET /speech/now for every screen, and the
 * listening keys (POST /speech/ctl) the speech bar and the messages press
 * (server-contract.md §6.5).
 *
 * Cadence, as Sasonica's SpeechBar.vue: 1.5 s while a voice is live (the
 * sentence has to keep up, and the bar settles soon after the reply ends),
 * 5 s while quiet, 15 s after a failure. Nothing while the page is hidden,
 * and a poll at once when it comes back (hooks/usePoll.ts).
 *
 * Optimistic keys: a press changes what the bar shows at once (paused, speed,
 * muted) and the change is held until a poll ASKED AFTER the press was
 * answered comes back — an older answer in flight would otherwise flip the
 * icon back for a beat. A refused press drops the change and says why.
 * Screens that follow the words too (a thread's live line) subscribe to
 * `onSettled` and re-read their own state straight after.
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { getSpeechNow, speechCtl } from '../api'
import { hasCredential, serverBase } from '../api/auth'
import type { SessionId, SpeechAction, SpeechCtlResponse, SpeechNow } from '../api/types'
import { usePoll } from './usePoll'

const POLL_LIVE_MS = 1500
const POLL_IDLE_MS = 5000
const POLL_FAILING_MS = 15000
/** The server's answer is the truth; ask for it this soon after a press. */
const CONFIRM_AFTER_MS = 300
/** A finished reply keeps the bar (Replay) this long. */
const FINISHED_HOLD_MS = 30 * 1000
const ERROR_SHOWN_MS = 4000

/** Speed ladder, as `media speed up|down` (agent_media_core/cli.py _speed_next). */
const SPEED_RUNGS = [1.0, 1.25, 1.5, 2.0, 3.0]
export function speedNext(cur: number, dir: 1 | -1): number {
  const eps = 1e-6
  if (dir > 0) {
    if (cur < 1 - eps) return Math.min(Math.round((cur + 0.1) * 100) / 100, 1)
    return SPEED_RUNGS.find((r) => r > cur + eps) ?? 3
  }
  if (cur > 1 + eps) return [...SPEED_RUNGS].reverse().find((r) => r < cur - eps) ?? 1
  return Math.max(Math.round((cur - 0.1) * 100) / 100, 0.3)
}

/** What the optimistic layer may change. */
type Override = Partial<Pick<SpeechNow, 'paused' | 'speaking' | 'speed' | 'muted'>>

/** The last reply heard, so the bar can offer it again once it has ended. */
export interface Finished {
  title: string
  session: SessionId | null
  endedAt: number
}

export interface Speech {
  /** The server's answer with any unconfirmed press applied; null before the first. */
  now: SpeechNow | null
  /** Local ms the request behind `now` was SENT (its `pos` is no newer than this). */
  nowAskedAt: number
  /** The reply that just ended (held FINISHED_HOLD_MS), or null. */
  finished: Finished | null
  /** The last press was refused: the sentence to show, briefly. */
  error: string
  /** An unconfirmed pause/resume: when it was pressed and what it asked for. */
  pausePress: { paused: boolean; at: number } | null
  /** Which turn the turn keys are on, as the popup's hist_idx (1 = latest). */
  histIdx: number
  ctl: (action: SpeechAction, arg?: number) => Promise<SpeechCtlResponse | null>
  toggle: () => void
  prevTurn: () => void
  nextTurn: () => void
  replayLatest: () => void
  replayId: (id: number) => void
  resetTurns: () => void
  dismissFinished: () => void
  /** Called after every press settles (ok or not). Returns the unsubscribe. */
  onSettled: (fn: () => void) => () => void
}

/** The keys alone: stable for the life of the app, so a message that only
 *  replays does not re-render on every 1.5 s poll. */
export type SpeechActions = Pick<Speech, 'ctl' | 'toggle' | 'replayLatest' | 'replayId' | 'onSettled'>

const SpeechContext = createContext<Speech | null>(null)
const SpeechActionsContext = createContext<SpeechActions | null>(null)

export function useSpeech(): Speech {
  const ctx = useContext(SpeechContext)
  if (!ctx) throw new Error('useSpeech outside SpeechProvider')
  return ctx
}

export function useSpeechActions(): SpeechActions {
  const ctx = useContext(SpeechActionsContext)
  if (!ctx) throw new Error('useSpeechActions outside SpeechProvider')
  return ctx
}

export function SpeechProvider({ children }: { children: ReactNode }) {
  const [server, setServer] = useState<SpeechNow | null>(null)
  const [serverAskedAt, setServerAskedAt] = useState(0)
  const [override, setOverride] = useState<{ o: Override; pause: { paused: boolean; at: number } | null } | null>(null)
  const [finished, setFinished] = useState<Finished | null>(null)
  const [error, setError] = useState('')
  const [histIdx, setHistIdx] = useState(1)

  const failingRef = useRef(false)
  const serverRef = useRef(server)
  serverRef.current = server
  const overrideRef = useRef(override)
  overrideRef.current = override
  /** Presses not yet answered, and when the last one was. */
  const inflightRef = useRef(0)
  const settledAtRef = useRef(0)
  const listenersRef = useRef(new Set<() => void>())
  const errorTimerRef = useRef<number | null>(null)

  const poll = useCallback(async () => {
    if (!hasCredential() || !serverBase()) {
      setServer(null)
      return
    }
    const askedAt = Date.now()
    try {
      const res = await getSpeechNow()
      failingRef.current = false
      // A press went out after this was asked (or is still out): this answer
      // predates it. The next one will be newer.
      if (inflightRef.current > 0 || askedAt < settledAtRef.current) return
      const was = serverRef.current
      if (was?.live && !res.live && was.title) setFinished({ title: was.title, session: was.session, endedAt: Date.now() })
      if (res.live) setFinished(null)
      // The ref now, not at the next render: usePoll asks for the next
      // delay as soon as this returns, and it must see `live`.
      serverRef.current = res
      setServer(res)
      setServerAskedAt(askedAt)
      setOverride(null)
    } catch {
      // No canvas, not allowed, or the network blinked: no bar, and ask
      // less often until it answers again.
      failingRef.current = true
      serverRef.current = null
      setServer(null)
    }
  }, [])

  const kick = usePoll(
    poll,
    () => (failingRef.current ? POLL_FAILING_MS : serverRef.current?.live ? POLL_LIVE_MS : POLL_IDLE_MS),
    true
  )

  const showError = useCallback((text: string) => {
    setError(text)
    if (errorTimerRef.current !== null) window.clearTimeout(errorTimerRef.current)
    errorTimerRef.current = window.setTimeout(() => setError(''), ERROR_SHOWN_MS)
  }, [])

  const ctl = useCallback(
    async (action: SpeechAction, arg?: number, optimistic?: Override) => {
      if (optimistic) {
        const pause = optimistic.paused !== undefined ? { paused: optimistic.paused, at: Date.now() } : null
        setOverride((cur) => ({ o: { ...cur?.o, ...optimistic }, pause: pause || cur?.pause || null }))
      }
      inflightRef.current += 1
      let res: SpeechCtlResponse | null = null
      try {
        res = await speechCtl(action, arg)
      } catch (err) {
        // Roll back what the press showed; the poll brings the truth.
        if (optimistic) setOverride(null)
        showError(err instanceof Error ? err.message : String(err))
      } finally {
        inflightRef.current -= 1
        settledAtRef.current = Date.now()
      }
      window.setTimeout(kick, CONFIRM_AFTER_MS)
      for (const fn of listenersRef.current) window.setTimeout(fn, CONFIRM_AFTER_MS)
      return res
    },
    [kick, showError]
  )

  const replayLatest = useCallback(() => {
    setHistIdx(1)
    void ctl('replay', 1)
  }, [ctl])

  const toggle = useCallback(() => {
    const cur = serverRef.current
    const o = overrideRef.current?.o
    // Nothing playing: the button means the popup's r, not a pause.
    if (!cur?.live) return replayLatest()
    const paused = !(o?.paused ?? cur.paused)
    void ctl('toggle', undefined, { paused, speaking: !paused })
  }, [ctl, replayLatest])

  // The popup's <: a restart first when well into a turn, else the older
  // turn. The server prints the turn it chose, so the next press starts there.
  const prevTurn = useCallback(() => {
    void ctl('prev', histIdx).then((res) => {
      const n = parseInt(String(res?.out || '').trim(), 10)
      if (n > 0) setHistIdx(n)
    })
  }, [ctl, histIdx])

  // The popup's >: a newer turn while going back through them, and the end
  // of the reply once at the latest.
  const nextTurn = useCallback(() => {
    if (histIdx > 1) {
      const n = histIdx - 1
      setHistIdx(n)
      void ctl('replay', n)
    } else {
      void ctl('jump-end')
    }
  }, [ctl, histIdx])

  const replayId = useCallback((id: number) => void ctl('replay-id', id), [ctl])

  const publicCtl = useCallback(
    (action: SpeechAction, arg?: number) => {
      const cur = serverRef.current
      const o = overrideRef.current?.o
      const speed = o?.speed ?? cur?.speed ?? 1
      const optimistic: Override | undefined =
        action === 'speed+' ? { speed: speedNext(speed, 1) }
        : action === 'speed-' ? { speed: speedNext(speed, -1) }
        : action === 'speed0' ? { speed: 1 }
        : action === 'mute' ? { muted: !(o?.muted ?? cur?.muted) }
        : undefined
      return ctl(action, arg, optimistic)
    },
    [ctl]
  )

  const onSettled = useCallback((fn: () => void) => {
    listenersRef.current.add(fn)
    return () => void listenersRef.current.delete(fn)
  }, [])

  const now = useMemo(() => (server && override ? { ...server, ...override.o } : server), [server, override])
  const finishedShown = finished && Date.now() - finished.endedAt < FINISHED_HOLD_MS ? finished : null

  const value = useMemo<Speech>(
    () => ({
      now,
      nowAskedAt: serverAskedAt,
      finished: finishedShown,
      error,
      pausePress: override?.pause || null,
      histIdx,
      ctl: publicCtl,
      toggle,
      prevTurn,
      nextTurn,
      replayLatest,
      replayId,
      resetTurns: () => setHistIdx(1),
      dismissFinished: () => setFinished(null),
      onSettled
    }),
    [now, serverAskedAt, finishedShown, error, override, histIdx, publicCtl, toggle, prevTurn, nextTurn, replayLatest, replayId, onSettled]
  )

  const actions = useMemo<SpeechActions>(
    () => ({ ctl: publicCtl, toggle, replayLatest, replayId, onSettled }),
    [publicCtl, toggle, replayLatest, replayId, onSettled]
  )

  return (
    <SpeechActionsContext.Provider value={actions}>
      <SpeechContext.Provider value={value}>{children}</SpeechContext.Provider>
    </SpeechActionsContext.Provider>
  )
}
