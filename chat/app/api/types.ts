/**
 * The canvas's app contract, v0 — transcribed from
 * agent-media/docs/server-contract.md §6 (21 Sep 2026).
 *
 * Every v1 change (§8–§13) lands here and in ./index.ts:
 *  - DONE (§10, built 22 Sep 2026): threads keyed by session on
 *    /conversation/log, /reply, /ask (`player_session`); the app sends no item
 *  - DONE (§9): device tokens (`POST /pair`, see ./auth.ts)
 *  - the ABS-shaped fields (`start`/`end`, `item`, `scanning`, `tail`) go at
 *    the ABS exit; they are kept here, unread, until then
 *  - a machine `code` on every error (§13)
 *
 * Notes against the live canvas (red5, read-only GETs, 21 Sep 2026) are
 * marked REALITY.
 */

/** A session id: a uuid, or Hermes's `YYYYMMDD_HHMMSS_hex` (§5). */
export type SessionId = string

/**
 * An ABS library item id. §5 says `li_…`; REALITY: red5's items are plain
 * uuids (e.g. `86f16f1e-…`). Treat it as opaque.
 */
export type ItemId = string

export interface Envelope {
  ok: boolean
  error?: string
}

// ── §6.1 Threads ──────────────────────────────────────────────────────────

/** One row of /targets.sessions (and /conversations). */
export interface SessionRow {
  session: SessionId
  title: string
  live: boolean
  /** tmux `%23` or `herdr:<id>`; display and /focus only, never a key. */
  pane: string | null
  /** Only on shelved (not live) rows: the manifest's mtime, epoch seconds. */
  at?: number
  /** Filed under Archived (§6.1, 22 Sep 2026). The row stays in /targets; the app files it. */
  archived?: boolean
  /** Closed by the idle reaper, `{at, reason}`; always null on a live row. */
  rested?: { at: number; reason: string } | null
  /** Kept open against the idle reaper (POST /session/pin). */
  pinned?: boolean
  /** "Where this thread was" (§6.1 Recaps), or null. */
  recap?: Recap | null
  /** The project it runs in, for display (§6.1, 22 Sep 2026), or null. */
  project?: string | null
  /** Its working directory, or null. */
  cwd?: string | null
  /** Which agent holds it (§6.16, 23 Sep 2026). */
  harness?: Harness
  /** `"store"` when the conversation is known only from its harness's own
   *  store: it never spoke and is not running (§6.16). */
  source?: string
}

/** The coding agents a conversation can belong to (§6.16). */
export type Harness = 'claude' | 'codex' | 'pi' | 'hermes'

/** A recap (§6.1): Claude Code's "while you were away", or the reaper's own. */
export interface Recap {
  text: string
  at: number
  source: 'claude' | 'agent-media' | string
}

/** A directory a new chat may be opened in. */
export interface Place {
  name: string
  path: string
  at: number
}

export interface TargetsResponse extends Envelope {
  sessions: SessionRow[]
  places: Place[]
}

export type SessionState = 'working' | 'waiting' | 'approval'

export interface SessionStateRow {
  session: SessionId
  /** `<project>/<title>` of the item folder — ABS-specific; `""` if none. */
  tail: string
  state: SessionState
  /** The session's title, as /targets would give it — for a notice about a session the last /targets never listed. Older servers leave it out. */
  title?: string
}

export interface SessionsStateResponse extends Envelope {
  /** Only live sessions. Absent means not live. */
  sessions: SessionStateRow[]
}

// ── §6.2 One conversation ─────────────────────────────────────────────────

/** GET /conversation?session= — not asked by the app since §10 (the log answers by session). */
export interface SessionConversation extends Envelope {
  session: SessionId
  /** Fills in once ABS has the item AND has built its tracks. */
  item: ItemId | null
  /** The item exists but has no tracks yet — do not navigate to it. */
  scanning: boolean
  live: boolean
  pane: string | null
  resumable: boolean
  /** §10: the ghost suggestion, as on /conversation?item=. */
  suggestion?: string
}

