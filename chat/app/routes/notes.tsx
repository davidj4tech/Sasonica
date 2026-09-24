/**
 * The Organiser tab: the server's Org tree (server-contract.md §6.10) — the
 * third tab beside Home and Threads, whose Agenda section links here too.
 *
 * A strip of views across the top (Agenda, the GTD files, the roam folders),
 * a Show and a Sort menu under it (lib/noteSort.ts), the chosen view's
 * headings or notes below, and a capture box at the foot
 * that appends to the inbox. The search key swaps the list for a search of
 * the notes and of the memory store, side by side. The last view is
 * remembered per device; everything else is asked of the server each time.
 *
 * No notes on this server yet (no inbox view) → the setup checklist.
 */
import { Mark } from '../components/Mark'
import { Popover } from '../components/Popover'
import { HomeTabs } from '../components/Nav'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  type CaptureTemplate,
  type NoteHeading,
  type NoteItem,
  type NoteView,
  type SearchResult
} from '../api/notes'
import { noteHref, StateBadge } from '../lib/org'
import { useMarkDone } from '../hooks/useMarkDone'
import { CaptureSheet } from '../components/CaptureSheet'
import { canMarkDone, notesMeta, setNotesMeta, useNotesMeta } from '../lib/notesMeta'
import {
  isDefaultShow,
  keepsSections,
  loadNoteShow,
  loadNoteSort,
  NOTE_SHOW_LABEL,
  NOTE_SHOWS,
  NOTE_SORT_LABEL,
  NOTE_SORTS,
  saveNoteShow,
  saveNoteSort,
  shownCount,
  showNotes,
  sortNotes,
  type NoteShow,
  type NoteSort
} from '../lib/noteSort'
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
  const [sort, setSortState] = useState<NoteSort>(loadNoteSort)
  const [show, setShowState] = useState<NoteShow>(loadNoteShow)
  const [menu, setMenu] = useState<'' | 'show' | 'sort'>('')
  const showButton = useRef<HTMLButtonElement>(null)
  const sortButton = useRef<HTMLButtonElement>(null)
  const [reload, setReload] = useState(0)
  const refetch = useCallback(() => setReload((n) => n + 1), [])
  const { markDone, isHidden, resetHidden, toast, dismiss } = useMarkDone(refetch)

  useEffect(() => {
    const ac = new AbortController()
    getNoteViews(ac.signal)
      .then((r) => {
        setNotesMeta(r)
        setViews(r.views)
      })
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
    getNoteView(current, { done: show.done, signal: ac.signal })
      .then((r) => {
        setItems(r.items)
        resetHidden()
        setError('')
      })
      .catch((err) => {
        if ((err as Error)?.name !== 'AbortError') setError(message(err))
      })
    return () => ac.abort()
  }, [views, current, reload, show.done])

  const setSort = (next: NoteSort) => {
    setMenu('')
    setSortState(next)
    saveNoteSort(next)
  }
  // Done and cancelled items are the server's to send or withhold, so that
  // one line of the Show menu asks the view again (/notes/view?done=1).
  const toggle = (key: keyof NoteShow) => {
    const next = { ...show, [key]: !show[key] }
    setShowState(next)
    saveNoteShow(next)
  }

  const choose = (name: string) => {
    setView(name)
    saveView(name)
  }

  // What Show leaves in; Sort is applied per list (the agenda sorts inside
  // each day, so its groups stay in date order).
  const shown = useMemo(() => (items ? showNotes(items, show) : null), [items, show])
  const quiet = isDefaultShow(show)

  // Not set up: the server lists no capture file (an older one: no inbox view).
  const meta = useNotesMeta()
  const unset = views !== null && !views.some((v) => v.path === meta.captureFile || v.name === 'inbox')

  return (
    <div className="page notes-page">
      <header className="bar">
        <h1 className="wordmark">
          <Mark size={28} />
          Sasonica
        </h1>
        <button className="icon" onClick={() => setSearching((s) => !s)} title={searching ? 'Close search' : 'Search'} aria-pressed={searching}>
          {searching ? '✕' : '⌕'}
        </button>
        <Link className="icon" to="/settings" title="Settings">
          ⚙
        </Link>
      </header>
      <HomeTabs current="organiser" />

      {error && <p className="notice error">{error}</p>}

      {unset ? (
        <div className="notes-empty">
          <p>The organiser has nothing to show on this server yet.</p>
          <Link className="notes-button primary" to="/organiser/setup">
            Set up the organiser
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
            <Link className="note-view setup-chip" to="/organiser/setup" title="Set up the organiser">
              Setup
            </Link>
          </nav>
          <div className="list-tools">
            <button ref={showButton} type="button" className="sort-button" aria-haspopup="menu" aria-expanded={menu === 'show'} onClick={() => setMenu((m) => (m === 'show' ? '' : 'show'))}>
              Show{quiet ? '' : ` (${shownCount(show)}/${NOTE_SHOWS.length})`} <span aria-hidden="true">▾</span>
            </button>
            <button ref={sortButton} type="button" className="sort-button" aria-haspopup="menu" aria-expanded={menu === 'sort'} onClick={() => setMenu((m) => (m === 'sort' ? '' : 'sort'))}>
              Sort: {NOTE_SORT_LABEL[sort]} <span aria-hidden="true">▾</span>
            </button>
          </div>
          {menu === 'show' && (
            <Popover anchor={showButton} label="Show in the organiser" align="right" className="sort-menu" onClose={() => setMenu('')}>
              {NOTE_SHOWS.map((k) => (
                <button key={k} role="menuitemcheckbox" aria-checked={show[k]} className={show[k] ? 'on' : ''} onClick={() => toggle(k)}>
                  <span className="mark" aria-hidden="true">
                    {show[k] ? '✓' : ''}
                  </span>
                  {NOTE_SHOW_LABEL[k]}
                </button>
              ))}
            </Popover>
          )}
          {menu === 'sort' && (
            <Popover anchor={sortButton} label="Sort the organiser" align="right" className="sort-menu" onClose={() => setMenu('')}>
              {NOTE_SORTS.map((k) => (
                <button key={k} role="menuitemradio" aria-checked={sort === k} className={sort === k ? 'on' : ''} onClick={() => setSort(k)}>
                  <span className="mark" aria-hidden="true">
                    {sort === k ? '✓' : ''}
                  </span>
                  {NOTE_SORT_LABEL[k]}
                </button>
              ))}
            </Popover>
          )}
          <div className="note-list">
            {!items && !error && <p className="notice">Loading…</p>}
            {items && items.length === 0 && <p className="notice">Nothing here.</p>}
            {items && shown && shown.length === 0 && items.length > 0 && <p className="notice">Everything here is hidden by Show.</p>}
            {shown &&
              (current === 'agenda' ? (
                <Agenda items={shown as NoteHeading[]} sort={sort} isHidden={isHidden} onDone={markDone} />
              ) : (
                <Items items={sortNotes(shown, sort)} flat={!keepsSections(sort)} isHidden={isHidden} onDone={markDone} />
              ))}
          </div>
        </>
      )}

      {toast && (
        <div className={toast.failed ? 'note-toast error' : 'note-toast'} role="status">
          <span className="grow">{toast.text}</span>
          {toast.undo && (
            <button className="notes-button" onClick={toast.undo}>
              Undo
            </button>
          )}
          <button className="icon" onClick={dismiss} title="Dismiss">
            ✕
          </button>
        </div>
      )}
      {!unset && views && <Capture onSaved={() => (current === 'inbox' ? setReload((n) => n + 1) : undefined)} />}
    </div>
  )
}

