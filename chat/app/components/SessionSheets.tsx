/**
 * The thread's actions as sheets: the list's long-press menu (Share into…, Rename,
 * Auto rename, Move to project…, Exit session, Exit & archive, Archive / Unarchive); an exit
 * asks no confirmation (a send resumes it). The thread header's ⋮ menu offers the
 * same items (sessionMenuItems), so both places say the same thing.
 *
 * Move opens the project picker below. It says up front that a running session
 * restarts (§6.15: the agent cannot change directory mid-session), because that
 * is the one thing about it nobody would guess.
 */
import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { candidates, matching, type RefCandidate } from '../lib/refs'
import type { ProjectOption } from '../lib/threadSort'
import type { SpeechLevel } from '../api/types'
import { useScrim } from '../lib/layers'
import { createPortal } from 'react-dom'

export type SessionAction = 'share' | 'rename' | 'auto-rename' | 'move' | 'speech' | 'exit' | 'archive' | 'unarchive' | 'exit-archive'

export const ACTION_LABEL: Record<SessionAction, string> = {
  share: 'Share into…',
  rename: 'Rename…',
  'auto-rename': 'Auto rename',
  move: 'Move to project…',
  speech: 'Speech…',
  exit: 'Exit session',
  archive: 'Archive',
  unarchive: 'Unarchive',
  'exit-archive': 'Exit & archive'
}

/**
 * What a thread offers: its speech level, exit only while it runs, the pair when
 * it runs and is not archived, and Unarchive last. A running thread has no plain
 * Archive (David, 24 Sep 2026): archiving ends nothing, so it only hid a session
 * that went on working; Exit & archive is the way to file one that runs.
 */
export function sessionMenuItems(live: boolean, archived: boolean): SessionAction[] {
  const items: SessionAction[] = ['share', 'rename', 'auto-rename', 'move', 'speech']
  if (live) items.push('exit')
  if (live && !archived) items.push('exit-archive')
  if (archived) items.push('unarchive')
  else if (!live) items.push('archive')
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

/**
 * Share into…: where a chip for this thread goes (lib/refs.ts) — a new chat,
 * or another thread, found by typing a few letters of its title. The chip
 * lands at the end of that thread's draft and the thread opens, so the words
 * around it are the reader's to write.
 */
export function ShareSheet(props: { title: string; session: string; onPick: (to: RefCandidate | 'new') => void; onClose: () => void }) {
  const [rows, setRows] = useState<RefCandidate[]>([])
  const [query, setQuery] = useState('')
  useEffect(() => {
    let live = true
    void candidates().then((all) => live && setRows(all.filter((r) => r.session !== props.session)))
    return () => {
      live = false
    }
  }, [props.session])
  const hits = matching(rows, query, 40)
  return (
    <Sheet label="Share into" onClose={props.onClose} className="action-sheet share-sheet">
      <p className="action-title">Share “{props.title}” into…</p>
      <input
        className="share-find"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Find a thread"
        aria-label="Find a thread"
        enterKeyHint="search"
      />
      <div role="menu" className="action-list project-list">
        <button role="menuitem" onClick={() => props.onPick('new')}>
          New chat
        </button>
        {hits.map((r) => (
          <button key={r.session} role="menuitem" onClick={() => props.onPick(r)}>
            <span className="share-title">{r.title}</span>
            {r.project && <span className="share-project">{r.project}</span>}
          </button>
        ))}
        {rows.length > 0 && hits.length === 0 && <p className="action-note">No thread by that name.</p>}
      </div>
      <div className="row">
        <button type="button" className="quiet" onClick={props.onClose}>
          Cancel
        </button>
      </div>
    </Sheet>
  )
}

/** The four speech levels (§6.4 /session/priority), with what each does to a reply. */
export const SPEECH_LEVELS: { level: SpeechLevel; label: string; note: string; badge?: string }[] = [
  { level: 'interrupt', label: 'Interrupt', note: 'Plays at once, cutting in on another chat at its next sentence', badge: 'Interrupts' },
  { level: 'auto', label: 'Auto speak', note: 'Plays at once, even when muted or held at the desk', badge: 'Auto speak' },
  { level: 'normal', label: 'Normal', note: 'The usual rules' },
  { level: 'quiet', label: 'Quiet', note: 'Never plays by itself; waits here with a Play', badge: 'Quiet' }
]

export function SpeechSheet(props: { current: SpeechLevel; onPick: (level: SpeechLevel) => void; onClose: () => void }) {
  return (
    <Sheet label="Speech" onClose={props.onClose} className="action-sheet speech-sheet">
      <p className="action-title">Speech — what its replies do</p>
      <div role="menu" className="action-list">
        {SPEECH_LEVELS.map((s) => (
          <button key={s.level} role="menuitemradio" aria-checked={props.current === s.level} className={props.current === s.level ? 'on' : ''} onClick={() => props.onPick(s.level)}>
            {s.label}
            <small>{s.note}</small>
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
