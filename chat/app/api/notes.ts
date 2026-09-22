/**
 * The notes calls (server-contract.md §6.10): the Org tree on the server,
 * browsed, searched, captured into and read aloud, plus the setup checklist
 * that gets it there. A module of its own so the thread calls in ./index.ts
 * stay as they were; it shares their `request` and error.
 */
import { request } from './index'

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
