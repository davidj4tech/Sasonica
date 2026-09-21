/**
 * One thread. The session comes from the URL, and it is all the page needs:
 * the log is asked by session (/conversation/log?session=, §10) — ONE
 * request to open a thread, shelved or not — and replies go to
 * /reply {session}. A thread that is not on the shelf yet is as readable
 * and repliable as any other.
 *
 * A thread opened before paints from its saved snapshot at once
 * (lib/snapshots.ts), with "updating…" in the header until the first fresh
 * poll — never a spinner over content.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router'
import { answer, ApiError, reply, stopSession } from '../api'
import type { Approval } from '../api/types'
import { SpeechBar } from '../components/SpeechBar'
import { Thread } from '../components/Thread'
import { useConversationLog } from '../hooks/useConversationLog'
import { useSpeech } from '../hooks/useSpeech'
import { knownLive, knownTitle, useSessionStates } from '../hooks/useThreads'
import { buildItems } from '../lib/convert'
import { withPaused, withSkew, type LiveClock } from '../lib/followAlong'
import type { SpeechNow } from '../api/types'

type Status = { text: string; failed?: boolean } | null

/**
 * Keyed by session: moving from one thread to another (same route) starts
 * every hook afresh — snapshot, poll, the bottom-first window in Thread —
 * rather than showing one thread's state under another's title.
 */
export default function ThreadRoute() {
  const { session = '' } = useParams()
  return <ThreadPage key={session} session={session} />
}

function ThreadPage({ session }: { session: string }) {
  const location = useLocation()
  const title = (location.state as { title?: string } | null)?.title || knownTitle(session) || session.slice(0, 8)

  const log = useConversationLog(session)
  const states = useSessionStates()
  const [status, setStatus] = useState<Status>(null)

  // The bar and the live line agree: a pause pressed (on the bar or the
  // message) stops the bold at once, before the log's next poll confirms
  // it; and any key re-reads the log straight after, so a skip moves the
  // bold as soon as the server has moved.
  const speech = useSpeech()
  const { refresh } = log
  useEffect(() => speech.onSettled(refresh), [speech.onSettled, refresh])
  const speakingHere = speech.now?.live && (speech.now.session === session || !speech.now.session)
  // The press is held past the bar's own confirmation until the log has
  // answered once more, so the bold does not step back for a beat between
  // the two polls.
  const heldRef = useRef<{ press: { paused: boolean; at: number }; seen?: LiveClock | null } | null>(null)
  const barPress = speakingHere ? speech.pausePress : null
  if (barPress) heldRef.current = { press: barPress }
  else if (heldRef.current) {
    if (!('seen' in heldRef.current)) heldRef.current.seen = log.live
    else if (heldRef.current.seen !== log.live) heldRef.current = null
  }
  const press = barPress || heldRef.current?.press || null
  const skew = useElapsedSkew(session, log.live, speech.now)
  const live = useMemo(() => {
    const clock = log.live && press ? withPaused(log.live, press.paused, press.at) : log.live
    return clock ? withSkew(clock, skew) : clock
  }, [log.live, press, skew])

  const items = useMemo(
    () => buildItems({ session, lines: log.lines, approval: log.approval, live, optimistic: log.optimistic }),
    [session, log.lines, log.approval, live, log.optimistic]
  )

  const onSend = useCallback(
    async (text: string) => {
      setStatus({ text: 'Sending…' })
      try {
        const res = await reply(session, text)
        // A revived session reads the reply once it has loaded, which can
        // take a minute — "sent" there would be a small lie (§6.3).
        setStatus({ text: res.opened ? 'Session reopened — it will pick this up shortly.' : 'Sent.' })
        log.sent(text)
      } catch (err) {
        // 502 with submitted:false: the words are in the composer but were
        // never taken — say so rather than showing "thinking" forever.
        if (err instanceof ApiError && err.payload.submitted === false) {
          setStatus({ text: `Typed into ${err.payload.pane || 'the session'} but not taken — press Enter at the desk.`, failed: true })
          return
        }
        setStatus({ text: err instanceof Error ? err.message : String(err), failed: true })
        throw err
      }
    },
    [session, log]
  )

  const onStop = useCallback(
    (speech: 'auto' | 'silence') => {
      stopSession({ session, speech }).catch((err) => setStatus({ text: err.message, failed: true }))
    },
    [session]
  )

  const actions = useMemo(
    () => ({
      answer: async (approval: Approval, choice: number) => {
        const res = await answer({ session, choice, key: approval.key })
        if (res.ok) {
          log.setApproval(res.res.approval)
          return { error: '', key: '' }
        }
        // 409 question_changed: re-render from the returned approval and let
        // the person choose again.
        if (res.changed) {
          log.setApproval(res.approval)
          return { error: 'The question changed — choose again.', key: res.approval?.key || '' }
        }
        return { error: res.error, key: approval.key }
      }
    }),
    [session, log]
  )

  // Live: /sessions/state lists it (polled), else the list said so, else
  // a pane-less live line in the log itself. `closed` only when we know.
  const state = states[session]
  const listLive = knownLive(session)
  const sessionLive = !!state || listLive === true || !!log.live
  const closed = !sessionLive && listLive === false

  let empty: React.ReactNode = null
  if (log.lines.length) {
    // A snapshot or the log is on screen.
  } else if (log.error) {
    empty = <p className="empty error">{log.error}</p>
  } else if (!log.loaded) {
    empty = <p className="empty delayed">Loading…</p>
  } else if (log.missing) {
    empty = <p className="empty">Nothing from this session yet — this page keeps checking.</p>
  } else {
    empty = <p className="empty">No messages yet.</p>
  }

  return (
    <div className="page thread-page">
      <header className="bar">
        <Link className="icon" to="/" title="Threads">
          ←
        </Link>
        <h1 className="grow">{title}</h1>
        {log.stale && <span className="updating">updating…</span>}
        {(state || sessionLive || closed) && <span className={`badge ${state || ''}`}>{state || (sessionLive ? 'live' : 'ended')}</span>}
      </header>
      <Thread
        items={items}
        isRunning={log.isRunning}
        working={log.working}
        workingAt={log.workingAt}
        thinking={log.isRunning}
        suggestion={log.suggestion}
        onSend={onSend}
        onStop={onStop}
        actions={actions}
        empty={empty}
        placeholder={closed ? 'Session closed. Sending resumes it' : undefined}
        speechBar={<SpeechBar here={session} />}
        status={
          (status || (log.error && log.lines.length > 0)) && (
            <p className={status?.failed || !status ? 'status failed' : 'status'}>{status ? status.text : log.error}</p>
          )
        }
      />
    </div>
  )
}

