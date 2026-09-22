/**
 * The thread list: /targets.sessions (live first, with a live badge) and
 * what each live one is doing from /sessions/state, polled every 5 s.
 * Paints from the last saved answer; once the fresh one lands, the top few
 * threads are warmed in the background (hooks/usePrefetch.ts).
 */
import { useRef, useState } from 'react'
import { Link, Navigate } from 'react-router'
import { RenameSheet } from '../components/RenameSheet'
import { useAutoRename, useRename } from '../hooks/useRename'
import { useTitle } from '../lib/titles'
import { hasDraft } from '../lib/drafts'
import { useUnread } from '../lib/arrivals'
import { SpeechBar } from '../components/SpeechBar'
import { hasCredential } from '../api/auth'
import type { SessionRow, SessionState } from '../api/types'
import { usePrefetch } from '../hooks/usePrefetch'
import { useSessionStates, useTargets } from '../hooks/useThreads'
import { Mark } from '../components/Mark'
import { HomeTabs } from '../components/Nav'
import { SessionMenuSheet, type SessionAction } from '../components/SessionSheets'
import { useSessionActions } from '../hooks/useSessionActions'
import { archivedOf, endedHere, useSessionFlags } from '../lib/sessionFlags'
import { Popover } from '../components/Popover'
import {
  loadClosedGroups,
  loadThreadSort,
  openEntries,
  saveClosedGroups,
  saveThreadSort,
  SORT_LABEL,
  SORTS,
  sortThreads,
  type ListEntry,
  type ThreadSort
} from '../lib/threadSort'
import { DEFAULT_FILTER, filterLabel, filterThreads, loadThreadFilter, projectsOf, saveThreadFilter, SHOW_LABEL, SHOWS, type ThreadFilter } from '../lib/threadFilter'

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
  const [showArchived, setShowArchived] = useState(false)
  const [note, setNote] = useState<{ text: string; failed?: boolean } | null>(null)
  const [sort, setSortState] = useState<ThreadSort>(() => loadThreadSort())
  const [sortOpen, setSortOpen] = useState(false)
  const sortButton = useRef<HTMLButtonElement>(null)
  const setSort = (next: ThreadSort) => {
    setSortOpen(false)
    setSortState(next)
    saveThreadSort(next)
  }
  // By project: the headings fold (the choice is kept per device), and a
  // folded group's rows leave the list.
  const [closed, setClosedState] = useState<Set<string>>(() => loadClosedGroups())
  const toggleGroup = (name: string) => {
    setClosedState((prev) => {
      const next = new Set(prev)
      if (!next.delete(name)) next.add(name)
      saveClosedGroups(next)
      return next
    })
  }
  const [filter, setFilterState] = useState<ThreadFilter>(() => loadThreadFilter())
  const [filterOpen, setFilterOpen] = useState(false)
  const filterButton = useRef<HTMLButtonElement>(null)
  const setFilter = (next: ThreadFilter) => {
    setFilterOpen(false)
    setFilterState(next)
    saveThreadFilter(next)
  }
  const rename = useRename()
  const autoRename = useAutoRename()
  const acts = useSessionActions()
  useSessionFlags()
  // What the filter shows (lib/threadFilter.ts). Under Active, archived
  // threads leave the main list for a folded section at its foot; this app's
  // own archive or exit shows before the server confirms it.
  const isArchived = (row: SessionRow) => archivedOf(row.session, row.archived)
  const { main, folded: archived } = filterThreads(sessions, filter, isArchived, (row) => row.live && !endedHere(row.session))
  const projects = projectsOf(sessions)
  if (filter.project && !projects.includes(filter.project)) projects.push(filter.project)
  // The chosen order (lib/threadSort.ts), the Archived section's too.
  const mainList = openEntries(sortThreads(main, sort, states), closed)
  const archivedList = openEntries(sortThreads(archived, sort, states), closed)
  const say = (r: { ok: boolean; message: string }) => setNote(r.ok ? null : { text: r.message, failed: true })
  const pick = (a: SessionAction) => {
    const m = menu
    setMenu(null)
    if (!m) return
    if (a === 'rename') setRenaming({ session: m.session, title: m.title })
    else if (a === 'auto-rename') {
      setNote({ text: 'Thinking of a name…' })
      void autoRename(m.session).then((r) => setNote(r.ok ? null : { text: r.message, failed: true }))
    } else if (a === 'exit' || a === 'exit-archive') void (a === 'exit-archive' ? acts.exitAndArchive(m.session) : acts.exit(m.session)).then(say)
    else void acts.archive(m.session, a === 'archive').then(say)
  }
  const entryOf = (e: ListEntry, where: string) =>
    e.kind === 'head' ? (
      <li key={`${where}:head:${e.name}`} className="project-head">
        <button type="button" aria-expanded={!closed.has(e.name)} onClick={() => toggleGroup(e.name)}>
          <span className="caret" aria-hidden="true">
            {closed.has(e.name) ? '▸' : '▾'}
          </span>
          <span className="project-name">{e.name}</span>
          <span className="project-count">{e.count}</span>
        </button>
      </li>
    ) : (
      rowOf(e.row)
    )
  const rowOf = (row: SessionRow) => (
    <ThreadRow
      key={row.session}
      row={row}
      state={states[row.session]}
      markArchived={filter.show === 'all' && isArchived(row)}
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
        <Link className="icon" to="/settings" title="Settings">
          ⚙
        </Link>
      </header>
      <HomeTabs current="threads" />
      <div className="list-tools">
        <button
          ref={filterButton}
          type="button"
          className={filter.show !== 'active' || filter.project ? 'filter-button on' : 'filter-button'}
          aria-haspopup="menu"
          aria-expanded={filterOpen}
          onClick={() => setFilterOpen((o) => !o)}
        >
          Show: {filterLabel(filter)} <span aria-hidden="true">▾</span>
        </button>
        <button ref={sortButton} type="button" className="sort-button" aria-haspopup="menu" aria-expanded={sortOpen} onClick={() => setSortOpen((o) => !o)}>
          Sort: {SORT_LABEL[sort]} <span aria-hidden="true">▾</span>
        </button>
      </div>
      {sortOpen && (
        <Popover anchor={sortButton} label="Sort threads" align="left" className="sort-menu" onClose={() => setSortOpen(false)}>
          {SORTS.map((k) => (
            <button key={k} role="menuitemradio" aria-checked={sort === k} className={sort === k ? 'on' : ''} onClick={() => setSort(k)}>
              <span className="mark" aria-hidden="true">
                {sort === k ? '✓' : ''}
              </span>
              {SORT_LABEL[k]}
            </button>
          ))}
        </Popover>
      )}

      {filterOpen && (
        <Popover anchor={filterButton} label="Filter threads" align="left" className="sort-menu filter-menu" onClose={() => setFilterOpen(false)}>
          {SHOWS.map((k) => (
            <button key={k} role="menuitemradio" aria-checked={filter.show === k} className={filter.show === k ? 'on' : ''} onClick={() => setFilter({ ...filter, show: k })}>
              <span className="mark" aria-hidden="true">
                {filter.show === k ? '✓' : ''}
              </span>
              {SHOW_LABEL[k]}
            </button>
          ))}
          <div className="menu-sep" role="separator" />
          {[null, ...projects].map((p) => (
            <button key={p ?? ''} role="menuitemradio" aria-checked={filter.project === p} className={filter.project === p ? 'on' : ''} onClick={() => setFilter({ ...filter, project: p })}>
              <span className="mark" aria-hidden="true">
                {filter.project === p ? '✓' : ''}
              </span>
              {p ?? 'All projects'}
            </button>
          ))}
        </Popover>
      )}

      {error && <p className="notice error">{error}</p>}
      {note && <p className={note.failed ? 'notice error' : 'notice'}>{note.text}</p>}
      {loading && !sessions.length && <p className="notice">Loading…</p>}
      {!loading && sessions.length > 0 && !main.length && !archived.length && (
        <p className="notice filter-empty">
          No {filter.show === 'all' || filter.show === 'active' ? '' : SHOW_LABEL[filter.show].toLowerCase() + ' '}threads{filter.project ? ` in ${filter.project}` : ''}.{' '}
          <button type="button" className="link" onClick={() => setFilter(DEFAULT_FILTER)}>
            Show all
          </button>
        </p>
      )}

      <ul className="threads">
        {mainList.map((e) => entryOf(e, 'main'))}
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
        {showArchived && archivedList.map((e) => entryOf(e, 'archived'))}
      </ul>

      {menu && <SessionMenuSheet title={menu.title} live={menu.live} archived={menu.archived} onPick={pick} onClose={() => setMenu(null)} />}
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
        <Link to="/new" className="fab" title="New chat" aria-label="New chat">
          <svg className="fab-plus" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" fill="none" />
          </svg>
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
function ThreadRow({
  row,
  state: polled,
  markArchived,
  onMenu
}: {
  row: SessionRow
  state: SessionState | undefined
  markArchived?: boolean
  onMenu: (title: string, live: boolean) => void
}) {
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
        <span className="title-col">
          <span className="title">{title}</span>
          {row.project && <span className="row-project">{row.project}</span>}
        </span>
        {markArchived && <span className="draft-mark archived-mark">Archived</span>}
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
