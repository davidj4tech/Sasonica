/**
 * One thread. The session comes from the URL; v0's log needs its ABS item, so
 * the page first resolves it with /conversation?session= (and keeps asking
 * while the shelf has none: "not on the shelf yet").
 *
 * A thread opened before paints from its saved snapshot and saved item at
 * once (lib/snapshots.ts), with "updating…" in the header until the first
 * fresh poll — never a spinner over content.
 */
import { useCallback, useMemo, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router'
import { answer, ApiError, reply, stopSession } from '../api'
import type { Approval, AskResponse, ReplyResponse } from '../api/types'
import { Thread } from '../components/Thread'
import { useConversationLog } from '../hooks/useConversationLog'
import { knownTitle, useSessionStates, useThreadInfo } from '../hooks/useThreads'
import { buildItems } from '../lib/convert'

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

  const { info, item, error: infoError } = useThreadInfo(session)
  const log = useConversationLog(session, item)
  const states = useSessionStates()
  const [status, setStatus] = useState<Status>(null)

  const items = useMemo(
    () => buildItems({ session, lines: log.lines, approval: log.approval, live: log.live, optimistic: log.optimistic }),
    [session, log.lines, log.approval, log.live, log.optimistic]
  )

  const onSend = useCallback(
    async (text: string) => {
      setStatus({ text: 'Sending…' })
      try {
        const res: ReplyResponse | AskResponse = await reply({ session, item }, text)
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
    [session, item, log]
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

  const state = states[session]
  const live = state ? true : !!info?.live

  let empty: React.ReactNode = null
  if (log.lines.length) {
    // A snapshot is on screen; whatever the item lookup is doing, it is
    // not a reason to say "Loading…".
  } else if (!item) {
    empty = (
      <div className="empty">
        {infoError ? (
          <p className="error">{infoError}</p>
        ) : !info ? (
          <p className="delayed">Loading…</p>
        ) : info.scanning ? (
          <p>On the shelf, still being built — the transcript will appear shortly.</p>
        ) : (
          <p>Not on the shelf yet. The first reply is published a minute after it is spoken; this page keeps checking.</p>
        )}
      </div>
    )
  } else if (log.error && !log.lines.length) {
    empty = <p className="empty error">{log.error}</p>
  } else if (!log.loaded) {
    empty = <p className="empty delayed">Loading…</p>
  }

  return (
    <div className="page thread-page">
      <header className="bar">
        <Link className="icon" to="/" title="Threads">
          ←
        </Link>
        <h1 className="grow">{title}</h1>
        {log.stale && <span className="updating">updating…</span>}
        <span className={`badge ${state || ''}`}>{state || (live ? 'live' : info?.resumable ? 'resumable' : 'ended')}</span>
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
        placeholder={info && !live ? 'Session closed. Sending resumes it' : undefined}
        status={
          (status || (log.error && log.lines.length > 0)) && (
            <p className={status?.failed || !status ? 'status failed' : 'status'}>{status ? status.text : log.error}</p>
          )
        }
      />
    </div>
  )
}
