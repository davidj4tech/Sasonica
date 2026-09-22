/**
 * The notes calls (server-contract.md §6.10): the Org tree on the server,
 * browsed, searched, captured into and read aloud, plus the setup checklist
 * that gets it there. A module of its own so the thread calls in ./index.ts
 * stay as they were; it shares their `request` and error.
 */
import { request } from './index'
import type { AskResponse } from './types'

export type NoteViewKind = 'agenda' | 'file' | 'folder'

export interface NoteView {
  name: string
  label: string
  kind: NoteViewKind
  /** Open TODO-like headings (file) or notes (folder); none for the agenda. */
  count?: number
  path?: string
}

/** A heading in a GTD file, or an agenda entry (which adds `date`, `overdue`). */
export interface NoteHeading {
  path: string
  /** 1-based line of the heading: what /notes/read?at= takes. */
  at: number
  level: number
  state: string
  priority: string
  title: string
  tags: string[]
  scheduled?: string
  deadline?: string
  date?: string
  overdue?: boolean
}

/** A note in a roam folder. */
export interface NoteFile {
  path: string
  title: string
  /** Epoch seconds. */
  modified: number
}

export type NoteItem = NoteHeading | NoteFile

export function isHeading(item: NoteItem): item is NoteHeading {
  return 'at' in item
}

export interface NoteText {
  path: string
  at: number
  title: string
  /** Raw Org. */
  text: string
  links: { label: string; path: string }[]
  /** Chats started about it (POST /notes/ask), newest first; an older server leaves it out. */
  chats?: NoteChat[]
}

/** A chat about a note: the session, and the words that started it. */
export interface NoteChat {
  session: string
  title: string
  /** Epoch seconds. */
  at: number
}

export interface NoteHit {
  path: string
  line: number
  text: string
}

export interface MemoryHit {
  id: string
  user: string
  score: number | null
  text: string
}

export interface SearchResult {
  q: string
  notes: NoteHit[]
  memories: MemoryHit[]
}

export type CaptureKind = 'todo' | 'note'

export interface Captured {
  path: string
  at: number
  kind: CaptureKind
  remembered: boolean
}

export type SetupState = 'ok' | 'missing' | 'off' | 'down'

export interface SetupComponent {
  name: 'org' | 'sync' | 'memory' | 'paragtd'
  label: string
  state: SetupState
  detail: string
  why: string | null
  actions: string[]
  optional: boolean
}

export interface SetupStatus {
  components: SetupComponent[]
  search: 'ripgrep' | 'built-in'
}

/** A quick action answers `done`; a long one opens a window to watch. */
export interface SetupRun {
  component: string
  action: string
  done?: boolean
  created?: string[]
  pane?: string
  cmd?: string
}

/** A setup window, as /harnesses/screen shows it (§6.6). */
export interface SetupScreen {
  pane: string
  cmd: string
  lines: string[]
  done: boolean
  exit: number | null
}

const q = encodeURIComponent

export function getNoteViews(signal?: AbortSignal) {
  return request<{ root: string; views: NoteView[] }>('GET', '/notes', undefined, signal)
}

export function getNoteView(name: string, signal?: AbortSignal) {
  return request<{ view: string; items: NoteItem[] }>('GET', `/notes/view?name=${q(name)}`, undefined, signal)
}

export function readNote(path: string, at = 0, signal?: AbortSignal) {
  return request<NoteText>('GET', `/notes/read?path=${q(path)}${at ? `&at=${at}` : ''}`, undefined, signal)
}

export function searchNotes(text: string, opts: { all?: boolean; signal?: AbortSignal } = {}) {
  return request<SearchResult>('GET', `/notes/search?q=${q(text)}${opts.all ? '&all=1' : ''}`, undefined, opts.signal)
}

/** REAL on the server: appends to inbox.org and writes a memory. Test on the mock. */
export function captureNote(text: string, kind: CaptureKind = 'todo') {
  return request<Captured>('POST', '/notes/capture', { text, kind })
}

/** REAL on the server: the voice reads it out. Test on the mock. */
export function sayNote(path: string, at = 0) {
  return request<{ title: string; chars: number }>('POST', '/notes/say', at ? { path, at } : { path })
}

