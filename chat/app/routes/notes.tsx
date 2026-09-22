/**
 * The Notes tab: the server's Org tree (server-contract.md §6.10).
 *
 * A strip of views across the top (Agenda, the GTD files, the roam folders),
 * the chosen one's headings or notes below, and a capture box at the foot
 * that appends to the inbox. The search key swaps the list for a search of
 * the notes and of the memory store, side by side. The last view is
 * remembered per device; everything else is asked of the server each time.
 *
 * No notes on this server yet (no inbox view) → the setup checklist.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate } from 'react-router'
import { hasCredential } from '../api/auth'
import { ApiError } from '../api'
import {
  captureNote,
  getNoteView,
  getNoteViews,
  isHeading,
  searchNotes,
  type CaptureKind,
  type NoteHeading,
  type NoteItem,
  type NoteView,
  type SearchResult
} from '../api/notes'
import { noteHref, StateBadge } from '../lib/org'
import '../notes.css'

const VIEW_KEY = 'sasonica.notes.view'

function savedView(): string {
  try {
    return window.localStorage.getItem(VIEW_KEY) || 'agenda'
  } catch {
    return 'agenda'
  }
}

function saveView(name: string) {
  try {
    window.localStorage.setItem(VIEW_KEY, name)
  } catch {
    // Not remembered; the agenda opens next time.
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function ago(at: number): string {
  const s = Date.now() / 1000 - at
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m`
  if (s < 86400) return `${Math.round(s / 3600)}h`
  return `${Math.round(s / 86400)}d`
}

/** "Today", "Tomorrow", "Thu 24 Sep" — for the agenda's date groups. */
function dayLabel(date: string): string {
  const today = new Date()
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  if (date === iso(today)) return 'Today'
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)
  if (date === iso(tomorrow)) return 'Tomorrow'
  try {
    return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
  } catch {
    return date
  }
}

export default function Notes() {
  if (!hasCredential()) return <Navigate to="/pairing" replace />
  return <NotesPage />
}

function NotesPage() {
  const [views, setViews] = useState<NoteView[] | null>(null)
  const [view, setView] = useState(savedView)
  const [items, setItems] = useState<NoteItem[] | null>(null)
  const [error, setError] = useState('')
  const [searching, setSearching] = useState(false)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    const ac = new AbortController()
    getNoteViews(ac.signal)
      .then((r) => setViews(r.views))
      .catch((err) => {
        if ((err as Error)?.name !== 'AbortError') setError(message(err))
      })
    return () => ac.abort()
  }, [reload])

  // A remembered view the server no longer has falls back to the agenda.
  const current = views && !views.some((v) => v.name === view) ? 'agenda' : view

  useEffect(() => {
    if (!views) return
    const ac = new AbortController()
    setItems(null)
    getNoteView(current, ac.signal)
      .then((r) => {
        setItems(r.items)
        setError('')
      })
      .catch((err) => {
        if ((err as Error)?.name !== 'AbortError') setError(message(err))
      })
    return () => ac.abort()
  }, [views, current, reload])

  const choose = (name: string) => {
    setView(name)
    saveView(name)
  }

  const unset = views !== null && !views.some((v) => v.name === 'inbox')

  return (
    <div className="page notes-page">
      <header className="bar">
        <Link className="icon" to="/" title="Threads">
          ←
        </Link>
        <h1>Notes</h1>
        <button className="icon" onClick={() => setSearching((s) => !s)} title={searching ? 'Close search' : 'Search'} aria-pressed={searching}>
          {searching ? '✕' : '⌕'}
        </button>
        <Link className="icon" to="/notebook/setup" title="Set up notes">
          ⚙
        </Link>
      </header>

      {error && <p className="notice error">{error}</p>}

      {unset ? (
        <div className="notes-empty">
          <p>There are no notes on this server yet.</p>
          <Link className="notes-button primary" to="/notebook/setup">
            Set up notes
          </Link>
        </div>
      ) : searching ? (
        <Search />
      ) : (
        <>
          <nav className="note-views" aria-label="Views">
            {(views || []).map((v) => (
              <button key={v.name} className={v.name === current ? 'note-view on' : 'note-view'} onClick={() => choose(v.name)}>
                {v.label}
                {v.count ? <span className="count">{v.count}</span> : null}
              </button>
            ))}
          </nav>
          <div className="note-list">
            {!items && !error && <p className="notice">Loading…</p>}
            {items && items.length === 0 && <p className="notice">Nothing here.</p>}
            {items && (current === 'agenda' ? <Agenda items={items as NoteHeading[]} /> : <Items items={items} />)}
          </div>
        </>
      )}

      {!unset && views && <Capture onSaved={() => (current === 'inbox' ? setReload((n) => n + 1) : undefined)} />}
    </div>
  )
}

function HeadingRow({ h, inAgenda, section }: { h: NoteHeading; inAgenda?: boolean; section?: boolean }) {
  // A section: the inbox's urgency groups, stateless headings with others under them.
  if (section) {
    return (
      <li className={`note-section lvl${Math.min(h.level, 3)}`}>
        <Link to={noteHref(h.path, h.at)}>{h.title}</Link>
      </li>
    )
  }
  const when = h.deadline ? `due ${h.deadline.slice(5)}` : h.scheduled ? h.scheduled.slice(5) : ''
  return (
    <li>
      <Link className={`note-row lvl${Math.min(h.level, 3)}${h.overdue ? ' overdue' : ''}`} to={noteHref(h.path, h.at)}>
        <StateBadge state={h.state} />
        <span className="title">{h.title}</span>
        {inAgenda ? <span className="when">{h.path.replace(/\.org$/, '')}</span> : when && <span className="when">{when}</span>}
      </Link>
    </li>
  )
}

