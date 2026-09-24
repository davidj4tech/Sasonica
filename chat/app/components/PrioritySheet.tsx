/**
 * "Priority…" for a heading: Org's [#A] / [#B] / [#C] cookie, or none. An
 * [#A] with a clock time is read aloud at that time (the server's
 * `media agenda-alarm`). Setting it is the caller's (POST /notes/priority).
 */
import { Sheet } from './SessionSheets'

const CHOICES = [
  { p: 'A', label: 'A — read aloud at its time' },
  { p: 'B', label: 'B' },
  { p: 'C', label: 'C' },
  { p: '', label: 'None' }
] as const

export function PrioritySheet(props: { current: string; onPick: (priority: string) => void; onClose: () => void }) {
  return (
    <Sheet label="Priority" onClose={props.onClose} className="action-sheet">
      <p className="action-title">Priority</p>
      <div role="menu" className="action-list">
        {CHOICES.map((c) => (
          <button key={c.p || 'none'} role="menuitemradio" aria-checked={props.current === c.p} className={props.current === c.p ? 'on' : ''} onClick={() => props.onPick(c.p)}>
            {c.label}
          </button>
        ))}
      </div>
      <p className="sheet-hint">Only an A with a time on its date is spoken.</p>
      <div className="row">
        <button type="button" className="quiet" onClick={props.onClose}>
          Cancel
        </button>
      </div>
    </Sheet>
  )
}
