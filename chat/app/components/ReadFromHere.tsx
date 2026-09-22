/**
 * "Read from here" on a spoken reply that is not playing (§6.5).
 *
 * The gesture is the platform's own selection: a long press on a word (or a
 * drag on a desktop) selects it, and while a selection starts inside a
 * spoken reply (`.line-text[data-rid]`, parts.tsx) this chip sits just
 * under it. A press replays that reply from the sentence the selection
 * starts in — ONE call (`replay-id` + `sentence`), so there is no
 * replay-then-seek race. A plain tap on an old message does nothing new: it
 * never hijacks a tap, a link, a scroll or a selection someone wanted to
 * copy (the native Copy bar stays; the chip is below the words, clear of it).
 *
 * The index is the server's: GET /speech/sentences names the reply's
 * sentences as the replay counts them, and the selection's character is
 * placed among them (lib/followAlong.ts sentenceSpans) — the app never
 * splits the words itself. Fetched when the chip appears, so the press is
 * quick. A reply with no sentence map plays from the top.
 *
 * In the message being said a tap is enough (parts.tsx LiveText); this
 * chip is only for the others.
 */
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { getSpeechSentences } from '../api'
import { useSpeechActions } from '../hooks/useSpeech'
import { sentenceOfChar, sentenceSpans } from '../lib/followAlong'

/** A selection that goes away (the press itself can clear it) hides the chip only after this. */
const HIDE_AFTER_MS = 300
/** Room kept for the chip under the selection; nearer the bottom, it goes above. */
const CHIP_ROOM_PX = 56

const cache = new Map<number, Promise<string[]>>()
/** The reply's sentences, asked once per history row (dropped on failure, to ask again). */
function sentencesOf(id: number): Promise<string[]> {
  let got = cache.get(id)
  if (!got) {
    got = getSpeechSentences(id).then((r) => r.sentences || [])
    got.catch(() => cache.delete(id))
    cache.set(id, got)
  }
  return got
}

interface Picked {
  id: number
  /** Characters into the reply's shown text where the selection starts. */
  offset: number
  text: string
  x: number
  y: number
  above: boolean
}

function picked(): Picked | null {
  const sel = typeof document !== 'undefined' ? document.getSelection() : null
  if (!sel || sel.isCollapsed || !sel.rangeCount || !sel.toString().trim()) return null
  const range = sel.getRangeAt(0)
  const node = range.startContainer
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
  const p = el?.closest<HTMLElement>('.line-text[data-rid]')
  if (!p) return null
  const id = Number(p.dataset.rid)
  if (!Number.isInteger(id) || id <= 0) return null
  const pre = document.createRange()
  pre.selectNodeContents(p)
  pre.setEnd(range.startContainer, range.startOffset)
  const r = range.getBoundingClientRect()
  const above = r.bottom + CHIP_ROOM_PX > window.innerHeight
  return { id, offset: pre.toString().length, text: p.textContent || '', x: r.left + r.width / 2, y: above ? r.top - 10 : r.bottom + 10, above }
}

export function ReadFromHere() {
  const { replayFrom, replayId } = useSpeechActions()
  const [at, setAt] = useState<Picked | null>(null)
  const hideRef = useRef(0)

  useEffect(() => {
    const read = () => {
      const got = picked()
      if (!got) {
        window.clearTimeout(hideRef.current)
        hideRef.current = window.setTimeout(() => setAt(null), HIDE_AFTER_MS)
        return
      }
      window.clearTimeout(hideRef.current)
      setAt(got)
      void sentencesOf(got.id).catch(() => undefined)
    }
    document.addEventListener('selectionchange', read)
    // The thread scrolls under a selection: keep the chip with the words.
    document.addEventListener('scroll', read, true)
    return () => {
      document.removeEventListener('selectionchange', read)
      document.removeEventListener('scroll', read, true)
      window.clearTimeout(hideRef.current)
    }
  }, [])

  const go = useCallback(async () => {
    const cur = at
    if (!cur) return
    setAt(null)
    document.getSelection()?.removeAllRanges()
    const sentences = await sentencesOf(cur.id).catch(() => null)
    if (!sentences || !sentences.length) {
      replayId(cur.id)
      return
    }
    void replayFrom(cur.id, sentenceOfChar(sentenceSpans(cur.text, sentences), cur.offset))
  }, [at, replayFrom, replayId])

  // Pressed before the selection can clear (a press elsewhere collapses it);
  // a keyboard press arrives as a click with no pointer (detail 0).
  const onPointerDown = (e: ReactPointerEvent) => {
    e.preventDefault()
    void go()
  }
  const onClick = (e: ReactMouseEvent) => {
    if (e.detail === 0) void go()
  }

  if (!at || typeof document === 'undefined') return null
  const left = Math.max(70, Math.min(window.innerWidth - 70, at.x))
  return createPortal(
    <button
      className="read-from-here"
      style={{ left, top: at.y, transform: `translate(-50%, ${at.above ? '-100%' : '0'})` }}
      onPointerDown={onPointerDown}
      onClick={onClick}
    >
      Read from here
    </button>,
    document.body
  )
}
