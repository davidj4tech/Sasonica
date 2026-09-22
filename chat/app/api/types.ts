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
}

export interface ConversationLog extends Envelope {
  session: SessionId
  lines: Line[]
  pending: boolean
  working: Working | null
  approval: Approval | null
  suggestion: string
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
  choice: number
  key: string
}

export interface AnswerResponse extends Envelope {
  session: SessionId
  pane: string
  answered: number
  label: string
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

export interface SpeechCtlRequest {
  action: SpeechAction
  /** Turn index for `prev`/`replay` (1 = latest); history row id for `replay-id`. */
  arg?: number
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
