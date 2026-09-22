/**
 * The thread's actions as sheets: the list's long-press menu (Rename, Auto rename, Exit
 * session, Archive / Unarchive, Exit & archive); an exit asks no confirmation
 * (a send resumes it). The thread header's ⋮ menu offers the same items
 * (sessionMenuItems), so both places say the same thing.
 */
import type { ReactNode } from 'react'
import { useScrim } from '../lib/layers'
import { createPortal } from 'react-dom'

export type SessionAction = 'rename' | 'auto-rename' | 'exit' | 'archive' | 'unarchive' | 'exit-archive'

export const ACTION_LABEL: Record<SessionAction, string> = {
  rename: 'Rename…',
  'auto-rename': 'Auto rename',
  exit: 'Exit session',
  archive: 'Archive',
  unarchive: 'Unarchive',
  'exit-archive': 'Exit & archive'
}

/** What a thread offers: exit only while it runs, one archive toggle, the pair when it runs and is not archived. */
export function sessionMenuItems(live: boolean, archived: boolean): SessionAction[] {
  const items: SessionAction[] = ['rename', 'auto-rename']
  if (live) items.push('exit')
  items.push(archived ? 'unarchive' : 'archive')
  if (live && !archived) items.push('exit-archive')
  return items
}

export function Sheet(props: { label: string; onClose: () => void; children: ReactNode; className?: string }) {
  // A scrim tap, Escape or Android back closes it (lib/layers.ts).
  const scrim = useScrim(props.onClose)
  if (typeof document === 'undefined') return null
  return createPortal(
    <div className="sheet-wrap" {...scrim}>
      <div className={`rename-sheet ${props.className || ''}`} role="dialog" aria-label={props.label} onClick={(e) => e.stopPropagation()}>
        {props.children}
      </div>
    </div>,
    document.body
  )
}

/** The list's long-press menu for one thread. */
export function SessionMenuSheet(props: { title: string; live: boolean; archived: boolean; onPick: (a: SessionAction) => void; onClose: () => void }) {
  return (
    <Sheet label="Thread actions" onClose={props.onClose} className="action-sheet">
      <p className="action-title">{props.title}</p>
      <div role="menu" className="action-list">
        {sessionMenuItems(props.live, props.archived).map((a) => (
          <button key={a} role="menuitem" className={a === 'exit' || a === 'exit-archive' ? 'danger' : ''} onClick={() => props.onPick(a)}>
            {ACTION_LABEL[a]}
          </button>
        ))}
      </div>
      <div className="row">
        <button type="button" className="quiet" onClick={props.onClose}>
          Cancel
        </button>
      </div>
    </Sheet>
  )
}