function HeadingRow({ h, inAgenda, section, onDone }: { h: NoteHeading; inAgenda?: boolean; section?: boolean; onDone?: (h: NoteHeading) => void }) {
  // A section: the inbox's urgency groups, stateless headings with others under them.
  if (section) {
    return (
      <li className={`note-section lvl${Math.min(h.level, 3)}`}>
        <Link to={noteHref(h.path, h.at)}>{h.title}</Link>
      </li>
    )
  }
  const when = h.deadline ? `due ${h.deadline.slice(5)}` : h.scheduled ? h.scheduled.slice(5) : ''
  const doable = !!onDone && canMarkDone(notesMeta(), h)
  return (
    <li className="note-item">
      {doable ? (
        <button className="done-key" onClick={() => onDone(h)} title="Mark done" aria-label={`Mark done: ${h.title}`}>
          ○
        </button>
      ) : (
        <span className="done-key" aria-hidden />
      )}
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

function Items({ items, flat, isHidden, onDone }: { items: NoteItem[]; flat?: boolean; isHidden: (h: NoteHeading) => boolean; onDone: (h: NoteHeading) => void }) {
  return (
    <ul className="notes">
      {items.map((it, i) =>
        isHeading(it) ? (
          isHidden(it) ? null : <HeadingRow key={`${it.path}:${it.at}`} h={it} section={!flat && !it.state && isSection(it, items[i + 1])} onDone={onDone} />
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

function Agenda({ items: all, sort, isHidden, onDone }: { items: NoteHeading[]; sort: NoteSort; isHidden: (h: NoteHeading) => boolean; onDone: (h: NoteHeading) => void }) {
  const items = all.filter((h) => !isHidden(h))
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
    return out.map((g) => ({ ...g, items: sortNotes(g.items, sort) as NoteHeading[] }))
  }, [items, sort])
  return (
    <>
      {groups.map((g) => (
        <section key={g.label} className="agenda-day">
          <h2 className={g.label === 'Overdue' ? 'overdue' : undefined}>{g.label}</h2>
          <ul className="notes">
            {g.items.map((h) => (
              <HeadingRow key={`${h.path}:${h.at}`} h={h} inAgenda onDone={onDone} />
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
  // A capture template (More…): its prompts are drawn above the box.
  const [template, setTemplate] = useState<CaptureTemplate | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ text: string; failed?: boolean } | null>(null)
  const meta = useNotesMeta()

  const choose = (k: CaptureKind) => {
    setKind(k)
    setTemplate(null)
  }
  const pick = (t: CaptureTemplate) => {
    setPicking(false)
    setKind(t.name)
    setTemplate(t)
    setValues(Object.fromEntries(t.fields.filter((f) => f.type === 'choice').map((f) => [f.id, f.options?.[0] || ''])))
  }
  const ready = (template ? !template.needs_text || !!text.trim() : !!text.trim()) && (template?.fields || []).every((f) => !!values[f.id]?.trim())

  const save = async () => {
    const t = text.trim()
    if (!ready || busy) return
    setBusy(true)
    setNote(null)
    try {
      const r = await captureNote(t, kind, template ? values : undefined)
      setText('')
      setNote({ text: template ? `Filed in ${r.path.replace(/\.org$/, '')}.` : kind === 'todo' ? 'Added to the inbox.' : 'Noted in the inbox.' })
      // Back to a plain to-do, so the next quick capture is not filed by the last template.
      choose('todo')
      setValues({})
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
      {template && template.fields.length > 0 && (
        <div className="capture-fields">
          {template.fields.map((f) => (
            <label key={f.id}>
              <span>{f.label}</span>
              {f.type === 'choice' ? (
                <select value={values[f.id] || ''} onChange={(e) => setValues({ ...values, [f.id]: e.target.value })}>
                  {(f.options || []).map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              ) : (
                <input
                  type={f.type === 'date' ? 'date' : f.type === 'datetime' ? 'datetime-local' : 'text'}
                  value={values[f.id] || ''}
                  onChange={(e) => setValues({ ...values, [f.id]: e.target.value })}
                  required
                />
              )}
            </label>
          ))}
        </div>
      )}
      <div className="capture-row">
        <div className="capture-kind" role="radiogroup" aria-label="Kind">
          {(['todo', 'note'] as const).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} className={kind === k ? 'on' : undefined} onClick={() => choose(k)}>
              {k === 'todo' ? 'To-do' : 'Note'}
            </button>
          ))}
          {meta.captureKinds.length > 0 && (
            <button type="button" role="radio" aria-checked={!!template} className={template ? 'on' : undefined} onClick={() => setPicking(true)} title={template ? template.label : 'More kinds'}>
              {template ? template.label.split(/[ (/]/, 1)[0] : 'More…'}
            </button>
          )}
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
          placeholder={template ? `${template.label}${template.needs_text ? '…' : ' (anything else)'}` : kind === 'todo' ? 'Something to do…' : 'A thought to keep…'}
          aria-label="Capture"
        />
        <button className="notes-button primary" type="submit" disabled={!ready || busy}>
          {busy ? '…' : 'Save'}
        </button>
      </div>
      {picking && <CaptureSheet kinds={meta.captureKinds} onPick={pick} onClose={() => setPicking(false)} />}
    </form>
  )
}