/** A stateless heading with a deeper one straight after it groups what follows;
 * one without (a captured note) is an item like any other. */
function isSection(h: NoteHeading, next: NoteItem | undefined): boolean {
  return !!next && isHeading(next) && next.level > h.level
}

function Items({ items }: { items: NoteItem[] }) {
  return (
    <ul className="notes">
      {items.map((it, i) =>
        isHeading(it) ? (
          <HeadingRow key={`${it.path}:${it.at}`} h={it} section={!it.state && isSection(it, items[i + 1])} />
        ) : (
          <li key={it.path}>
            <Link className="note-row" to={noteHref(it.path)}>
              <span className="title">{it.title}</span>
              <span className="when">{ago(it.modified)}</span>
            </Link>
          </li>
        )
      )}
    </ul>
  )
}

function Agenda({ items }: { items: NoteHeading[] }) {
  const groups = useMemo(() => {
    const out: { label: string; items: NoteHeading[] }[] = []
    const overdue = items.filter((h) => h.overdue)
    if (overdue.length) out.push({ label: 'Overdue', items: overdue })
    for (const h of items.filter((x) => !x.overdue)) {
      const label = dayLabel(h.date || '')
      const g = out[out.length - 1]
      if (g && g.label === label) g.items.push(h)
      else out.push({ label, items: [h] })
    }
    return out
  }, [items])
  return (
    <>
      {groups.map((g) => (
        <section key={g.label} className="agenda-day">
          <h2 className={g.label === 'Overdue' ? 'overdue' : undefined}>{g.label}</h2>
          <ul className="notes">
            {g.items.map((h) => (
              <HeadingRow key={`${h.path}:${h.at}`} h={h} inAgenda />
            ))}
          </ul>
        </section>
      ))}
    </>
  )
}

/** Notes and memories, searched as you type (after a pause). */
function Search() {
  const [text, setText] = useState('')
  const [all, setAll] = useState(false)
  const [result, setResult] = useState<SearchResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => input.current?.focus(), [])

  useEffect(() => {
    const q = text.trim()
    if (q.length < 2) {
      setResult(null)
      return
    }
    const ac = new AbortController()
    const t = window.setTimeout(() => {
      setBusy(true)
      searchNotes(q, { all, signal: ac.signal })
        .then((r) => {
          setResult(r)
          setError('')
        })
        .catch((err) => {
          if ((err as Error)?.name !== 'AbortError') setError(message(err))
        })
        .finally(() => setBusy(false))
    }, 350)
    return () => {
      window.clearTimeout(t)
      ac.abort()
    }
  }, [text, all])

  return (
    <div className="note-list note-search">
      <div className="search-box">
        <input ref={input} type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Search notes and memory" aria-label="Search" />
        <label className="search-all">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> agent notes too
        </label>
      </div>
      {error && <p className="notice error">{error}</p>}
      {busy && !result && <p className="notice">Searching…</p>}
      {result && (
        <>
          <h2 className="search-head">Notes</h2>
          {result.notes.length === 0 && <p className="notice">No notes say that.</p>}
          <ul className="notes">
            {result.notes.map((h) => (
              <li key={`${h.path}:${h.line}`}>
                <Link className="note-hit" to={noteHref(h.path)}>
                  <span className="where">{h.path.replace(/^roam\//, '').replace(/\.org$/, '')}</span>
                  <span className="snippet">{h.text.replace(/^\*+\s+/, '')}</span>
                </Link>
              </li>
            ))}
          </ul>
          <h2 className="search-head">From memory</h2>
          {result.memories.length === 0 && <p className="notice">Nothing remembered about that (or the memory store is away).</p>}
          <ul className="notes">
            {result.memories.map((m) => (
              <li key={m.id} className="memory-hit">
                {m.text}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

/** The foot: a line to the inbox, as a to-do or a plain note. */
function Capture({ onSaved }: { onSaved: () => void }) {
  const [text, setText] = useState('')
  const [kind, setKind] = useState<CaptureKind>('todo')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ text: string; failed?: boolean } | null>(null)

  const save = async () => {
    const t = text.trim()
    if (!t || busy) return
    setBusy(true)
    setNote(null)
    try {
      await captureNote(t, kind)
      setText('')
      setNote({ text: kind === 'todo' ? 'Added to the inbox.' : 'Noted in the inbox.' })
      onSaved()
    } catch (err) {
      setNote({ text: err instanceof ApiError ? err.message : message(err), failed: true })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="capture"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      {note && <p className={note.failed ? 'capture-note error' : 'capture-note'}>{note.text}</p>}
      <div className="capture-row">
        <div className="capture-kind" role="radiogroup" aria-label="Kind">
          {(['todo', 'note'] as const).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} className={kind === k ? 'on' : undefined} onClick={() => setKind(k)}>
              {k === 'todo' ? 'To-do' : 'Note'}
            </button>
          ))}
        </div>
        <textarea
          value={text}
          rows={1}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // As in the composer: Enter is a new line, Ctrl/⌘+Enter saves.
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              void save()
            }
          }}
          placeholder={kind === 'todo' ? 'Something to do…' : 'A thought to keep…'}
          aria-label="Capture"
        />
        <button className="notes-button primary" type="submit" disabled={!text.trim() || busy}>
          {busy ? '…' : 'Save'}
        </button>
      </div>
    </form>
  )
}
