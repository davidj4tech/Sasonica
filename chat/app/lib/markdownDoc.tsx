/**
 * A markdown document drawn to be read, not followed: headings, lists and
 * paragraphs as themselves, and inside each the chat's own inline drawing
 * (shownText + rich: links, tables, code). The chat flattens headings and
 * bullets because the voice walks its text; a digest page has no voice to
 * follow, so it keeps them (David, 25 Sep 2026: "click on the digests to
 * browse and read them").
 */
import type { ReactNode } from 'react'
import { shownText } from './messages'
import { rich } from './rich'

const HEADING = /^(#{1,6})\s+(.*)$/
const ITEM = /^\s*([-*+]|\d+[.)])\s+(.*)$/
const FENCE = /^\s*(`{3,}|~{3,})/
const TABLE_ROW = /^\s*\|.*\|\s*$/

type Block =
  | { kind: 'h'; level: number; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'p'; text: string }
  | { kind: 'raw'; text: string }

export function parseDoc(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const out: Block[] = []
  for (let i = 0; i < lines.length; ) {
    const line = lines[i]
    if (!line.trim()) {
      i++
      continue
    }
    const fence = line.match(FENCE)
    if (fence) {
      let j = i + 1
      while (j < lines.length && !lines[j].trim().startsWith(fence[1])) j++
      out.push({ kind: 'raw', text: lines.slice(i, j + 1).join('\n') })
      i = j + 1
      continue
    }
    if (TABLE_ROW.test(line)) {
      let j = i
      while (j < lines.length && TABLE_ROW.test(lines[j])) j++
      out.push({ kind: 'raw', text: lines.slice(i, j).join('\n') })
      i = j
      continue
    }
    const h = line.match(HEADING)
    if (h) {
      out.push({ kind: 'h', level: h[1].length, text: h[2] })
      i++
      continue
    }
    const first = line.match(ITEM)
    if (first) {
      const ordered = /\d/.test(first[1])
      const items: string[] = []
      while (i < lines.length) {
        const m = lines[i].match(ITEM)
        if (!m) break
        const body = [m[2]]
        i++
        // An item runs on over indented lines; a blank line ends it, and the
        // list, unless another item follows.
        while (i < lines.length && lines[i].trim() && !ITEM.test(lines[i]) && /^\s+\S/.test(lines[i])) body.push(lines[i++].trim())
        items.push(body.join(' '))
        let k = i
        while (k < lines.length && !lines[k].trim()) k++
        if (k > i && k < lines.length && ITEM.test(lines[k])) i = k
      }
      out.push({ kind: 'list', ordered, items })
      continue
    }
    const para: string[] = []
    while (i < lines.length && lines[i].trim() && !HEADING.test(lines[i]) && !ITEM.test(lines[i]) && !FENCE.test(lines[i]) && !TABLE_ROW.test(lines[i])) para.push(lines[i++].trim())
    out.push({ kind: 'p', text: para.join(' ') })
  }
  return out
}

export function MarkdownDoc({ src, className = 'md-doc' }: { src: string; className?: string }) {
  const nodes: ReactNode[] = parseDoc(src).map((b, n) => {
    const k = `b${n}`
    if (b.kind === 'h') {
      const Tag = b.level <= 1 ? 'h2' : b.level === 2 ? 'h3' : 'h4'
      return <Tag key={k}>{rich(shownText(b.text), k)}</Tag>
    }
    if (b.kind === 'list') {
      const Tag = b.ordered ? 'ol' : 'ul'
      return (
        <Tag key={k}>
          {b.items.map((it, j) => (
            <li key={j}>{rich(shownText(it), `${k}i${j}`)}</li>
          ))}
        </Tag>
      )
    }
    if (b.kind === 'raw') return <div key={k}>{rich(shownText(b.text), k)}</div>
    return <p key={k}>{rich(shownText(b.text), k)}</p>
  })
  return <div className={className}>{nodes}</div>
}
