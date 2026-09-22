/**
 * The thread list's order (David, 22 Sep 2026), chosen per device:
 *
 *  - Smart (the default): what needs you, then what is working, then the
 *    rest, most recent first — pinned threads on top within each group;
 *  - Most recent: newest first, nothing else;
 *  - By project: grouped under the project's name (§6.1 `project`; "Other"
 *    when a row has none), groups ordered by their newest thread, newest
 *    first within.
 *
 * The Archived section is sorted the same way. Recency: a shelved row's
 * `at`; a live row is happening now (its recap's time breaks ties, then the
 * server's order, which puts live first).
 */
import type { SessionRow, SessionState } from '../api/types'

export type ThreadSort = 'smart' | 'recent' | 'project'

export const SORT_LABEL: Record<ThreadSort, string> = { smart: 'Smart', recent: 'Most recent', project: 'By project' }
export const SORTS: ThreadSort[] = ['smart', 'recent', 'project']
export const OTHER_PROJECT = 'Other'

const KEY = 'sasonica.chat.threadSort'

export function loadThreadSort(): ThreadSort {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'recent' || v === 'project' ? v : 'smart'
  } catch {
    return 'smart'
  }
}
export function saveThreadSort(sort: ThreadSort) {
  try {
    localStorage.setItem(KEY, sort)
  } catch {
    // Not kept (a private window): the choice holds for this page.
  }
}

type States = Record<string, SessionState | undefined>

function recency(row: SessionRow, nowS: number): [number, number] {
  if (row.live) return [nowS, row.recap?.at || 0]
  return [row.at || row.rested?.at || row.recap?.at || 0, row.recap?.at || 0]
}

function byRecent(rows: SessionRow[], nowS: number) {
  const idx = new Map(rows.map((r, i) => [r.session, i]))
  return (a: SessionRow, b: SessionRow) => {
    const [a1, a2] = recency(a, nowS)
    const [b1, b2] = recency(b, nowS)
    return b1 - a1 || b2 - a2 || idx.get(a.session)! - idx.get(b.session)!
  }
}

function group(row: SessionRow, states: States): number {
  const st = row.live ? states[row.session] : undefined
  return st === 'approval' ? 0 : st === 'working' ? 1 : 2
}

export const projectOf = (row: SessionRow): string => (row.project || '').trim() || OTHER_PROJECT

export type ListEntry = { kind: 'row'; row: SessionRow } | { kind: 'head'; name: string; count: number }

/** The rows in `sort` order; By project interleaves the group headings. */
export function sortThreads(rows: SessionRow[], sort: ThreadSort, states: States, nowS = Date.now() / 1000): ListEntry[] {
  const recent = byRecent(rows, nowS)
  if (sort === 'recent') return [...rows].sort(recent).map((row) => ({ kind: 'row', row }))
  if (sort === 'smart') {
    return [...rows]
      .sort((a, b) => group(a, states) - group(b, states) || Number(!!b.pinned) - Number(!!a.pinned) || recent(a, b))
      .map((row) => ({ kind: 'row', row }))
  }
  const groups = new Map<string, SessionRow[]>()
  for (const r of [...rows].sort(recent)) {
    const p = projectOf(r)
    if (!groups.has(p)) groups.set(p, [])
    groups.get(p)!.push(r)
  }
  // Groups in the order of their newest thread (the map's insertion order,
  // since the rows went in newest first); "Other" last.
  const names = [...groups.keys()].sort((a, b) => Number(a === OTHER_PROJECT) - Number(b === OTHER_PROJECT))
  const out: ListEntry[] = []
  for (const name of names) {
    const g = groups.get(name)!
    out.push({ kind: 'head', name, count: g.length })
    for (const row of g) out.push({ kind: 'row', row })
  }
  return out
}
