/**
 * "Move to…" for a heading in a GTD file: the paragtd destinations, and a
 * date for the tickler. Moving is the caller's business (POST /notes/refile);
 * the sheet only picks. Built like the rename sheet.
 */
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { REFILE_FILES, REFILE_LABELS, type RefileTarget } from '../api/notes'

function tomorrow(): string {
  const d = new Date(Date.now() + 86400e3)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function MoveSheet(props: { from: string; onMove: (to: RefileTarget, date?: string) => void; onClose: () => void }) {
  const [date, setDate] = useState(tomorrow)
  const [picking, setPicking] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [props])

  const targets = (Object.keys(REFILE_LABELS) as RefileTarget[]).filter((t) => REFILE_FILES[t] !== props.from)
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
              if (date) props.onMove('tickler', date)
            }}
          >
            <label>
              Bring it back on
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </label>
            <div className="row">
              <button type="button" className="quiet" onClick={() => setPicking(false)}>
                Back
              </button>
              <button type="submit" className="primary" disabled={!date}>
                Move to the tickler
              </button>
            </div>
          </form>
        ) : (
          <div className="move-targets">
            {targets.map((t) => (
              <button key={t} onClick={() => (t === 'tickler' ? setPicking(true) : props.onMove(t))}>
                {REFILE_LABELS[t]}
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