/** GET /conversation?item= */
export interface ItemConversation extends Envelope {
  session: SessionId
  live: boolean
  pane: string | null
  resumable: boolean
  suggestion: string
}

export interface AskOption {
  label: string
  description?: string
}

/** One AskUserQuestion question, as asked. */
export interface AskQuestion {
  question: string
  /** The short chip Claude gives each question (approvals carry it). */
  header?: string
  options: AskOption[]
  multiSelect: boolean
}

/** What the turn did before this reply. */
export interface WorkSummary {
  seconds: number
  count: number
  steps: string[]
}

/** A line of /conversation/log (§6.2 "A line"). */
export interface Line {
  who: 'you' | 'agent'
  text: string
  /** Epoch seconds, 3 dp. The line's identity — kept live → finished. */
  at: number
  /** The reply's dedup key; `""` for the listener. */
  key: string
  /** Seconds into the ABS audio item — ABS-specific; always null on `?session=` (§10). */
  start: number | null
  end: number | null
  /** Speech-history row id, only on lines that were spoken. */
  id?: number
  ask?: AskQuestion[]
  /**
   * The chip for a slash command typed from the box. The contract does not
   * give its shape; W reads `{text}`. Not seen live on 21 Sep 2026.
   */
  command?: { text?: string; [k: string]: unknown } | null
  images?: string[]
  figure?: boolean
  work?: WorkSummary

  // The live line only (at most one):
  live?: boolean
  sentences?: string[]
  sentence?: number | null
  offsets?: number[]
  /** Seconds since the reply started, as of `server_time`. */
  elapsed?: number
  server_time?: number
  /** Playout delay to subtract. */
  delay?: number
  paused?: boolean
}

/** The running turn (§6.2 `working`). */
export interface Working {
  since: number
  count: number
  current: string
  current_at: number | null
  /** The latest few, newest last. */
  steps: string[]
  server_time: number
}

export interface ApprovalOption {
  n: number
  label: string
  detail: string
  /** A multi-select's checkbox as it is on screen now. */
  checked?: boolean
}

/** One option of a question approval (numbered from 1 within its question). */
export interface QuestionOption {
  n: number
  label: string
  description: string
  detail?: string
  checked?: boolean
}

/** One question of an AskUserQuestion approval. */
export interface ApprovalQuestion {
  question: string
  header: string
  multiSelect: boolean
  /** An "Other" row: the person's own words are an answer too. */
  free_text?: boolean
  options: QuestionOption[]
}

/** A structured answer to one question (§6.4). */
export interface QuestionAnswer {
  question_index: number
  /** Option `n` values; at most one for a single-select question. */
  selected: number[]
  other_text?: string
}

/** The dialog a session is stopped on, read off the screen (§6.2 `approval`). */
export interface Approval {
  /** `""` when the top of the dialog is off screen. */
  question: string
  /** Some numbers scrolled away. */
  partial: boolean
  options: ApprovalOption[]
  /** 12 hex chars: sha1 of the dialog text. */
  key: string
  agent: string
  /** `"question"` for an AskUserQuestion; `"tool"` for a headless permission request; absent for a pane's other dialogs. */
  kind?: 'question' | 'tool'
  /** Any question takes several answers. */
  multiSelect?: boolean
  free_text?: boolean
  /** The questions, as asked, when `kind` is `"question"`. */
  questions?: ApprovalQuestion[]
  tool_use_id?: string
  /** Headless only: the CLI's request id, echoed as `request_id`. */
  id?: string
}

// ── §6.2.2 Messages (built 22 Sep 2026) ──────────────────────────────────

/** The §6.2 live-line fields, carried on `spoken.live` and the `live` event. */
export interface LiveFields {
  sentences: string[]
  sentence: number | null
  offsets: number[]
  /** Seconds since the reply started, as of `server_time`. */
  elapsed: number
  server_time: number
  delay: number
  paused: boolean
}

