/**
 * "Move to…" for a heading: the places the server offers (GET /notes
 * `refile_targets` — paragtd's GTD files, or plain Org's other files), and a
 * date for one that needs it, as the tickler does. Moving is the caller's
 * business (POST /notes/refile); the sheet only picks. Built like the rename
 * sheet.
 */
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { RefileTargetInfo } from '../api/notes'
import { useNotesMeta } from '../lib/notesMeta'

function tomorrow(): string {
  const d = new Date(Date.now() + 86400e3)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function MoveSheet(props: { from: string; onMove: (to: RefileTargetInfo, date?: string) => void; onClose: () => void }) {
  const [date, setDate] = useState(tomorrow)
  const [picking, setPicking] = useState<RefileTargetInfo | null>(null)
  const meta = useNotesMeta()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [props])

  const targets = meta.refileTargets.filter((t) => t.path !== props.from)
  if (typeof document === 'undefined') return null
  return createPortal(
    <div className="sheet-wrap" onClick={props.onClose}>
      <div className="rename-sheet move-sheet" role="dialog" aria-label="Move to" onClick={(e) => e.stopPropagation()}>
        <p className="move-head">Move to</p>
        {picking ? (
          <form
            className="move-date"
            onSubmit={(e) => {
              e.preventDefault()
              if (date) props.onMove(picking, date)
            }}
          >
            <label>
              Bring it back on
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </label>
            <div className="row">
              <button type="button" className="quiet" onClick={() => setPicking(null)}>
                Back
              </button>
              <button type="submit" className="primary" disabled={!date}>
                Move to {picking.label}
              </button>
            </div>
          </form>
        ) : (
          <div className="move-targets">
            {targets.map((t) => (
              <button key={t.name} onClick={() => (t.needs_date ? setPicking(t) : props.onMove(t))}>
                {t.label}
                {t.needs_date ? ' (on a date)' : ''}
              </button>
            ))}
            <button className="quiet" onClick={props.onClose}>
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
