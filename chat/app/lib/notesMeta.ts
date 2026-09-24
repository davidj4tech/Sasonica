/**
 * What the server says the Organiser should offer (§6.10 `GET /notes`): the
 * TODO keywords, the places a heading can move to, which files take changes,
 * and where a capture lands. The tree may be paragtd's or plain Org with its
 * own keywords, so none of this is hard-coded here any more.
 *
 * One copy for the whole app. The Organiser's list page fetches /notes and
 * calls `setNotesMeta`; anything else that needs it (the note page, Home's
 * agenda) calls `useNotesMeta`, which fetches once if nothing has yet. A
 * server from before these fields answers without them, and gets paragtd's
 * lists, which is what that server was.
 */
import { useEffect, useState } from 'react'
import { getNoteViews, type NotesIndex, type NoteStates, type RefileTargetInfo } from '../api/notes'

export interface NotesMeta {
  profile: string | null
  captureFile: string
  /** The keywords of a file that declares none. */
  states: NoteStates
  refileTargets: RefileTargetInfo[]
  /** Path → that file's keywords, for the file views. */
  fileStates: Record<string, NoteStates>
  /** The files that take changes: the file views and the capture file. */
  editable: Set<string>
}

const PARAGTD_STATES: NoteStates = { open: ['TODO', 'NEXT', 'WAITING', 'SOMEDAY'], done: ['DONE', 'CANCELLED', 'CANCELED'] }

const PARAGTD_TARGETS: RefileTargetInfo[] = [
  { name: 'next', label: 'Next actions', path: 'next-actions.org' },
  { name: 'waiting', label: 'Waiting for', path: 'waiting-for.org' },
  { name: 'tickler', label: 'Tickler', path: 'tickler.org', needs_date: true },
  { name: 'someday', label: 'Someday', path: 'someday.org' },
  { name: 'projects', label: 'Projects', path: 'projects.org' },
  { name: 'inbox', label: 'Inbox', path: 'inbox.org' }
]

/** Before /notes has answered, and for a server that predates the fields. */
export const FALLBACK: NotesMeta = {
  profile: 'paragtd',
  captureFile: 'inbox.org',
  states: PARAGTD_STATES,
  refileTargets: PARAGTD_TARGETS,
  fileStates: {},
  editable: new Set([...PARAGTD_TARGETS.map((t) => t.path), 'areas.org', 'routines.org'])
}

let current: NotesMeta | null = null
let inflight: Promise<void> | null = null
const listeners = new Set<(m: NotesMeta) => void>()

export function metaOf(res: NotesIndex): NotesMeta {
  if (!res.states) {
    // An older server: its layout was paragtd's, whatever views it listed.
    return FALLBACK
  }
  const fileStates: Record<string, NoteStates> = {}
  const editable = new Set<string>([res.capture_file || 'inbox.org'])
  for (const v of res.views) {
    if (v.kind !== 'file' || !v.path) continue
    editable.add(v.path)
    if (v.states) fileStates[v.path] = v.states
  }
  return {
    profile: res.profile ?? null,
    captureFile: res.capture_file || 'inbox.org',
    states: res.states,
    refileTargets: res.refile_targets || [],
    fileStates,
    editable
  }
}

export function setNotesMeta(res: NotesIndex): NotesMeta {
  current = metaOf(res)
  for (const l of listeners) l(current)
  return current
}

/** The latest meta, or the fallback when nothing has been fetched. */
export function notesMeta(): NotesMeta {
  return current || FALLBACK
}

export function useNotesMeta(): NotesMeta {
  const [meta, setMeta] = useState<NotesMeta>(notesMeta)
  useEffect(() => {
    listeners.add(setMeta)
    if (!current && !inflight) {
      inflight = getNoteViews()
        .then((res) => void setNotesMeta(res))
        .catch(() => undefined)
        .finally(() => {
          inflight = null
        })
    }
    return () => void listeners.delete(setMeta)
  }, [])
  return meta
}

/** A file's keywords: its own when the server listed them, else the default. */
export function statesOf(meta: NotesMeta, path: string): NoteStates {
  return meta.fileStates[path] || meta.states
}

/** Every done keyword the server has mentioned, for items from any file. */
export function doneWords(meta: NotesMeta): Set<string> {
  const out = new Set(meta.states.done)
  for (const s of Object.values(meta.fileStates)) for (const w of s.done) out.add(w)
  return out
}

/** Every keyword the server has mentioned, for telling a state from a title word. */
export function knownStates(meta: NotesMeta = notesMeta()): Set<string> {
  const out = new Set([...meta.states.open, ...meta.states.done])
  for (const s of Object.values(meta.fileStates)) for (const w of [...s.open, ...s.done]) out.add(w)
  return out
}

/** An open heading that can be ticked off from a list. */
export function canMarkDone(meta: NotesMeta, h: { state: string; path: string }): boolean {
  return !!h.state && !doneWords(meta).has(h.state) && meta.editable.has(h.path)
}

/** The keyword "✓ Done" writes in this file. */
export function doneWordOf(meta: NotesMeta, path: string): string {
  const done = statesOf(meta, path).done
  return done.includes('DONE') ? 'DONE' : done[0] || 'DONE'
}
