/**
 * Home's Agenda section: what is overdue and due today in the organiser
 * (GET /notes/view?name=agenda), each tickable where it stands (the same ○
 * and Undo as the Organiser, hooks/useMarkDone.ts), and the way into the
 * Organiser tab. Asked on open and every minute — the agenda moves by the
 * day, not the second. A server without the notes routes, or one that
 * refuses them, leaves the section out rather than showing an error on Home.
 */
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { getNoteView, isEditable, type NoteHeading } from '../api/notes'
import { useMarkDone } from '../hooks/useMarkDone'
import { noteHref, StateBadge } from '../lib/org'
import '../notes.css'

const REFRESH_MS = 60_000
/** How many rows Home shows before "N more". */
const SHOWN = 6

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function HomeAgenda() {
  const [items, setItems] = useState<NoteHeading[] | null>(null)
  const [absent, setAbsent] = useState(false)
  const [tick, setTick] = useState(0)
  const refetch = useCallback(() => setTick((n) => n + 1), [])
  const { markDone, isHidden, resetHidden, toast, dismiss } = useMarkDone(refetch)

  useEffect(() => {
    const ac = new AbortController()
    getNoteView('agenda', { signal: ac.signal })
      .then((r) => {
        setItems(r.items as NoteHeading[])
        setAbsent(false)
        resetHidden()
      })
      .catch((err) => {
        if ((err as Error)?.name !== 'AbortError') setAbsent(true)
      })
    const t = window.setTimeout(refetch, REFRESH_MS)
    return () => {
      ac.abort()
      window.clearTimeout(t)
    }
  }, [tick, refetch, resetHidden])

  if (absent || !items) return null
  const today = todayIso()
  const due = items.filter((h) => !isHidden(h) && (h.overdue || (h.date || '') <= today))
  const later = items.filter((h) => !isHidden(h) && !h.overdue && (h.date || '') > today).length
  const more = Math.max(0, due.length - SHOWN)

  return (
    <section className="dash-section dash-agenda" aria-labelledby="dash-agenda-h">
      <h2 id="dash-agenda-h">
        Agenda
        {due.length > 0 && <span className="dash-count">{due.length}</span>}
      </h2>
      {due.length === 0 && <p className="agenda-empty">Nothing due today{later ? ` · ${later} later this week` : ''}.</p>}
      {due.length > 0 && (
        <ul className="notes">
          {due.slice(0, SHOWN).map((h) => {
            const doable = !!h.state && h.state !== 'DONE' && h.state !== 'CANCELLED' && isEditable(h.path)
            return (
              <li key={`${h.path}:${h.at}`} className="note-item">
                {doable ? (
                  <button className="done-key" onClick={() => void markDone(h)} title="Mark done" aria-label={`Mark done: ${h.title}`}>
                    ○
                  </button>
                ) : (
                  <span className="done-key" aria-hidden />
                )}
                <Link className="note-row" to={noteHref(h.path, h.at)}>
                  <StateBadge state={h.state} />
                  <span className="title">{h.title}</span>
                  <span className={h.overdue ? 'agenda-when overdue' : 'agenda-when'}>{h.overdue ? 'overdue' : 'today'}</span>
                </Link>
              </li>
            )
          })}
        </ul>
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
      <Link className="all-threads open-organiser" to="/organiser" state={{ fromHome: true }}>
        {more ? `${more} more in the organiser →` : 'Open the organiser →'}
      </Link>
    </section>
  )
}
