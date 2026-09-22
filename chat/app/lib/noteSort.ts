/**
 * What the Organiser shows, and in what order (David, 23 Sep 2026) — the
 * list's own Show and Sort menus, chosen per device like the thread list's
 * (lib/threadSort.ts):
 *
 *  - Show: done and cancelled items (the server leaves them out unless
 *    asked, `/notes/view?done=1`); what is waiting or someday; and plain
 *    notes and the section headings they sit under. All but Done are on.
 *  - Sort: File order (the server's, the default), Date, Priority, Title,
 *    or Recently changed. Anything but File order flattens the list —
 *    a section heading only means something where the file put it — and in
 *    the agenda it orders the items inside each day, not the days.
 *
 * A roam folder's notes have no state or date: only Title and Recently
 * changed move them, and the filters leave them alone.
 */
import { isHeading, type NoteHeading, type NoteItem } from '../api/notes'

export type NoteSort = 'file' | 'date' | 'priority' | 'title' | 'changed'

export const NOTE_SORTS: NoteSort[] = ['file', 'date', 'priority', 'title', 'changed']
export const NOTE_SORT_LABEL: Record<NoteSort, string> = {
  file: 'File order',
  date: 'Date',
  priority: 'Priority',
  title: 'Title',
  changed: 'Recently changed'
}

/** Each key is one line of the Show menu; true means "in the list". */
export interface NoteShow {
  done: boolean
  waiting: boolean
  plain: boolean
}

export type NoteShowKey = keyof NoteShow

export const NOTE_SHOWS: NoteShowKey[] = ['done', 'waiting', 'plain']
export const NOTE_SHOW_LABEL: Record<NoteShowKey, string> = {
  done: 'Done and cancelled',
  waiting: 'Waiting and someday',
  plain: 'Notes and sections'
}

export const DEFAULT_SHOW: NoteShow = { done: false, waiting: true, plain: true }

const SORT_KEY = 'sasonica.notes.sort'
const SHOW_KEY = 'sasonica.notes.show'

export function loadNoteSort(): NoteSort {
  try {
    const v = localStorage.getItem(SORT_KEY) as NoteSort | null
    return v && NOTE_SORTS.includes(v) ? v : 'file'
  } catch {
    return 'file'
  }
}

export function saveNoteSort(sort: NoteSort) {
  try {
    localStorage.setItem(SORT_KEY, sort)
  } catch {
    // Not kept (a private window): the choice holds for this page.
  }
}

export function loadNoteShow(): NoteShow {
  try {
    const saved = JSON.parse(localStorage.getItem(SHOW_KEY) || 'null')
    if (!saved || typeof saved !== 'object') return { ...DEFAULT_SHOW }
    const out = { ...DEFAULT_SHOW }
    for (const k of NOTE_SHOWS) if (typeof saved[k] === 'boolean') out[k] = saved[k]
    return out
  } catch {
    return { ...DEFAULT_SHOW }
  }
}

export function saveNoteShow(show: NoteShow) {
  try {
    localStorage.setItem(SHOW_KEY, JSON.stringify(show))
  } catch {
    // As above.
  }
}

const DONE_STATES = new Set(['DONE', 'CANCELLED', 'CANCELED'])
const LATER_STATES = new Set(['WAITING', 'SOMEDAY'])

/** True while nothing has been changed — the chip stays a plain "Show". */
export function isDefaultShow(show: NoteShow): boolean {
  return NOTE_SHOWS.every((k) => show[k] === DEFAULT_SHOW[k])
}

/** How many lines of the Show menu are on — what the chip counts. */
export function shownCount(show: NoteShow): number {
  return NOTE_SHOWS.filter((k) => show[k]).length
}

/** The items the Show menu leaves in. A folder's notes always stay. */
export function showNotes(items: NoteItem[], show: NoteShow): NoteItem[] {
  return items.filter((it) => {
    if (!isHeading(it)) return true
    if (DONE_STATES.has(it.state)) return show.done
    if (LATER_STATES.has(it.state)) return show.waiting
    if (!it.state) return show.plain
    return true
  })
}

const STATE_RANK: Record<string, number> = { NEXT: 0, TODO: 1, WAITING: 2, SOMEDAY: 3 }

const stateRank = (h: NoteHeading) => (DONE_STATES.has(h.state) ? 5 : h.state in STATE_RANK ? STATE_RANK[h.state] : 4)
const dateOf = (h: NoteHeading) => h.deadline || h.scheduled || h.date || ''
const priorityOf = (h: NoteHeading) => h.priority || 'Z'
const titleOf = (it: NoteItem) => it.title.toLocaleLowerCase()

/** True where a heading's place in the file still means something. */
export const keepsSections = (sort: NoteSort) => sort === 'file'

/**
 * The items in `sort` order. File order is the server's, untouched; every
 * other order is stable, so equal items keep the order they came in.
 */
export function sortNotes(items: NoteItem[], sort: NoteSort): NoteItem[] {
  if (sort === 'file') return items
  const rows = items.map((it, i) => ({ it, i }))
  const by = (rank: (it: NoteItem) => [number, string]) =>
    rows
      .sort((a, b) => {
        const [an, as] = rank(a.it)
        const [bn, bs] = rank(b.it)
        return an - bn || as.localeCompare(bs) || a.i - b.i
      })
      .map((r) => r.it)
  if (sort === 'title') return by((it) => [0, titleOf(it)])
  if (sort === 'changed') return by((it) => (isHeading(it) ? [1, ''] : [0, String(1e12 - Math.round(it.modified))]))
  if (sort === 'date') return by((it) => (isHeading(it) && dateOf(it) ? [0, dateOf(it)] : [1, titleOf(it)]))
  // Priority: A, B, C, then the ones with none — by state within each.
  return by((it) => (isHeading(it) ? [0, `${priorityOf(it)}${stateRank(it)}`] : [1, titleOf(it)]))
}
