/**
 * Background agents (§6.12): the thread's subagents as a tree, sorted, and
 * the words for them — the strip's summary ("3 running · 12 done") and each
 * row's elapsed time.
 */
import type { AgentCounts, AgentRow, AgentStatus } from '../api/types'

export type AgentSort = 'running' | 'start'

const SORT_KEY = 'sasonica.chat.agentsSort'

/** This device's choice (localStorage; a private window just gets the default). */
export function loadAgentSort(): AgentSort {
  try {
    return localStorage.getItem(SORT_KEY) === 'start' ? 'start' : 'running'
  } catch {
    return 'running'
  }
}
export function saveAgentSort(sort: AgentSort) {
  try {
    localStorage.setItem(SORT_KEY, sort)
  } catch {
    // Not kept; the choice holds for this page.
  }
}

/** Running first, then the most recently active; or the order they started in. */
function compare(sort: AgentSort) {
  return (a: AgentRow, b: AgentRow) => {
    if (sort === 'start') return a.started_at - b.started_at || a.id.localeCompare(b.id)
    const ra = a.status === 'running' ? 0 : 1
    const rb = b.status === 'running' ? 0 : 1
    return ra - rb || b.last_at - a.last_at || b.started_at - a.started_at
  }
}

export interface TreeRow {
  row: AgentRow
  /** 0 = spawned by the thread; forks and children nest under their parent. */
  level: number
}

/**
 * The rows depth-first, each parent followed by its children, siblings
 * sorted at every level. A parent the list does not hold (it was never
 * written, or is another session's) makes its children roots.
 */
export function agentTree(rows: AgentRow[], sort: AgentSort): TreeRow[] {
  const ids = new Set(rows.map((r) => r.id))
  const kids = new Map<string | null, AgentRow[]>()
  for (const r of rows) {
    const p = r.parent_id && ids.has(r.parent_id) && r.parent_id !== r.id ? r.parent_id : null
    if (!kids.has(p)) kids.set(p, [])
    kids.get(p)!.push(r)
  }
  const out: TreeRow[] = []
  const seen = new Set<string>()
  const walk = (parent: string | null, level: number) => {
    for (const r of [...(kids.get(parent) || [])].sort(compare(sort))) {
      if (seen.has(r.id)) continue
      seen.add(r.id)
      out.push({ row: r, level })
      walk(r.id, level + 1)
    }
  }
  walk(null, 0)
  return out
}

const WORD: Record<AgentStatus, string> = { running: 'running', done: 'done', failed: 'failed', stopped: 'stopped' }

/** "3 running · 12 done · 1 failed" from the rows, else from the stream's counts. */
export function agentSummary(counts: AgentCounts | null, rows: AgentRow[] | null): string {
  if (rows && rows.length) {
    const n: Record<AgentStatus, number> = { running: 0, done: 0, failed: 0, stopped: 0 }
    for (const r of rows) n[r.status] = (n[r.status] || 0) + 1
    return (['running', 'done', 'failed', 'stopped'] as AgentStatus[])
      .filter((k) => n[k] > 0)
      .map((k) => `${n[k]} ${WORD[k]}`)
      .join(' · ')
  }
  if (!counts || !counts.total) return ''
  const ended = counts.total - counts.running
  return [counts.running ? `${counts.running} running` : '', ended ? `${ended} finished` : ''].filter(Boolean).join(' · ')
}

/** 45s · 3m 20s · 2h 5m. */
export function duration(s: number): string {
  s = Math.max(0, Math.floor(s))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

/** How long it ran: until now while running, else start to end. */
export function elapsedOf(r: AgentRow, nowS: number): string {
  const end = r.status === 'running' ? nowS : r.ended_at ?? r.last_at
  return duration(end - r.started_at)
}