export interface TextPart {
  type: 'text'
  /** Raw, as the transcript has it: markdown and `[[visual:]]` markers included (REALITY, red5 22 Sep 2026). */
  text: string
}
export interface ReasoningPart {
  type: 'reasoning'
  /** `""` when redacted (~90 % on red5: signature-only thinking). */
  text: string
  redacted: boolean
}
export interface ToolPart {
  type: 'tool'
  name: string
  /** The step in plain English (what `working.steps` says). */
  title: string
  /** ≤ 300 chars. */
  input_summary: string
  status: 'running' | 'done' | 'error'
  /** ≤ 300 chars; Read says "N lines". */
  result_summary: string
  tool_use_id: string
}
export interface AskPart {
  type: 'ask'
  ask: AskQuestion[]
  status: string
  /** The chosen label(s); `""` for the reshaped harnesses. */
  answer: string
  tool_use_id: string
}
export type MessagePart = TextPart | ReasoningPart | ToolPart | AskPart

/** This message's speech (§6.2.2 `spoken`). */
export interface Spoken {
  /** History row for `replay-id`; null while it plays for the first time. */
  id: number | null
  key: string
  at: number
  images?: string[]
  figure?: boolean
  /** Only while it plays. */
  live?: LiveFields
  /**
   * The newest spoken turn's timeline when it is NOT playing (§6.2). No
   * `elapsed`: it says where the words are, not that anything is saying
   * them. `live` and this are exclusive. Paired with `/speech/now`'s `turn`
   * and `pos`, it is what keeps the bold alive when the live row is gone.
   */
  timeline?: Timeline
}

/** A turn's words and where each begins, with no claim to be playing. */
export interface Timeline {
  sentences: string[]
  offsets: number[]
  /** Measured by the player; `false` means apportioned from clip lengths. */
  measured: boolean
}

/** One message read from the agent's transcript (§6.2.2). */
export interface Message {
  /** Transcript uuid of its first record — stable as it grows. Other harnesses: `line:<at>`. */
  id: string
  role: 'user' | 'assistant'
  at: number
  parts: MessagePart[]
  spoken: Spoken | null
  turn: { running: boolean }
  /** User messages that are a slash command only. */
  command?: { name?: string; args?: string; text?: string; [k: string]: unknown } | null
  /** Another session's message delivered into this one (§6.2.2): not the listener's words. */
  peer?: { name: string } | null
}

export interface Recap {
  text: string
  at: number
  source: string
}

export interface ConversationLog extends Envelope {
  session: SessionId
  /** Deprecated (§6.2, 22 Sep 2026); still read by the pending-send matcher only when `messages` is absent. */
  lines: Line[]
  /** Only with `?messages=1` on the polled log; always in the stream's snapshot. */
  messages?: Message[]
  /** Messages exist before `messages[0]`: ask with `?before=<messages[0].id>`. */
  older?: boolean
  pending: boolean
  working: Working | null
  approval: Approval | null
  suggestion: string
  recap?: Recap | null
  /** With `?around=` (§6.14 jump): whether that message was found, and whether the thread goes on past this page. */
  around?: { id: string; found: boolean; newer: boolean }
  newer?: boolean
}

// ── §6.14 Search ──────────────────────────────────────────────────────────

/** A piece of text with where the query matched in it (character offsets). */
export interface Snippet {
  text: string
  match: [number, number][]
}

/** The thread a hit belongs to, as the list names it. */
export interface SearchThreadRef {
  title: string
  project: string | null
  harness: string
  live: boolean
  archived: boolean
}

export interface SearchThreadHit extends SearchThreadRef {
  session: SessionId
  recap: string | null
  at: number | null
  /** Offsets per field that matched: title, recap, project. */
  match: Partial<Record<'title' | 'recap' | 'project', [number, number][]>>
}

