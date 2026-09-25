/**
 * A digest whose lines are items of an Organiser view (§6.17 `view`, the org
 * agenda digest's `agenda`): the view's own live rows for just those lines —
 * ○ to mark one done, the heading to open it — in the digest's order (David,
 * 25 Sep 2026: "show the agenda with just those items displayed").
 *
 * A line is matched to the heading whose title it contains (the longest,
 * so "Call Bob" does not take "Call Bob back"). The view is asked with DONE
 * headings kept, so one finished since shows as done; a line nothing matches
 * (renamed, refiled, archived) is shown as sent, struck through. A line
 * that is not an agenda item at all (the Sacred Brain alerts the producer
 * appends) is shown under the rows as it was sent.
 */
import { useCallback, useEffect, useState } from 'react'
import { getNoteView, isHeading, type NoteHeading } from '../api/notes'
import { useMarkDone } from '../hooks/useMarkDone'
import { canMarkDone, knownStates, useNotesMeta } from '../lib/notesMeta'
import { AgendaItem } from './HomeAgenda'
import '../notes.css'

type Row = { h: NoteHeading } | { gone: string }

/** An org agenda line: "category:" then a time, "Scheduled:", "Deadline:", "Sched. 2x:", "In 3 d.:" or "2 d. ago:". */
const AGENDA_LINE = /^\s*[^\s:]+:\s+(\d{1,2}:\d{2}|Scheduled:|Deadline:|Sched\.\s*\d+x:|In\s+\d+\s+d\.:|\d+\s+d\.\s+ago:)/

/** What an org agenda line says, without its category, time, "Scheduled:", keyword, priority and tags. */
export function lineTitle(line: string, states: Set<string> = knownStates()): string {
  let t = line
    .replace(/^\s*[^\s:]+:\s+/, '')
    .replace(/^\d{1,2}:\d{2}\.*\s*/, '')
    .replace(/^(Scheduled|Deadline|Sched\.\s*\d+x|In\s+\d+\s+d\.|\d+\s+d\.\s+ago):\s*/i, '')
    .replace(/\s+:[\w@#%:]+:\s*$/, '')
    .trim()
  const word = t.split(/\s+/, 1)[0]
  if (states.has(word)) t = t.slice(word.length).trim()
  return t.replace(/^\[#[A-Z0-9]\]\s*/, '')
}

export function matchLines(lines: string[], items: NoteHeading[]): Row[] {
  const byLength = [...items].sort((a, b) => b.title.length - a.title.length)
  const seen = new Set<string>()
  const rows: Row[] = []
  for (const line of lines) {
    const h = byLength.find((x) => x.title && line.includes(x.title))
    if (!h) rows.push({ gone: lineTitle(line) })
    else if (!seen.has(`${h.path}:${h.at}`)) {
      seen.add(`${h.path}:${h.at}`)
      rows.push({ h })
    }
  }
  return rows
}

export function DigestItems({ view, detail, onAbsent }: { view: string; detail: string; onAbsent: () => void }) {
  const [items, setItems] = useState<NoteHeading[] | null>(null)
  const [tick, setTick] = useState(0)
  const refetch = useCallback(() => setTick((n) => n + 1), [])
  const { markDone, toast, dismiss } = useMarkDone(refetch)
  const meta = useNotesMeta()

  useEffect(() => {
    const ac = new AbortController()
    getNoteView(view, { done: true, signal: ac.signal })
      .then((r) => setItems(r.items.filter(isHeading)))
      .catch((err) => {
        if ((err as Error)?.name !== 'AbortError') onAbsent()
      })
    return () => ac.abort()
  }, [view, tick, onAbsent])

  if (!items) return <p className="notice delayed">Loading…</p>
  const lines = detail.split('\n').filter((l) => l.trim())
  const rows = matchLines(lines.filter((l) => AGENDA_LINE.test(l)), items)
  const notes = lines.filter((l) => !AGENDA_LINE.test(l)).map((l) => l.trim())
  return (
    <>
      <ul className="notes digest-items">
        {rows.map((r, i) =>
          'h' in r ? (
            <AgendaItem key={`${r.h.path}:${r.h.at}`} h={r.h} doable={canMarkDone(meta, r.h)} markDone={markDone} when={r.h.overdue ? 'overdue' : ''} />
          ) : (
            <li key={`g${i}`} className="note-item digest-gone" title="No longer on the agenda">
              <span className="done-key" aria-hidden />
              <span className="note-row">
                <span className="title">{r.gone}</span>
              </span>
            </li>
          )
        )}
      </ul>
      {notes.length > 0 && (
        <div className="digest-notes">
          {notes.map((l, i) => (
            <p key={i}>{l}</p>
          ))}
        </div>
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
    </>
  )
}
