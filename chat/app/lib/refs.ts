/**
 * Another conversation named by a chip instead of by typing its title
 * (David, 24 Sep 2026): `@[<title>]` in the box, put there by Share… on a
 * thread's menu or by `@` in the composer. The send carries `refs`,
 * `{title: session}` for the chips still in the text, and the server adds a
 * line per chip naming the session and its transcript (server §6.3 `refs`).
 *
 * Which session a chip means is remembered here (localStorage), so a chip
 * still resolves after a reload or a thread switch. A chip this device does
 * not know (a draft from another device) goes without, and the server
 * matches it by title.
 */
import { readDraft, pushDraft, writeDraft } from './drafts'
import { loadTargets, peekTargets } from './snapshots'
import { titleOverride } from './titles'
import type { SessionRow } from '../api/types'

const KEY = 'sasonica.chat.refs'
const KEEP = 200

const CHIP = /@\[([^[\]\n]{1,200})\]/g

/** The line the server adds per chip (server §6.3 `refs`); on one line too, where a send was flattened. */
export const REF_LINE = /\s*@\[([^[\]\n]+)\] is conversation ([\w-]+) \([^)\n]*\)/g

/** `text` without the server's chip lines: the words as they were typed. */
export const withoutRefLines = (text: string) => text.replace(REF_LINE, '')

/** The label a title gets: one line, no brackets, not too long. */
export function labelOf(title: string): string {
  const t = title.replace(/[[\]]/g, '').replace(/\s+/g, ' ').trim()
  return (t.length > 80 ? t.slice(0, 79) + '…' : t) || 'Untitled'
}

export const chipOf = (title: string) => `@[${labelOf(title)}]`

function load(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(KEY)
    const m = raw ? (JSON.parse(raw) as Record<string, string>) : {}
    return m && typeof m === 'object' ? m : {}
  } catch {
    return {}
  }
}

/** A chip was made for `session`: remember which session its label means (the newest wins). */
export function remember(title: string, session: string) {
  const m = load()
  const label = labelOf(title)
  delete m[label]
  m[label] = session
  const keys = Object.keys(m)
  for (const k of keys.slice(0, Math.max(0, keys.length - KEEP))) delete m[k]
  try {
    window.localStorage.setItem(KEY, JSON.stringify(m))
  } catch {
    // Not kept: the server matches the chip by title instead.
  }
}

/** `{label: session}` for the chips in `text` this device knows, or undefined when none. */
export function refsIn(text: string): Record<string, string> | undefined {
  const m = load()
  const out: Record<string, string> = {}
  for (const hit of text.matchAll(CHIP)) {
    const label = hit[1].trim()
    if (m[label]) out[label] = m[label]
  }
  return Object.keys(out).length ? out : undefined
}

/** A chip for `title` into the draft kept under `key`, after whatever is there. */
export function chipIntoDraft(key: string, title: string, session: string) {
  remember(title, session)
  const prev = readDraft(key).text.replace(/\s+$/, '')
  writeDraft(key, `${prev ? prev + ' ' : ''}${chipOf(title)} `)
  void pushDraft(key)
}

export interface RefCandidate {
  session: string
  title: string
  project?: string | null
  live: boolean
}

const candidateOf = (row: SessionRow): RefCandidate => ({
  session: row.session,
  title: titleOverride(row.session) || row.title || 'Untitled',
  project: row.project,
  live: row.live
})

/** The threads a chip can name: the list's last answer, live first. */
export async function candidates(): Promise<RefCandidate[]> {
  const res = peekTargets() || (await loadTargets())
  const rows = res?.sessions || []
  return [...rows].sort((a, b) => Number(b.live) - Number(a.live)).map(candidateOf)
}

/** `rows` whose title (or project) has every word of `query`, first `limit`. */
export function matching(rows: RefCandidate[], query: string, limit = 8): RefCandidate[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const hits = words.length
    ? rows.filter((r) => {
        const hay = `${r.title} ${r.project || ''}`.toLowerCase()
        return words.every((w) => hay.includes(w))
      })
    : rows
  return hits.slice(0, limit)
}
