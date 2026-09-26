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
 * And, separately, one project (§6.1 `project`, "Other" for none) or all,
 * one harness (§6.16 — which agent holds the thread) or all, and any number
 * of states — Needs you / Working / Your turn (§6.2
 * /sessions/state). A state is something a running thread is doing, so
 * picking one leaves the shelved rows out; picking none asks nothing.
 * Speech priority is the same kind of choice (David, 25 Sep 2026): any
 * number of the four levels (§6.4), a row's own or the server's default —
 * /targets says which applies — and none ticked asks nothing.
 *
 * `older` is the one that costs a request: the server lists the last 30 days
 * of each harness's store, and `history=all` lifts that window (§6.16).
 */
import type { Harness, SessionRow, SessionState, SpeechLevel } from '../api/types'
import { OTHER_PROJECT, projectOf, projectOptions } from './threadSort'

export type ThreadShow = 'active' | 'live' | 'closed' | 'archived' | 'all'

export const SHOW_LABEL: Record<ThreadShow, string> = { active: 'Active', live: 'Live', closed: 'Closed', archived: 'Archived', all: 'Everything' }
export const SHOWS: ThreadShow[] = ['active', 'live', 'closed', 'archived', 'all']

export const STATE_FILTER_LABEL: Record<SessionState, string> = { approval: 'Needs you', working: 'Working', waiting: 'Your turn' }
export const STATE_FILTERS: SessionState[] = ['approval', 'working', 'waiting']

export const SPEECH_FILTER_LABEL: Record<SpeechLevel, string> = { interrupt: 'Interrupt', auto: 'Auto speak', normal: 'When open', quiet: 'Quiet' }
export const SPEECH_FILTERS: SpeechLevel[] = ['interrupt', 'auto', 'normal', 'quiet']

/** A row's speech level; rows from before the server said so have only `priority`. */
export const speechOf = (row: SessionRow): SpeechLevel => row.speech || (row.priority ? 'auto' : 'normal')

export const HARNESS_LABEL: Record<Harness, string> = { claude: 'Claude', codex: 'Codex', pi: 'pi', hermes: 'Hermes' }
export const HARNESSES: Harness[] = ['claude', 'codex', 'pi', 'hermes']

/** A row's agent; rows from before the server said so are Claude's. */
export const harnessOf = (row: SessionRow): Harness =>
  (HARNESSES.includes(row.harness as Harness) ? row.harness : 'claude') as Harness

export type ThreadFilter = {
  show: ThreadShow
  project: string | null
  harness: Harness | null
  states: SessionState[]
  speech: SpeechLevel[]
  older: boolean
}
export const DEFAULT_FILTER: ThreadFilter = { show: 'active', project: null, harness: null, states: [], speech: [], older: false }

const KEY = 'sasonica.chat.threadFilter'

