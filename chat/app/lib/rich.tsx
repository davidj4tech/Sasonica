/**
 * A shown text (lib/messages.ts shownText) drawn as the reader wants it: a
 * link's words tappable, a bare http(s) address tappable, a table as a
 * table and a code block as code (David, 25 Sep 2026). The hidden marks are
 * consumed here and never reach the page, so what the reader copies is what
 * they see.
 *
 * Safe on a piece of a text (the follow-along splits one into sentences): a
 * link whose url is in another piece shows its words plain, and a stray mark
 * is dropped.
 */
import type { ReactNode } from 'react'
import { BLOCK_CLOSE, BLOCK_OPEN, LINK_CLOSE, LINK_OPEN, LINK_URL, SAY_AS, SAY_CLOSE, SAY_OPEN } from './messages'

/** A bare address in prose, without the punctuation that usually ends a sentence after it. */
const BARE_URL = /https?:\/\/[^\s<>()[\]]+[^\s<>()[\].,;:!?'"]/g

function external(url: string): boolean {
  return /^(https?:\/\/|mailto:)/i.test(url)
}

function linkify(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let n = 0
  for (const m of text.matchAll(BARE_URL)) {
    const at = m.index ?? 0
    if (at > last) out.push(text.slice(last, at))
    out.push(
      <a key={`${key}u${n++}`} className="msg-link" href={m[0]} target="_blank" rel="noreferrer">
        {m[0]}
      </a>
    )
    last = at + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

/** A table cell or code-free inline markdown: links, bold, code spans. */
function cell(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = []
  const INLINE = /\[([^\]\n]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|`([^`]+)`/g
  let last = 0
  let n = 0
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0
    if (at > last) out.push(...linkify(text.slice(last, at), `${key}t${n}`))
    const k = `${key}i${n++}`
    if (m[1] !== undefined)
      out.push(
        external(m[2]) ? (
          <a key={k} className="msg-link" href={m[2]} target="_blank" rel="noreferrer">
            {m[1]}
          </a>
        ) : (
          <span key={k}>{m[1]}</span>
        )
      )
    else if (m[3] !== undefined) out.push(<strong key={k}>{m[3]}</strong>)
    else out.push(<code key={k}>{m[4]}</code>)
    last = at + m[0].length
  }
  if (last < text.length) out.push(...linkify(text.slice(last), `${key}t${n}`))
  return out
}

function cells(row: string): string[] {
  return row
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, '|'))
}

function MdTable({ src }: { src: string }) {
  const rows = src.split('\n')
  const head = cells(rows[0])
  const align = cells(rows[1] || '').map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : undefined))
  const body = rows.slice(2).map(cells)
  return (
    <div className="msg-table">
      <table>
        <thead>
          <tr>
            {head.map((c, i) => (
              <th key={i} style={align[i] ? { textAlign: align[i] } : undefined}>
                {cell(c, `h${i}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((r, j) => (
            <tr key={j}>
              {head.map((_h, i) => (
                <td key={i} style={align[i] ? { textAlign: align[i] } : undefined}>
                  {cell(r[i] || '', `r${j}c${i}`)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** The nodes for a shown text, or a piece of one. */
export function rich(text: string, key = 'r'): ReactNode[] {
  const out: ReactNode[] = []
  let buf = ''
  let n = 0
  const flush = () => {
    if (buf) out.push(...linkify(buf, `${key}${n++}`))
    buf = ''
  }
  for (let i = 0; i < text.length; ) {
    const c = text[i]
    if (c === BLOCK_OPEN) {
      // A block brings its own margin: the blank lines around it would double it.
      buf = buf.replace(/\n+$/, '')
      flush()
      const end = text.indexOf(BLOCK_CLOSE, i)
      const body = text.slice(i + 1, end < 0 ? text.length : end)
      const k = `${key}b${n++}`
      out.push(
        body[0] === 't' ? (
          <MdTable key={k} src={body.slice(1)} />
        ) : (
          <pre key={k} className="msg-code">
            <code>{body.slice(1)}</code>
          </pre>
        )
      )
      i = end < 0 ? text.length : end + 1
      while (text[i] === '\n') i++
      continue
    }
    if (c === LINK_OPEN) {
      const u = text.indexOf(LINK_URL, i)
      const close = text.indexOf(LINK_CLOSE, i)
      const nextOpen = text.indexOf(LINK_OPEN, i + 1)
      if (u > i && close > u && (nextOpen < 0 || nextOpen > close)) {
        flush()
        const words = text.slice(i + 1, u)
        const url = text.slice(u + 1, close)
        const k = `${key}l${n++}`
        out.push(
          external(url) ? (
            <a key={k} className="msg-link" href={url} target="_blank" rel="noreferrer">
              {words}
            </a>
          ) : (
            <span key={k} className="msg-path" title={url}>
              {words}
            </span>
          )
        )
        i = close + 1
        continue
      }
      i++
      continue
    }
    if (c === SAY_OPEN) {
      const as = text.indexOf(SAY_AS, i)
      const close = text.indexOf(SAY_CLOSE, i)
      if (as > i && close > as) {
        flush()
        const url = text.slice(i + 1, as)
        out.push(
          <a key={`${key}a${n++}`} className="msg-link" href={url} target="_blank" rel="noreferrer">
            {url}
          </a>
        )
        i = close + 1
        continue
      }
      i++
      continue
    }
    if (c === SAY_AS) {
      const close = text.indexOf(SAY_CLOSE, i)
      i = close < 0 ? text.length : close + 1
      continue
    }
    if (c === SAY_CLOSE) {
      i++
      continue
    }
    if (c === LINK_URL) {
      const close = text.indexOf(LINK_CLOSE, i)
      i = close < 0 ? text.length : close + 1
      continue
    }
    if (c === LINK_CLOSE) {
      i++
      continue
    }
    buf += c
    i++
  }
  flush()
  return out
}
