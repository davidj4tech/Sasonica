/**
 * `@` in the composer: the threads whose titles fit the letters typed after
 * it, above the box; a tap puts a chip `@[<title>]` in place of `@letters`
 * (lib/refs.ts says what the server does with it). Escape, or typing past a
 * space, closes it. Inside the thread's AssistantRuntimeProvider: it reads
 * and sets the composer's text.
 */
import { useAui, useAuiState } from '@assistant-ui/react'
import { useEffect, useRef, useState } from 'react'
import { candidates, chipOf, matching, remember, type RefCandidate } from '../lib/refs'

/** An `@` at the start or after a space, then the letters up to the caret. */
const AT = /(^|\s)@([^\s@[\]]{0,40})$/

export function MentionPicker() {
  const aui = useAui()
  const text = useAuiState((s) => s.composer.text)
  const anchor = useRef<HTMLSpanElement>(null)
  const [rows, setRows] = useState<RefCandidate[] | null>(null)
  /** Where the open `@` sits, or null; `dismissed` is one the reader closed. */
  const [at, setAt] = useState<{ start: number; query: string } | null>(null)
  const dismissed = useRef<number | null>(null)

  const box = () => anchor.current?.closest('.composer')?.querySelector('textarea') ?? null

  useEffect(() => {
    const ta = box()
    const caret = ta && document.activeElement === ta ? ta.selectionStart : text.length
    const m = AT.exec(text.slice(0, caret))
    if (!m) {
      dismissed.current = null
      setAt(null)
      return
    }
    const start = m.index + m[1].length
    if (dismissed.current === start) return
    setAt({ start, query: m[2] })
    if (rows === null) void candidates().then(setRows)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text])

  useEffect(() => {
    if (!at) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      dismissed.current = at.start
      setAt(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [at])

  const hits = at && rows ? matching(rows, at.query, 6) : []

  const pick = (r: RefCandidate) => {
    if (!at) return
    remember(r.title, r.session)
    const now = aui.composer().getState().text
    const end = at.start + 1 + at.query.length
    const chip = `${chipOf(r.title)} `
    const next = now.slice(0, at.start) + chip + now.slice(end).replace(/^ /, '')
    aui.composer().setText(next)
    setAt(null)
    const caret = at.start + chip.length
    window.requestAnimationFrame(() => {
      const ta = box()
      if (!ta) return
      ta.focus()
      ta.setSelectionRange(caret, caret)
    })
  }

  return (
    <span ref={anchor} className="mention-anchor">
      {hits.length > 0 && (
        <div className="mention-list" role="listbox" aria-label="Refer to a thread">
          {hits.map((r) => (
            <button
              key={r.session}
              type="button"
              role="option"
              aria-selected="false"
              // Keep the keyboard up: the box must not lose focus before the tap lands.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(r)}
            >
              <span className="mention-title">{r.title}</span>
              {r.project && <span className="mention-project">{r.project}</span>}
            </button>
          ))}
        </div>
      )}
    </span>
  )
}
