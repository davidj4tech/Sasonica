/**
 * Changing a heading's SCHEDULED or DEADLINE date: a few quick picks, or
 * any day and time from the pickers. Saving is the caller's business
 * (POST /notes/date); the sheet only picks. Built like the move sheet.
 */
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { DateKind } from '../api/notes'

function isoDay(offset: number): string {
  const d = new Date(Date.now() + offset * 86400e3)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Days until the coming Saturday; a week on when it is Saturday already. */
function toSaturday(): number {
  return ((6 - new Date().getDay() + 7) % 7) || 7
}

export function DateSheet(props: {
  kind: DateKind
  /** The stamp as it is: YYYY-MM-DD and HH:MM, or `''` when there is none. */
  date: string
  time: string
  onSave: (date: string, time: string) => void
  onClose: () => void
}) {
  const [date, setDate] = useState(props.date || isoDay(1))
  const [time, setTime] = useState(props.time)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [props])

  const quick: [string, number][] = [
    ['Today', 0],
    ['Tomorrow', 1],
    ['Saturday', toSaturday()],
    ['Next week', 7]
  ]
  const label = props.kind === 'deadline' ? 'Deadline' : 'Scheduled'
  if (typeof document === 'undefined') return null
  return createPortal(
    <div className="sheet-wrap" onClick={props.onClose}>
      <div className="rename-sheet move-sheet date-sheet" role="dialog" aria-label={`${label} date`} onClick={(e) => e.stopPropagation()}>
        <p className="move-head">{props.date ? `${label}: change the date` : `${label}: pick a date`}</p>
        <div className="date-quick">
          {quick.map(([name, n]) => (
            <button key={name} type="button" className={date === isoDay(n) ? 'state-key on' : 'state-key'} onClick={() => setDate(isoDay(n))}>
              {name}
            </button>
          ))}
        </div>
        <form
          className="move-date"
          onSubmit={(e) => {
            e.preventDefault()
            if (date) props.onSave(date, time)
          }}
        >
          <label>
            Date
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </label>
          <label>
            Time (optional)
            <span className="date-time">
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
              {time && (
                <button type="button" className="quiet" onClick={() => setTime('')}>
                  No time
                </button>
              )}
            </span>
          </label>
          <div className="row">
            {props.date && (
              <button type="button" className="quiet danger" onClick={() => props.onSave('', '')}>
                Remove date
              </button>
            )}
            <button type="button" className="quiet" onClick={props.onClose}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={!date}>
              Save
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  )
}
