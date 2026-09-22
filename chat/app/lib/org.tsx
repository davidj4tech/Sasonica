/**
 * Org text as something to read on a phone — not an Org implementation.
 *
 * Headings (with their TODO state), paragraphs, lists and checkboxes, code
 * and example blocks, tables as preformatted text, and the inline marks
 * people actually use: *bold*, /italic/, =code=, ~code~, links. Property
 * drawers and `#+` keywords are furniture and are left out; SCHEDULED /
 * DEADLINE lines become a quiet date line.
 *
 * Links: `[[id:…][label]]` opens the note the server resolved it to (the
 * read answer's `links`, matched by label); `[[https://…][label]]` opens the
 * web page; anything else shows its label.
 */
import { Fragment, type ReactNode } from 'react'
import { Link } from 'react-router'

export interface OrgLink {
  label: string
  path: string
}

const STATES = new Set(['TODO', 'NEXT', 'WAITING', 'SOMEDAY', 'DONE', 'CANCELLED', 'CANCELED'])
const HEADING = /^(\*+)\s+(.*)$/
const LIST = /^(\s*)([-+]|\d+[.)])\s+(?:\[([ X-])\]\s+)?(.*)$/
const INLINE = /\[\[([^\]]+)\](?:\[([^\]]*)\])?\]|(^|[\s(])([*/=~])(\S(?:.*?\S)?)\4(?=[\s.,;:!?)]|$)/g

/** Where a note opens in this app. */
export function noteHref(path: string, at = 0): string {
  return `/notebook/note?path=${encodeURIComponent(path)}${at ? `&at=${at}` : ''}`
}