/**
 * REAL on the server: opens a session in the notes tree, the item named in
 * its first message — what /ask {target: "new"} answers. Test on the mock.
 */
export function askNote(path: string, at: number, text: string) {
  return request<AskResponse>('POST', '/notes/ask', at ? { path, at, text } : { path, text })
}

export function getNotesSetup(signal?: AbortSignal) {
  return request<SetupStatus>('GET', '/notes/setup', undefined, signal)
}

/** REAL on the server: creates files, enables a timer, or runs a clone. */
export function runNotesSetup(component: string, action: string) {
  return request<SetupRun>('POST', '/notes/setup', { component, action })
}

export function getSetupScreen(pane: string, signal?: AbortSignal) {
  return request<SetupScreen>('GET', `/harnesses/screen?pane=${q(pane)}`, undefined, signal)
}

/** Type into a setup window: a line of text, or one named key (`Enter`, `C-c`). */
export function setupKeys(pane: string, input: { text?: string; key?: string }) {
  return request<{ pane: string }>('POST', '/harnesses/keys', { pane, ...input })
}

export function closeSetupWindow(pane: string) {
  return request<{ pane: string }>('POST', '/harnesses/close', { pane })
}

// ── Changing a heading (§6.10: /notes/state, /notes/refile, /notes/date) ──

/** The states the app offers; `''` takes the keyword off. */
export type NoteState = '' | 'TODO' | 'NEXT' | 'WAITING' | 'SOMEDAY' | 'DONE' | 'CANCELLED'

export interface StateChanged {
  path: string
  /** Where the heading is now (a CLOSED line can move what follows). */
  at: number
  state: string
  /** A repeating item: not closed, moved on to `next`. */
  repeated: boolean
  next?: string
}

export type RefileTarget = 'next' | 'waiting' | 'tickler' | 'someday' | 'projects' | 'inbox'

export const REFILE_LABELS: Record<RefileTarget, string> = {
  next: 'Next actions',
  waiting: 'Waiting for',
  tickler: 'Tickler (on a date)',
  someday: 'Someday',
  projects: 'Projects',
  inbox: 'Inbox'
}

/** The file each target is; a heading already there is not offered it. */
export const REFILE_FILES: Record<RefileTarget, string> = {
  next: 'next-actions.org',
  waiting: 'waiting-for.org',
  tickler: 'tickler.org',
  someday: 'someday.org',
  projects: 'projects.org',
  inbox: 'inbox.org'
}

/** The GTD files at the top of the tree: the only ones that take changes (the server holds the same line). */
const EDITABLE = new Set([...Object.values(REFILE_FILES), 'areas.org', 'routines.org'])

export function isEditable(path: string): boolean {
  return EDITABLE.has(path)
}

/**
 * REAL on the server: rewrites the heading in the file. `at` + `title` find
 * it even if lines moved; 409 when it is gone. Test on the mock.
 */
export function setNoteState(path: string, at: number, title: string, state: NoteState) {
  return request<StateChanged>('POST', '/notes/state', { path, at, title, state })
}

/** REAL on the server: moves the subtree to another file. Test on the mock. */
export function refileNote(path: string, at: number, title: string, to: RefileTarget, date?: string) {
  return request<{ path: string; at: number; to: RefileTarget }>('POST', '/notes/refile', { path, at, title, to, ...(date ? { date } : {}) })
}

export type DateKind = 'scheduled' | 'deadline'

export interface DateChanged {
  path: string
  at: number
  kind: DateKind
  /** YYYY-MM-DD, or `''` when the stamp was taken off. */
  date: string
  /** HH:MM, or `''` for none. */
  time: string
}

/**
 * REAL on the server: rewrites the heading's SCHEDULED or DEADLINE stamp,
 * keeping its repeater. Leave `time` out to keep the stamp's time, `''` to
 * drop it; an empty `date` takes the stamp off. Test on the mock.
 */
export function setNoteDate(path: string, at: number, title: string, kind: DateKind, date: string, time?: string) {
  return request<DateChanged>('POST', '/notes/date', { path, at, title, kind, date, ...(time !== undefined ? { time } : {}) })
}