export function loadThreadFilter(): ThreadFilter {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null')
    return {
      show: SHOWS.includes(v?.show) ? v.show : 'active',
      project: typeof v?.project === 'string' && v.project ? v.project : null,
      harness: HARNESSES.includes(v?.harness) ? v.harness : null,
      older: v?.older === true,
      states: Array.isArray(v?.states) ? STATE_FILTERS.filter((k) => v.states.includes(k)) : [],
      speech: Array.isArray(v?.speech) ? SPEECH_FILTERS.filter((k) => v.speech.includes(k)) : []
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

/** The button's words: "Active", "Archived · sasonica", "Active · Needs you, Working", "Active · Quiet speech". */
export function filterLabel(f: ThreadFilter): string {
  const parts = [SHOW_LABEL[f.show]]
  if (f.project) parts.push(f.project)
  if (f.harness) parts.push(HARNESS_LABEL[f.harness])
  if (f.older) parts.push('all time')
  if (f.states.length) parts.push(STATE_FILTERS.filter((k) => f.states.includes(k)).map((k) => STATE_FILTER_LABEL[k]).join(', '))
  if (f.speech.length) parts.push(SPEECH_FILTERS.filter((k) => f.speech.includes(k)).map((k) => SPEECH_FILTER_LABEL[k]).join(', ') + ' speech')
  return parts.join(' · ')
}

/** Nothing asked of the list but the default Show. */
export const isDefaultFilter = (f: ThreadFilter) =>
  f.show === DEFAULT_FILTER.show && !f.project && !f.harness && !f.states.length && !f.speech.length && !f.older

/**
 * Split the rows: `main` is the list, `folded` the Archived section at its
 * foot (only under Active). `archived` and `live` say what a row is here,
 * with this app's own not-yet-confirmed archive or exit applied.
 */
export function filterThreads(
  rows: SessionRow[],
  f: ThreadFilter,
  archived: (row: SessionRow) => boolean,
  live: (row: SessionRow) => boolean,
  state: (row: SessionRow) => SessionState | undefined = () => undefined
): { main: SessionRow[]; folded: SessionRow[] } {
  const main: SessionRow[] = []
  const folded: SessionRow[] = []
  for (const row of rows) {
    if (f.project && projectOf(row) !== f.project) continue
    if (f.harness && harnessOf(row) !== f.harness) continue
    if (f.speech.length && !f.speech.includes(speechOf(row))) continue
    // A state belongs to a running thread: with any picked, the rest go.
    if (f.states.length) {
      const st = live(row) ? state(row) : undefined
      if (!st || !f.states.includes(st)) continue
    }
    const a = archived(row)
    if (f.show === 'active') (a ? folded : main).push(row)
    else if (f.show === 'all' || (f.show === 'archived' ? a : !a && live(row) === (f.show === 'live'))) main.push(row)
  }
  return { main, folded }
}

/** The agents the menu offers: those the rows actually name, in a fixed order. */
export function harnessesOf(rows: SessionRow[]): Harness[] {
  const seen = new Set(rows.map(harnessOf))
  return HARNESSES.filter((h) => seen.has(h))
}

/**
 * The projects the menu offers: every one the rows name, most recently used
 * first, "Other" last (`projectOptions`). The Show menu and the move
 * picker read the same order, so a project is where it was last time.
 */
export function projectsOf(rows: SessionRow[]): string[] {
  return projectOptions(rows).map((o) => o.name)
}

/**
 * Search's share of the filter (David, 23 Sep 2026). A hit is a hit, not a
 * live row: it has no state to be in and no 30-day window, so the search
 * screen carries Show, project and agent, and no more.
 *
 * It is seeded from the list's filter so the narrowing you just made
 * follows you — except Active, which on the list folds the archived rows
 * rather than dropping them; searching, that is Everything. It is shown on
 * the screen, so nothing is ever missing for a reason you cannot see.
 */
export type HitFilter = Pick<ThreadFilter, 'show' | 'project' | 'harness'>
export const EVERYTHING: HitFilter = { show: 'all', project: null, harness: null }

export const searchFilterOf = (f: ThreadFilter): HitFilter => ({
  show: f.show === 'active' ? 'all' : f.show,
  project: f.project,
  harness: f.harness
})

export const isEverything = (f: HitFilter) => f.show === 'all' && !f.project && !f.harness

/** The button's words: "Everything", "Archived · sasonica", "Live · Codex". */
export function hitFilterLabel(f: HitFilter): string {
  const parts = [SHOW_LABEL[f.show]]
  if (f.project) parts.push(f.project)
  if (f.harness) parts.push(HARNESS_LABEL[f.harness])
  return parts.join(' · ')
}

/** Does this hit's thread pass? `project` is null for none — "Other". */
export function matchesHit(t: { project: string | null; harness: string; live: boolean; archived: boolean }, f: HitFilter): boolean {
  if (f.project && (t.project || OTHER_PROJECT) !== f.project) return false
  if (f.harness && (HARNESSES.includes(t.harness as Harness) ? t.harness : 'claude') !== f.harness) return false
  if (f.show === 'archived') return t.archived
  if (f.show === 'live') return !t.archived && t.live
  if (f.show === 'closed') return !t.archived && !t.live
  if (f.show === 'active') return !t.archived
  return true
}