function inline(text: string, links: OrgLink[], key: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let n = 0
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0
    if (m[1] !== undefined) {
      if (at > last) out.push(text.slice(last, at))
      const target = m[1]
      const label = m[2] || target.replace(/^id:/, '')
      const k = `${key}-${n++}`
      if (target.startsWith('id:')) {
        const hit = links.find((l) => l.label === label) || links.find((l) => l.label === target.slice(3))
        out.push(hit ? <Link key={k} to={noteHref(hit.path)}>{label}</Link> : <span key={k} className="org-dead-link">{label}</span>)
      } else if (/^https?:\/\//.test(target)) {
        out.push(<a key={k} href={target} target="_blank" rel="noreferrer">{label}</a>)
      } else {
        out.push(<span key={k}>{label}</span>)
      }
      last = at + m[0].length
    } else {
      const lead = m[3] || ''
      if (at + lead.length > last) out.push(text.slice(last, at + lead.length))
      const body = m[5]
      const k = `${key}-${n++}`
      const mark = m[4]
      out.push(mark === '*' ? <strong key={k}>{body}</strong> : mark === '/' ? <em key={k}>{body}</em> : <code key={k}>{body}</code>)
      last = at + m[0].length
    }
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

/** Split a heading line's text into state, priority, title and tags. */
export function parseHeading(rest: string): { state: string; priority: string; title: string; tags: string[] } {
  let s = rest.trim()
  let state = ''
  const first = s.split(/\s+/, 1)[0]
  if (STATES.has(first)) {
    state = first
    s = s.slice(first.length).trim()
  }
  let priority = ''
  const p = /^\[#([A-C])\]\s*/.exec(s)
  if (p) {
    priority = p[1]
    s = s.slice(p[0].length)
  }
  let tags: string[] = []
  const t = /\s+(:[\w@#%:]+:)\s*$/.exec(s)
  if (t) {
    tags = t[1].split(':').filter(Boolean)
    s = s.slice(0, t.index)
  }
  return { state, priority, title: s.trim(), tags }
}

export function StateBadge({ state }: { state: string }) {
  if (!state) return null
  const done = state === 'DONE' || state === 'CANCELLED' || state === 'CANCELED'
  return <span className={`org-state ${done ? 'done' : state.toLowerCase()}`}>{state}</span>
}

/** The note's body, rendered. `skipFirstHeading` when the page title already shows it. */
export function OrgBody({ text, links, skipFirstHeading = false }: { text: string; links: OrgLink[]; skipFirstHeading?: boolean }) {
  const lines = text.split('\n')
  const blocks: ReactNode[] = []
  let para: string[] = []
  let list: { depth: number; box: string | undefined; text: string }[] = []
  let skipped = !skipFirstHeading
  let i = 0

  const flushPara = () => {
    if (para.length) {
      const k = `p${blocks.length}`
      blocks.push(<p key={k}>{inline(para.join(' '), links, k)}</p>)
      para = []
    }
  }
  const flushList = () => {
    if (list.length) {
      const k = `l${blocks.length}`
      blocks.push(
        <ul key={k} className="org-list">
          {list.map((it, j) => (
            <li key={j} style={it.depth ? { marginLeft: `${it.depth}rem` } : undefined} className={it.box !== undefined ? 'org-check' : undefined}>
              {it.box !== undefined && <span className="org-box">{it.box === 'X' ? '☑' : it.box === '-' ? '◩' : '☐'}</span>}
              {inline(it.text, links, `${k}-${j}`)}
            </li>
          ))}
        </ul>
      )
      list = []
    }
  }
  const flush = () => {
    flushPara()
    flushList()
  }

  while (i < lines.length) {
    const line = lines[i]
    const s = line.trim()
    // Drawers: :PROPERTIES: … :END: (and :LOGBOOK: and friends).
    if (/^:[A-Z_]+:$/.test(s) && s !== ':END:') {
      flush()
      while (i < lines.length && lines[i].trim() !== ':END:') i++
      i++
      continue
    }
    if (/^#\+begin_/i.test(s)) {
      flush()
      const body: string[] = []
      i++
      while (i < lines.length && !/^\s*#\+end_/i.test(lines[i])) body.push(lines[i++])
      i++
      blocks.push(<pre key={`b${blocks.length}`} className="org-block">{body.join('\n')}</pre>)
      continue
    }
    if (s.startsWith('#')) {
      i++
      continue
    }
    const h = HEADING.exec(line)
    if (h) {
      flush()
      i++
      if (!skipped) {
        skipped = true
        continue
      }
      const { state, priority, title, tags } = parseHeading(h[2])
      const level = Math.min(h[1].length, 4)
      const k = `h${blocks.length}`
      blocks.push(
        <div key={k} className={`org-h org-h${level}`}>
          <StateBadge state={state} />
          {priority && <span className="org-prio">#{priority}</span>}
          <span>{inline(title, links, k)}</span>
          {tags.length > 0 && <span className="org-tags">{tags.join(' · ')}</span>}
        </div>
      )
      continue
    }
    if (/^(SCHEDULED|DEADLINE|CLOSED):/.test(s)) {
      flush()
      const k = `d${blocks.length}`
      blocks.push(
        <p key={k} className="org-date">
          {s.replace(/[<>[\]]/g, '').replace(/\s+/g, ' ')}
        </p>
      )
      i++
      continue
    }
    if (s.startsWith('|')) {
      flush()
      const rows: string[] = []
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(lines[i++].trim())
      blocks.push(<pre key={`t${blocks.length}`} className="org-block">{rows.join('\n')}</pre>)
      continue
    }
    const l = LIST.exec(line)
    if (l) {
      flushPara()
      list.push({ depth: Math.floor(l[1].length / 2), box: l[3], text: l[4] })
      i++
      continue
    }
    if (!s) {
      flush()
      i++
      continue
    }
    if (list.length && /^\s+/.test(line)) {
      // A list item's continuation line.
      list[list.length - 1].text += ` ${s}`
      i++
      continue
    }
    flushList()
    para.push(s)
    i++
  }
  flush()
  return <Fragment>{blocks}</Fragment>
}