/** Below this, the log's clock and the player agree well enough (pos is whole seconds). */
const SKEW_MIN_S = 1
const SKEW_SAMPLES = 5

/**
 * How far the log's live `elapsed` runs ahead of what the listener hears.
 *
 * REALITY (red5, 22 Sep 2026, speech on the phone): `elapsed` is wall time
 * since the reply started, less pauses — but a streamed reply stalls
 * between clips, and the stalls are not taken off. Against /speech/now's
 * `pos` (the player's own position) it ran 3.5 s ahead after the first
 * clip and 14 s ahead (43.1 vs 29) forty seconds in, so the bold, and the
 * view following it, raced ahead of the voice. `delay` said 0.
 *
 * So for the thread being spoken, each /speech/now answer (every 1.5 s)
 * compares the two: the median of the last few differences, when over a
 * second, is held back from the bold as extra delay. `pos` is whole
 * seconds (+0.5 is its middle). Not playing, another thread, no `pos`: 0.
 */
function useElapsedSkew(session: string, clock: LiveClock | null, now: SpeechNow | null): number {
  const [skew, setSkew] = useState(0)
  const samplesRef = useRef<number[]>([])
  const clockRef = useRef(clock)
  clockRef.current = clock
  const sentences = clock?.sentences[0] || ''
  // A new reply starts afresh.
  useEffect(() => {
    samplesRef.current = []
    setSkew(0)
  }, [sentences])
  useEffect(() => {
    const c = clockRef.current
    if (!c || c.paused || !now?.live || now.paused || now.session !== session || typeof now.pos !== 'number') return
    const est = c.elapsed + (Date.now() - c.anchorMs) / 1000
    const samples = [...samplesRef.current.slice(-(SKEW_SAMPLES - 1)), est - (now.pos + 0.5)]
    samplesRef.current = samples
    const sorted = [...samples].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]
    setSkew(median > SKEW_MIN_S ? Math.round(median * 10) / 10 : 0)
  }, [now, session])
  return skew
}
