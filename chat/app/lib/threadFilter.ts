/**
 * Which threads the list shows (David, 23 Sep 2026), chosen per device like
 * the sort (lib/threadSort.ts):
 *
 *  - Active (the default): every thread not archived, with the archived ones
 *    folded into a section at the foot;
 *  - Live: running now; Closed: not running; both leave archived ones out;
 *  - Archived: only those, unfolded — every one, since the server lists all
 *    archived rows whatever their age (§6.1);
 *  - Everything: one list, archived ones marked.
 *
 * And, separately, one project (§6.1 `project`, "Other" for none) or all.
 */
import type { SessionRow } from '../api/types'
import { OTHER_PROJECT, projectOf } from './threadSort'

export type ThreadShow = 'active' | 'live' | 'closed' | 'archived' | 'all'

export const SHOW_LABEL: Record<ThreadShow, string> = { active: 'Active', live: 'Live', closed: 'Closed', archived: 'Archived', all: 'Everything' }
export const SHOWS: ThreadShow[] = ['active', 'live', 'closed', 'archived', 'all']

export type ThreadFilter = { show: ThreadShow; project: string | null }
export const DEFAULT_FILTER: ThreadFilter = { show: 'active', project: null }

const KEY = 'sasonica.chat.threadFilter'

export function loadThreadFilter(): ThreadFilter {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null')
    return {
      show: SHOWS.includes(v?.show) ? v.show : 'active',
      project: typeof v?.project === 'string' && v.project ? v.project : null
    }
  } catch {
    return DEFAULT_FILTER
  }
}
export function saveThreadFilter(f: ThreadFilter) {
  try {
    localStorage.setItem(KEY, JSON.stringify(f))
  } catch {
    // Not kept (a private window): the choice holds for this page.
  }
}

/** The button's words: "Active", "Archived · sasonica". */
export function filterLabel(f: ThreadFilter): string {
  return f.project ? `${SHOW_LABEL[f.show]} · ${f.project}` : SHOW_LABEL[f.show]
}

/**
 * Split the rows: `main` is the list, `folded` the Archived section at its
 * foot (only under Active). `archived` and `live` say what a row is here,
 * with this app's own not-yet-confirmed archive or exit applied.
 */
export function filterThreads(
  rows: SessionRow[],
  f: ThreadFilter,
  archived: (row: SessionRow) => boolean,
  live: (row: SessionRow) => boolean
): { main: SessionRow[]; folded: SessionRow[] } {
  const main: SessionRow[] = []
  const folded: SessionRow[] = []
  for (const row of rows) {
    if (f.project && projectOf(row) !== f.project) continue
    const a = archived(row)
    if (f.show === 'active') (a ? folded : main).push(row)
    else if (f.show === 'all' || (f.show === 'archived' ? a : !a && live(row) === (f.show === 'live'))) main.push(row)
  }
  return { main, folded }
}

/** The projects the menu offers: every one the rows name, by name, "Other" last. */
export function projectsOf(rows: SessionRow[]): string[] {
  const names = [...new Set(rows.map(projectOf))]
  return names.sort((a, b) => Number(a === OTHER_PROJECT) - Number(b === OTHER_PROJECT) || a.localeCompare(b))
}
