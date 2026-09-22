/**
 * The thread list: /targets.sessions (live first, with a live badge) and
 * what each live one is doing from /sessions/state, polled every 5 s.
 * Paints from the last saved answer; once the fresh one lands, the top few
 * threads are warmed in the background (hooks/usePrefetch.ts).
 */
import { useRef, useState } from 'react'
import { Link, Navigate } from 'react-router'
import { RenameSheet } from '../components/RenameSheet'
import { useRename } from '../hooks/useRename'
import { useTitle } from '../lib/titles'
import { hasDraft } from '../lib/drafts'
import { useUnread } from '../lib/arrivals'
import { SpeechBar } from '../components/SpeechBar'
import { hasCredential } from '../api/auth'
import type { SessionRow, SessionState } from '../api/types'
import { usePrefetch } from '../hooks/usePrefetch'
import { useSessionStates, useTargets } from '../hooks/useThreads'
import { Mark } from '../components/Mark'
import { ConfirmExitSheet, SessionMenuSheet, type SessionAction } from '../components/SessionSheets'
import { useSessionActions } from '../hooks/useSessionActions'
import { archivedOf, endedHere, useSessionFlags } from '../lib/sessionFlags'

const STATE_LABEL: Record<SessionState, string> = {
  working: 'working',
  waiting: 'your turn',
  approval: 'needs you'
}