export interface SearchMessageHit {
  session: SessionId
  /** The §6.2.2 message id — what `/conversation/log?around=` takes. */
  message: string
  role: 'user' | 'assistant'
  at: number
  /** `tool` only with `tools=1` (the Advanced setting). */
  kind: 'text' | 'tool'
  snippet: Snippet
  thread: SearchThreadRef
}

export interface MemoryHit {
  id: string
  user: string
  score: number | null
  text: string
}

export interface SearchResponse extends Envelope {
  q: string
  /** How `q` was read: highlight these in the thread after a jump. */
  terms: string[]
  tools: boolean
  threads: SearchThreadHit[]
  messages: SearchMessageHit[]
  /** Ask again with `before=<next>` for the next page; null at the end. */
  next: number | null
  /** The index is still catching up: the newest words may be missing. */
  indexing: boolean
  /** First page only; `available: false` when this host has no agent-memory. */
  memory?: { available: false } | { available: true; items: MemoryHit[]; error?: string }
}

// ── §11 The per-thread stream ─────────────────────────────────────────────

export type ThreadState = 'working' | 'waiting' | 'approval' | 'ended'

/**
 * The first frame on every connection: the log envelope (default page) plus
 * the session's state. NB `live` here is "the session is live" (a bool),
 * not the follow-along — that rides on the messages' `spoken.live`.
 * REALITY (red5, 22 Sep 2026): no `ok` field; ~390 KB for a busy thread, not
 * compressed.
 */
export interface ThreadSnapshot extends Omit<ConversationLog, 'ok'> {
  state: ThreadState
  live: boolean
  pane: string | null
  resumable: boolean
  /** Background agents (§6.12): how many are running, of how many. */
  agents?: AgentCounts
  /** The project it runs in, for display (§6.1, 22 Sep 2026), or null. */
  project?: string | null
  /** Its working directory, or null. */
  cwd?: string | null
}

/** The `live` event: the message being spoken, by id, or null. */
export type LiveEvent = (LiveFields & { id: string; at: number }) | null

export interface StateEvent {
  state: ThreadState
  live: boolean
  pane: string | null
}

export type ThreadEvent =
  | { type: 'snapshot'; data: ThreadSnapshot }
  | { type: 'message'; data: { op: 'append' | 'replace'; message: Message } }
  | { type: 'live'; data: LiveEvent }
  | { type: 'working'; data: Working | null }
  | { type: 'approval'; data: Approval | null }
  | { type: 'suggestion'; data: { text: string } }
  | { type: 'state'; data: StateEvent }
  | { type: 'recap'; data: Recap | null }
  | { type: 'agents'; data: AgentCounts }
  | { type: 'ping'; data: Record<string, never> }

// ── §6.12 Background agents ───────────────────────────────────────────────

export interface AgentCounts {
  running: number
  total: number
}

export type AgentStatus = 'running' | 'done' | 'failed' | 'stopped'

/** One subagent of a thread (Claude Code's `<session>/subagents/agent-<id>`). */
export interface AgentRow {
  id: string
  description: string
  agent_type: string
  is_fork: boolean
  /** Another agent's id, or null: spawned by the thread itself. */
  parent_id: string | null
  /** 1 = spawned by the thread. */
  depth: number
  started_at: number
  ended_at: number | null
  status: AgentStatus
  /** The step in progress, only while running. */
  current_step: string | null
  /** Tool calls so far. */
  steps: number
  last_at: number
}

export interface AgentsResponse extends Envelope {
  session: SessionId
  counts: AgentCounts
  /** In start order. */
  agents: AgentRow[]
}

export interface AgentLogResponse extends Envelope {
  session: SessionId
  agent: AgentRow
  messages: Message[]
  older: boolean
}

/**
 * `GET /draft?session=` · `POST /draft {session, text, at}`: half a reply,
 * kept server-side. `at` is the writer's clock (epoch s), stored as given;
 * empty text deletes; a missing draft is `{text: "", at: 0}`. Capped at 8192
 * characters.
 */
export interface DraftResponse extends Envelope {
  session: SessionId
  text: string
  at: number
}

