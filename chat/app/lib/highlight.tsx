/**
 * Showing where a search matched: text cut at the server's offsets (§6.14
 * `match`) into plain runs and <mark>s; offsets for terms in text the server
 * did not mark (a memory); and, in a thread after a jump, the terms lit in
 * one message's DOM with the CSS Custom Highlight API — no DOM changes, so
 * React's tree is untouched (where the API is missing, the message's flash
 * is all there is).
 */
import type { ReactNode } from 'react'

export function Marked({ text, match }: { text: string; match?: [number, number][] }): ReactNode {
  if (!match?.length) return text
  const out: ReactNode[] = []
  let at = 0
  for (const [a, b] of [...match].sort((x, y) => x[0] - y[0])) {
    if (a < at || b <= a || a > text.length) continue
    if (a > at) out.push(text.slice(at, a))
    out.push(<mark key={a}>{text.slice(a, b)}</mark>)
    at = b
  }
  if (at < text.length) out.push(text.slice(at))
  return out
}

const WORD = /[\p{L}\p{N}_]/u

/**
 * Offsets of each term (case-insensitive) in `text`, merged — at the start
 * of a word only, as the server matches (a word, or the start of one).
 */
export function termSpans(text: string, terms: string[]): [number, number][] {
  const low = text.toLowerCase()
  const spans: [number, number][] = []
  for (const t of terms) {
    const needle = t.toLowerCase()
    if (!needle) continue
    for (let i = low.indexOf(needle); i >= 0; i = low.indexOf(needle, i + needle.length)) {
      if (i === 0 || !WORD.test(low[i - 1])) spans.push([i, i + needle.length])
    }
  }
  spans.sort((a, b) => a[0] - b[0])
  const merged: [number, number][] = []
  for (const s of spans) {
    const last = merged[merged.length - 1]
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1])
    else merged.push([s[0], s[1]])
  }
  return merged
}

const HIGHLIGHT = 'search-hit'

/**
 * Light `terms` inside `el` for `ms`. Returns a function that clears it.
 * Text nodes only; a term split across two nodes (bold mid-word) is missed.
 */
export function lightTerms(el: Element, terms: string[], ms = 4000): () => void {
  const reg = (globalThis as { CSS?: { highlights?: Map<string, unknown> } }).CSS?.highlights
  const Hl = (globalThis as { Highlight?: new (...r: Range[]) => unknown }).Highlight
  if (!reg || !Hl || !terms.length) return () => {}
  const ranges: Range[] = []
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    for (const [a, b] of termSpans(n.textContent || '', terms)) {
      const r = document.createRange()
      r.setStart(n, a)
      r.setEnd(n, b)
      ranges.push(r)
    }
  }
  if (!ranges.length) return () => {}
  reg.set(HIGHLIGHT, new Hl(...ranges))
  const clear = () => {
    if (reg.get(HIGHLIGHT)) reg.delete(HIGHLIGHT)
  }
  const t = window.setTimeout(clear, ms)
  return () => {
    window.clearTimeout(t)
    clear()
  }
}
