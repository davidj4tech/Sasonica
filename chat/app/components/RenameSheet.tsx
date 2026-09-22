/**
 * The rename sheet: the current title, editable, and Save. Opened from the
 * thread's header (a tap on the title, or ⋮ → Rename) and by a long press
 * on a thread in the list. Saving is useRename's business (optimistic, then
 * POST /rename, rolled back on refusal); the sheet closes at once.
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useScrim } from '../lib/layers'

export function RenameSheet(props: { title: string; onSave: (title: string) => void; onClose: () => void }) {
  const [value, setValue] = useState(props.title)
  const inputRef = useRef<HTMLInputElement>(null)
  const name = value.trim()
  const can = !!name && name !== props.title.trim()

  const scrim = useScrim(props.onClose)

  useEffect(() => {
    const el = inputRef.current
    if (el) {
      el.focus()
      el.select()
    }
  }, [])

  if (typeof document === 'undefined') return null
  return createPortal(
    <div className="sheet-wrap" {...scrim}>
      <form
        className="rename-sheet"
        role="dialog"
        aria-label="Rename thread"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          if (can) props.onSave(name)
        }}
      >
        <label>
          Name
          <input ref={inputRef} value={value} onChange={(e) => setValue(e.target.value)} maxLength={120} autoCapitalize="sentences" enterKeyHint="done" />
        </label>
        <div className="row">
          <button type="button" className="quiet" onClick={props.onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!can}>
            Rename
          </button>
        </div>
      </form>
    </div>,
    document.body
  )
}