// ── §6.3 Sending ──────────────────────────────────────────────────────────

/** POST /reply — by session (§10). `item` is the v0 form, no longer sent. */
export interface ReplyRequest {
  session: SessionId
  text: string
  quote?: string
  mode?: 'continue' | 'branch'
}

export interface ReplyResponse extends Envelope {
  session: SessionId
  pane: string | null
  /** A window was revived: say "opening", not "sent". */
  opened: boolean
  /** false (with 502) = typed into the composer but never taken. */
  submitted: boolean
  branched?: boolean
}

export type Agent = 'claude' | 'codex' | 'pi' | 'hermes'

/** One harness on the server, as GET /harnesses (§6.6) reports it. */
export interface HarnessRow {
  name: Agent
  /** On this host's PATH: a chat can be started with it. */
  present: boolean
  path: string | null
  version: string
  /** Only Claude and Codex will say; pi and Hermes are honestly "unknown". */
  auth: 'in' | 'out' | 'unknown'
  account: string
  /** The buttons worth showing: what the host has a recipe for. `logout`
   *  only where `auth` is already `in`. */
  actions: ('install' | 'login' | 'logout')[]
  /** An install of something already here is an update. */
  installed_action: 'install' | 'update'
}

export interface HarnessesResponse extends Envelope {
  agents: HarnessRow[]
}

/** POST /harnesses/run: the window it opened, to watch with /harnesses/screen. */
export interface HarnessRun extends Envelope {
  pane: string
  agent: Agent
  action: 'install' | 'login'
  cmd: string
}

/** One row of GET /harnesses/updates (§6.6): is something newer out? */
export interface HarnessUpdate {
  name: Agent
  /** The version here, as a bare number ("0.155.1"). */
  installed: string
  /** The newest published one, or "" for the one that is not a package. */
  latest: string
  /** `null` is "nobody could say" — never render it as up to date. */
  behind: boolean | null
  /** What the agent's own check said, when that is how it answered. */
  line: string
  checked_at: number
}

export interface HarnessUpdates extends Envelope {
  updates: HarnessUpdate[]
}

/** POST /harnesses/logout: it ran and exited; no window to watch. */
export interface HarnessLogout extends Envelope {
  agent: Agent
  cmd: string
  exit: number
  lines: string[]
  /** What the host says now, re-read after the command. */
  auth: 'in' | 'out' | 'unknown'
}

export interface AskRequest {
  text: string
  /** A session id, or "new" to force a fresh session. */
  target?: SessionId | 'new'
  /** §10: the session the player is on; routes as `how: "player"`. */
  player_session?: SessionId
  sticky?: SessionId
  parse?: boolean
  dry?: boolean
  agent?: Agent
  project?: string
  /** Must be one of /targets.places. */
  cwd?: string
}

export interface AskResponse extends Envelope {
  mode: 'new' | 'continued' | 'switched'
  how: 'picked' | 'asked' | 'spoken' | 'player' | 'sticky' | 'default' | string
  dry?: boolean
  /** null on a fresh Claude session whose id had not registered in 10 s. */
  session: SessionId | null
  title: string
  item?: ItemId | null
  text: string
  pane?: string | null
  opened?: boolean
  fresh?: boolean
  tmux?: string
  agent?: Agent
  submitted?: boolean
}

/** 300 from /ask: nothing was sent; pick one and resend with `target`. */
export interface AskAmbiguous extends Envelope {
  ok: false
  ambiguous: SessionRow[]
  text: string
}

// ── §6.4 Managing a thread ────────────────────────────────────────────────

export interface AnswerRequest {
  session: SessionId
  /** The numbered form: press this option. */
  choice?: number
  key: string
  /** The structured form (a question): every question answered. */
  answers?: QuestionAnswer[]
  /** Headless: the approval's `id`. */
  request_id?: string
}

