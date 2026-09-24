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
  /** A file's TODO keywords. An older server leaves it out. */
  states?: NoteStates
}

/** A file's TODO keywords, as Org splits them. */
export interface NoteStates {
  open: string[]
  done: string[]
}

/** Somewhere a heading can be moved to. `needs_date`: it is SCHEDULED on a date (the tickler). */
export interface RefileTargetInfo {
  name: string
  label: string
  path: string
  needs_date?: boolean
}

/** GET /notes. Everything after `views` is new; an older server leaves it out (lib/notesMeta.ts falls back). */
export interface NotesIndex {
  root: string
  views: NoteView[]
  profile?: string | null
  capture_file?: string
  states?: NoteStates
  refile_targets?: RefileTargetInfo[]
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
  /** The heading's keyword, and the file's keywords. An older server leaves them out. */
  state?: string
  states?: NoteStates
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
  return request<NotesIndex>('GET', '/notes', undefined, signal)
}

/** `done` keeps the DONE and cancelled headings the server otherwise drops. */
export function getNoteView(name: string, opts: { done?: boolean; signal?: AbortSignal } = {}) {
  return request<{ view: string; items: NoteItem[] }>('GET', `/notes/view?name=${q(name)}${opts.done ? '&done=1' : ''}`, undefined, opts.signal)
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

/** A keyword of the heading's file (lib/notesMeta.ts); `''` takes the keyword off. */
export type NoteState = string

export interface StateChanged {
  path: string
  /** Where the heading is now (a CLOSED line can move what follows). */
  at: number
  state: string
  /** A repeating item: not closed, moved on to `next`. */
  repeated: boolean
  next?: string
}

/** A refile target's name, from GET /notes `refile_targets`. */
export type RefileTarget = string

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

export interface PriorityChanged {
  path: string
  at: number
  /** "A" | "B" | "C", or "" for none. */
  priority: string
}

/**
 * REAL on the server: writes or takes off the heading's [#A]/[#B]/[#C]
 * cookie. An [#A] with a clock time is read aloud at that time. Test on the mock.
 */
export function setNotePriority(path: string, at: number, title: string, priority: string) {
  return request<PriorityChanged>('POST', '/notes/priority', { path, at, title, priority })
}
