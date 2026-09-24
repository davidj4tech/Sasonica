/**
 * The thread's actions as sheets: the list's long-press menu (Rename, Auto rename,
 * Move to project…, Exit session, Archive / Unarchive, Exit & archive); an exit
 * asks no confirmation (a send resumes it). The thread header's ⋮ menu offers the
 * same items (sessionMenuItems), so both places say the same thing.
 *
 * Move opens the project picker below. It says up front that a running session
 * restarts (§6.15: the agent cannot change directory mid-session), because that
 * is the one thing about it nobody would guess.
 */
import { Fragment, type ReactNode } from 'react'
import type { ProjectOption } from '../lib/threadSort'
import { useScrim } from '../lib/layers'
import { createPortal } from 'react-dom'

export type SessionAction = 'rename' | 'auto-rename' | 'move' | 'always-speak' | 'normal-speak' | 'exit' | 'archive' | 'unarchive' | 'exit-archive'

export const ACTION_LABEL: Record<SessionAction, string> = {
  rename: 'Rename…',
  'auto-rename': 'Auto rename',
  move: 'Move to project…',
  'always-speak': 'Always speak',
  'normal-speak': 'Stop always speaking',
  exit: 'Exit session',
  archive: 'Archive',
  unarchive: 'Unarchive',
  'exit-archive': 'Exit & archive'
}

/** What a thread offers: one always-speak toggle, exit only while it runs, one archive toggle, the pair when it runs and is not archived. */
export function sessionMenuItems(live: boolean, archived: boolean, priority = false): SessionAction[] {
  const items: SessionAction[] = ['rename', 'auto-rename', 'move', priority ? 'normal-speak' : 'always-speak']
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
export function SessionMenuSheet(props: { title: string; live: boolean; archived: boolean; priority?: boolean; onPick: (a: SessionAction) => void; onClose: () => void }) {
  return (
    <Sheet label="Thread actions" onClose={props.onClose} className="action-sheet">
      <p className="action-title">{props.title}</p>
      <div role="menu" className="action-list">
        {sessionMenuItems(props.live, props.archived, props.priority).map((a) => (
          <button key={a} role="menuitem" onClick={() => props.onPick(a)}>
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


/**
 * Where to move a thread: the projects the thread list knows, most recently
 * used first (`projectOptions`), under two heads — the ones with a session
 * running in them now, then the rest. Its own project is left out: picking
 * it is a no-op, and the note above says where it already is.
 *
 * The list takes the room the sheet has and scrolls (David, 23 Sep 2026),
 * the way the threads screen's Show menu does: a server with thirty
 * projects used to run the list off the bottom of the screen with no way to
 * reach the foot of it.
 */
export function ProjectPickerSheet(props: {
  title: string
  current: string | null
  projects: ProjectOption[]
  live: boolean
  onPick: (project: string) => void
  onClose: () => void
}) {
  const others = props.projects.filter((p) => p.name !== props.current)
  const sections: { head: string; items: ProjectOption[] }[] = [
    { head: 'Running now', items: others.filter((p) => p.live) },
    { head: 'Recently used', items: others.filter((p) => !p.live) }
  ]
  return (
    <Sheet label="Move to project" onClose={props.onClose} className="action-sheet">
      <p className="action-title">{props.title}</p>
      <p className="action-note">
        {props.current ? <>In {props.current}. </> : null}
        {props.live ? 'Moving restarts the session in the new directory.' : 'It will open in the new directory next time.'}
      </p>
      <div role="menu" className="action-list project-list">
        {sections.map((s) =>
          s.items.length === 0 ? null : (
            <Fragment key={s.head}>
              <div className="menu-head" role="presentation">
                {s.head}
              </div>
              {s.items.map((p) => (
                <button key={p.name} role="menuitem" onClick={() => props.onPick(p.name)}>
                  {p.name}
                </button>
              ))}
            </Fragment>
          )
        )}
        {others.length === 0 && <p className="action-note">No other project on this server yet.</p>}
      </div>
      <div className="row">
        <button type="button" className="quiet" onClick={props.onClose}>
          Cancel
        </button>
      </div>
    </Sheet>
  )
}