export interface AnswerResponse extends Envelope {
  session: SessionId
  pane: string
  answered?: number
  label?: string
  /** The structured form: what the agent was told, by question. */
  answers?: Record<string, string>
  /** Another dialog followed. */
  waiting: boolean
  approval: Approval | null
}

/** POST /rename {session, title} (§6.4). */
export interface RenameResponse extends Envelope {
  session: SessionId
  title: string
  /** Typed into the running session as `/rename <title>`. false is NOT a failure: the shelf has the name. */
  terminal: boolean
  /** Why the terminal was not renamed (ended, or someone mid-sentence in its box). */
  why: string | null
}

/** POST /session/close {session} (§6.4): ends the running session; the transcript stays. */
export interface CloseResponse extends Envelope {
  session: SessionId
  pane?: string | null
  live: false
  /** false: it was not running (nothing to end). */
  closed: boolean
}

/** POST /session/archive {session, archived} (§6.4). Archiving ends nothing. */
export interface ArchiveResponse extends Envelope {
  session: SessionId
  archived: boolean
}

/** POST /session/move (§6.15) — the thread's new project, and what became of its session. */
export interface MoveResponse extends Envelope {
  session: SessionId
  project: string | null
  cwd: string
  /** Whether a live session was closed and reopened in the new directory. */
  restarted: boolean
  pane: string | null
  live: boolean
  /** Where the conversation's own files now are, null when it has none yet. */
  folder?: string | null
  /** Set when the thread moved but its files could not follow. */
  folder_error?: string
}

// ── §6.5 Speech ───────────────────────────────────────────────────────────

/**
 * GET /speech/now — what the voice is saying, for the speech bar.
 * REALITY (red5, 22 Sep 2026): idle is `{live: false, speaking: false,
 * paused: false, sentence: "", session: null, title: "", item: null, pos:
 * null, dur: null, speed: null, muted: false}`; while live `pos` and `dur`
 * are whole seconds and `dur` grows as the reply's clips render.
 */
export interface SpeechNow extends Envelope {
  /** Speaking or paused. */
  live: boolean
  speaking: boolean
  paused: boolean
  sentence: string
  /** Filled only while live, and only for a valid session id. */
  session: SessionId | null
  title: string
  item: ItemId | null
  pos: number | null
  dur: number | null
  speed: number | null
  muted: boolean
  /** What is heard is a recorded reply played again; session/title/sentence are its. */
  replay?: boolean
  /** Replies said but not heard yet, likely play order (urgent first). Always present on a current server. */
  queued?: QueuedReply[]
  /** Where the voice is (live), or where the next reply will play (§6.9 names). */
  target?: string | null
  /**
   * Which turn is being spoken, keyed as the log's lines are (§6.5): `at`,
   * and `id` on a replay. Present only while live. Without it `pos` is a
   * position into nothing.
   */
  turn?: { at: number; id?: number }
}

/** One reply waiting for the voice (§6.5 `queued`). */
export interface QueuedReply {
  /** null for a reply with no session (e.g. `media say`). */
  session: SessionId | null
  title: string
  /** A question, a permission prompt, `media say --urgent`: it will interrupt. */
  urgent: boolean
  /** Submitted, epoch seconds (the server's clock). */
  at: number
}

/** `_APP_SPEECH_ACTIONS`; anything else is 400 "unknown action". */
export type SpeechAction =
  | 'toggle'
  | 'skip-'
  | 'skip+'
  | 'para-'
  | 'para+'
  | 'jump-end'
  | 'prev'
  | 'replay'
  | 'replay-id'
  | 'speed-'
  | 'speed+'
  | 'speed0'
  | 'vol-'
  | 'vol+'
  | 'mute'
  /** "Read from here" in the message being said: `arg` = sentence index (§6.5). */
  | 'goto-sentence'

export interface SpeechCtlRequest {
  action: SpeechAction
  /** Turn index for `prev`/`replay` (1 = latest); history row id for `replay-id`; sentence index for `goto-sentence`. */
  arg?: number
  /** `replay-id` only: start at this sentence of GET /speech/sentences (§6.5 "Read from here"). */
  sentence?: number
  /** `goto-sentence` only: the thread the tap was in; 409 if another is being heard. */
  session?: string
}

