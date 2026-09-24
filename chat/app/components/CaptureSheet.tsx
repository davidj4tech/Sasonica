/**
 * "More…" beside the capture box: the capture templates the server can fill
 * (GET /notes `capture_kinds` — paragtd's next action, tickler, project, a
 * site's own). The sheet only picks; the box draws the template's prompts
 * and sends it. Built like the move sheet.
 */
import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { CaptureTemplate } from '../api/notes'

export function CaptureSheet(props: { kinds: CaptureTemplate[]; onPick: (t: CaptureTemplate) => void; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [props])

  if (typeof document === 'undefined') return null
  return createPortal(
    <div className="sheet-wrap" onClick={props.onClose}>
      <div className="rename-sheet move-sheet capture-sheet" role="dialog" aria-label="Capture as" onClick={(e) => e.stopPropagation()}>
        <p className="move-head">Capture as</p>
        <div className="move-targets">
          {props.kinds.map((t) => (
            <button key={t.name} onClick={() => props.onPick(t)}>
              {t.label}
              <span className="capture-where">{t.path.replace(/\.org$/, '')}</span>
            </button>
          ))}
          <button className="quiet" onClick={props.onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