function ago(at?: number): string {
  if (!at) return ''
  const s = Date.now() / 1000 - at
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m`
  if (s < 86400) return `${Math.round(s / 3600)}h`
  return `${Math.round(s / 86400)}d`
}

export default function Threads() {
  // First run: nothing to prove who we are yet — pair first.
  if (!hasCredential()) return <Navigate to="/pairing" replace />
  return <ThreadList />
}

function ThreadList() {
  const { sessions, error, loading, stale, reload } = useTargets()
  const states = useSessionStates()
  usePrefetch(sessions, !stale && !loading && !error)
  const [renaming, setRenaming] = useState<{ session: string; title: string } | null>(null)
  const [menu, setMenu] = useState<{ session: string; title: string; live: boolean; archived: boolean } | null>(null)
  const [confirm, setConfirm] = useState<{ session: string; archive: boolean } | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [note, setNote] = useState<{ text: string; failed?: boolean } | null>(null)
  const rename = useRename()
  const acts = useSessionActions()
  useSessionFlags()
  // Archived threads leave the main list for a folded section at its foot;
  // this app's own archive or exit shows before the server confirms it.
  const main: SessionRow[] = []
  const archived: SessionRow[] = []
  for (const row of sessions) (archivedOf(row.session, row.archived) ? archived : main).push(row)
  const say = (r: { ok: boolean; message: string }) => setNote(r.ok ? null : { text: r.message, failed: true })
  const pick = (a: SessionAction) => {
    const m = menu
    setMenu(null)
    if (!m) return
    if (a === 'rename') setRenaming({ session: m.session, title: m.title })
    else if (a === 'exit' || a === 'exit-archive') setConfirm({ session: m.session, archive: a === 'exit-archive' })
    else void acts.archive(m.session, a === 'archive').then(say)
  }
  const rowOf = (row: SessionRow) => (
    <ThreadRow
      key={row.session}
      row={row}
      state={states[row.session]}
      onMenu={(title, live) => setMenu({ session: row.session, title, live, archived: archivedOf(row.session, row.archived) })}
    />
  )

  return (
    <div className="page">
      <header className="bar">
        <h1 className="wordmark">
          <Mark size={28} />
          Sasonica
        </h1>
        {stale && loading && <span className="updating">updating…</span>}
        <button className="icon" onClick={() => reload()} title="Refresh">
          ↻
        </button>
        <Link className="icon" to="/notebook" title="Notes">
          ✎
        </Link>
        <Link className="icon" to="/settings" title="Settings">
          ⚙
        </Link>
      </header>

      {error && <p className="notice error">{error}</p>}
      {note && <p className={note.failed ? 'notice error' : 'notice'}>{note.text}</p>}
      {loading && !sessions.length && <p className="notice">Loading…</p>}

      <ul className="threads">
        {main.map(rowOf)}
        {archived.length > 0 && (
          <li className="archived-head">
            <button aria-expanded={showArchived} onClick={() => setShowArchived((v) => !v)}>
              <span className="caret" aria-hidden="true">
                {showArchived ? '▾' : '▸'}
              </span>
              Archived ({archived.length})
            </button>
          </li>
        )}
        {showArchived && archived.map(rowOf)}
      </ul>

      {menu && <SessionMenuSheet title={menu.title} live={menu.live} archived={menu.archived} onPick={pick} onClose={() => setMenu(null)} />}
      {confirm && (
        <ConfirmExitSheet
          archive={confirm.archive}
          onClose={() => setConfirm(null)}
          onConfirm={() => {
            const c = confirm
            setConfirm(null)
            void (c.archive ? acts.exitAndArchive(c.session) : acts.exit(c.session)).then(say)
          }}
        />
      )}

      {renaming && (
        <RenameSheet
          title={renaming.title}
          onClose={() => setRenaming(null)}
          onSave={(name) => {
            const { session } = renaming
            setRenaming(null)
            setNote(null)
            void rename(session, name).then((r) => setNote(r.ok && r.message === 'Renamed.' ? null : { text: r.message, failed: !r.ok }))
          }}
        />
      )}

      {/* The foot of the list: the speech bar when a voice is live, and the
          + button, which rides above it (app.css .dock). */}
      <div className="dock">
        <Link to="/new" className="fab" title="New chat">
          +
        </Link>
        <SpeechBar />
      </div>
    </div>
  )
}

/** Held this long, a press on a row is a long press (the thread's menu), not a tap. */
const LONG_PRESS_MS = 550

/**
 * One row. A long press (touch or mouse held, or the context menu that
 * Android's long press fires on a link) opens the thread's menu (Rename,
 * Exit, Archive) instead of the thread.
 */
function ThreadRow({ row, state: polled, onMenu }: { row: SessionRow; state: SessionState | undefined; onMenu: (title: string, live: boolean) => void }) {
  const title = useTitle(row.session, row.title) || row.session.slice(0, 8)
  // Exited from here: not live, whatever the last poll said.
  const live = row.live && !endedHere(row.session)
  const state = live ? polled : undefined
  const unread = useUnread(row.session)
  const timer = useRef<number | null>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  const longRef = useRef(false)
  const cancel = () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
  }
  const long = () => {
    cancel()
    longRef.current = true
    onMenu(title, live)
  }
  return (
    <li>
      <Link
        to={`/t/${encodeURIComponent(row.session)}`}
        state={{ title }}
        className={unread ? 'thread-row unread' : 'thread-row'}
        onPointerDown={(e) => {
          longRef.current = false
          start.current = { x: e.clientX, y: e.clientY }
          cancel()
          timer.current = window.setTimeout(long, LONG_PRESS_MS)
        }}
        onPointerMove={(e) => {
          const s = start.current
          if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 10) cancel()
        }}
        onPointerUp={cancel}
        onPointerCancel={cancel}
        onPointerLeave={cancel}
        onContextMenu={(e) => {
          e.preventDefault()
          if (!longRef.current) long()
        }}
        onClick={(e) => {
          // The press that opened the menu must not also open the thread.
          if (longRef.current) {
            e.preventDefault()
            longRef.current = false
          }
        }}
      >
        <span className={`dot ${live ? state || 'live' : 'shelved'}`} />
        <span className="title">{title}</span>
        {hasDraft(row.session) && <span className="draft-mark">Draft</span>}
        {unread && <span className="unread-dot" aria-label="New reply" />}
        {live ? (
          <span className={`badge ${state || ''}`}>{state ? STATE_LABEL[state] : 'live'}</span>
        ) : (
          <span className="when">{ago(row.at)}</span>
        )}
      </Link>
    </li>
  )
}