/** GET /speech/sentences?id= — what a replay of that reply can start at; `[]` = only from the top. */
export interface SpeechSentencesResponse extends Envelope {
  id: number
  sentences: string[]
}

/** `ok: true` means the command ran, not that it did anything — read `out`. */
export interface SpeechCtlResponse extends Envelope {
  out: string
}

// ── §9 Pairing ────────────────────────────────────────────────────────────

/** POST /pair {code, device} — no auth. */
export interface PairResponse extends Envelope {
  token: string
  device_id: string
  /** The device's name as given at the desk (`--device`), which wins over ours. Older servers leave it out. */
  name?: string
  server: { name: string; base: string }
}

// ── §12 (v1, NOT BUILT) ───────────────────────────────────────────────────

export interface StopRequest {
  session: SessionId
  speech?: 'auto' | 'silence'
}

export interface StopResponse extends Envelope {
  session: SessionId
  did: 'interrupted' | 'silenced' | 'both' | 'nothing'
  interrupted: boolean
  why: string | null
  speech: 'left' | 'stopped' | 'idle' | 'other_thread'
  cutoff?: number
  state: string
}

// ── §6.9 Audio destinations ───────────────────────────────────────────────

export interface AudioOption {
  name: string
  label: string
  available: boolean
  why: string | null
}

export interface AudioChannel {
  current: string | null
  default?: string
  next?: string
  overridden: boolean
  options: AudioOption[]
}

export interface AudioTargetsResponse extends Envelope {
  channels: { speech: AudioChannel; music?: AudioChannel }
}

// ── §6.11 Dashboard ───────────────────────────────────────────────────────

/** A session stopped on something only you can answer. */
export interface DashNeed {
  session: SessionId
  title: string
  kind: 'approval' | 'question'
  approval: Approval
  driver?: 'headless'
  /** The project it runs in, for display (§6.1, 22 Sep 2026), or null. */
  project?: string | null
  /** Its working directory, or null. */
  cwd?: string | null
}

/** A session in the middle of a turn. */
export interface DashWorking {
  session: SessionId
  title: string
  /** The step in progress, in plain English; "" between steps. */
  current: string
  /** When the turn started (server epoch s), or null. */
  since: number | null
  count: number
  /** The project it runs in, for display (§6.1, 22 Sep 2026), or null. */
  project?: string | null
  /** Its working directory, or null. */
  cwd?: string | null
}

export interface DashRecent {
  session: SessionId
  title: string
  recap: Recap | null
  at: number | null
  live: boolean
  rested: { at: number; reason: string } | null
  /** The project it runs in, for display (§6.1, 22 Sep 2026), or null. */
  project?: string | null
  /** Its working directory, or null. */
  cwd?: string | null
}

export interface DashService {
  service: string
  /** null: could not tell. */
  active: boolean | null
}

export interface DashHost {
  name: string
  role: string
  local: boolean
  /** null: could not tell. */
  online: boolean | null
  last_seen: number | null
  sessions: number | null
  mem_used_mb: number | null
  mem_total_mb: number | null
  mem_available_mb: number | null
  sessions_mem_mb: number | null
  tight: boolean | null
  reaper: { mode: string | null; last_run_at: number | null; closed_last_run: number } | null
  shell: DashService | null
  sessiond: DashService | null
}

export interface DashboardResponse extends Envelope {
  at: number
  needs_you: DashNeed[]
  working: DashWorking[]
  speech: {
    now: Pick<SpeechNow, 'live' | 'speaking' | 'paused' | 'session' | 'title' | 'sentence'> & { target: string | null; replay?: boolean }
    queued: QueuedReply[]
  }
  recent: DashRecent[]
  places: Place[]
  agents: { name: Agent; present: boolean }[]
  hosts: DashHost[]
}
