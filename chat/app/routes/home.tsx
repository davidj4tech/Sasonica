/**
 * Home, the landing screen: what needs you, what is working, what is being
 * said, where each thread was, a quick way to start, and the machines — all
 * from one poll of GET /dashboard (§6.11, hooks/useDashboard.ts) — and what
 * is due, asked of the organiser on its own (components/HomeAgenda.tsx).
 * Threads and the Organiser are the other tabs (components/Nav.tsx).
 *
 * Needs you: the thread's own question / approval card (parts.tsx
 * ApprovalCard), answered here through the same POST /session/answer; the
 * card leaves at once and a 409 swaps in the new question.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, Navigate } from 'react-router'
import { answer } from '../api'
import { hasCredential } from '../api/auth'
import type { Approval, DashDigest, DashNeed, DashRecent, DashWorking, QuestionAnswer } from '../api/types'
import { Mark } from '../components/Mark'
import { Machines } from '../components/Machines'
import { HomeAgenda } from '../components/HomeAgenda'
import { HomeTabs } from '../components/Nav'
import { OutputSheet } from '../components/OutputSheet'
import { ApprovalCard, ThreadActionsContext, type ThreadActions } from '../components/parts'
import { IconPlay, SpeechBar } from '../components/SpeechBar'
import { PlayingMark } from '../components/PlayingMark'
import { useDashboard } from '../hooks/useDashboard'
import { useSpeech, useSpeechActions } from '../hooks/useSpeech'
import { useTitle } from '../lib/titles'

/** §6.9's usual names, said the way /audio/targets labels them. */
const TARGET_LABEL: Record<string, string> = { app: 'phone', phone: 'phone (Termux)', rooms: 'house speakers', local: 'red5' }

const AGENT_LABEL: Record<string, string> = { claude: 'Claude', codex: 'Codex', pi: 'pi', hermes: 'Hermes' }

export default function Home() {
  if (!hasCredential()) return <Navigate to="/pairing" replace />
  return <HomeScreen />
}

function useNow(ms: number) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms)
    return () => window.clearInterval(id)
  }, [ms])
  return now
}

function elapsed(s: number): string {
  s = Math.max(0, Math.round(s))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

function ago(at: number | null, skew: number): string {
  if (!at) return ''
  const s = Date.now() / 1000 - skew - at
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.round(s / 60)}m`
  if (s < 86400) return `${Math.round(s / 3600)}h`
  return `${Math.round(s / 86400)}d`
}

function Section({ id, title, count, children }: { id: string; title: string; count?: number; children: ReactNode }) {
  return (
    <section className={`dash-section dash-${id}`} aria-labelledby={`dash-${id}-h`}>
      <h2 id={`dash-${id}-h`}>
        {title}
        {count !== undefined && count > 0 && <span className="dash-count">{count}</span>}
      </h2>
      {children}
    </section>
  )
}

function HomeScreen() {
  const { data, stale, error, settle } = useDashboard()
  const [output, setOutput] = useState(false)
  // Server clock minus ours, as of the answer on screen: "since" and "at" are
  // the server's epoch seconds.
  const [skew, setSkew] = useState(0)
  useEffect(() => {
    if (data?.at) setSkew(Date.now() / 1000 - data.at)
  }, [data?.at])

  return (
    <div className="page home-page">
      <header className="bar">
        <h1 className="wordmark">
          <Mark size={28} />
          Sasonica
        </h1>
        {stale && <span className="updating">updating…</span>}
        <Link className="icon" to="/settings" title="Settings">
          ⚙
        </Link>
      </header>
      <HomeTabs current="home" />

      <main className="dash">
        {error && !data && <p className="notice error">{error}</p>}
        {!data && !error && <p className="notice delayed">Loading…</p>}
        {data && (
          <>
            {data.needs_you.length > 0 && (
              <Section id="needs" title="Needs you" count={data.needs_you.length}>
                {data.needs_you.map((n) => (
                  <NeedCard key={n.session} need={n} settle={settle} />
                ))}
              </Section>
            )}

            {data.working.length > 0 && (
              <Section id="working" title="Working now" count={data.working.length}>
                <ul className="dash-list">
                  {data.working.map((w) => (
                    <WorkingRow key={w.session} w={w} skew={skew} />
                  ))}
                </ul>
              </Section>
            )}

            {data.digests && data.digests.length > 0 && (
              <Section id="digests" title="Digests" count={data.digests.filter((d) => d.speech?.id != null && !d.speech.heard).length}>
                <ul className="dash-list">
                  {data.digests.map((d) => (
                    <DigestRow key={d.id} d={d} skew={skew} />
                  ))}
                </ul>
                <Link className="digest-all" to="/digests">
                  All digests
                </Link>
              </Section>
            )}

            <HomeAgenda />

            <Section id="listening" title="Listening">
              <Listening queuedFallback={data.speech.queued.length} target={data.speech.now.target} onOutput={() => setOutput(true)} />
            </Section>

            {data.recent.length > 0 && (
              <Section id="recaps" title="Recaps">
                <ul className="dash-list">
                  {data.recent.map((r) => (
                    <RecapRow key={r.session} r={r} skew={skew} />
                  ))}
                </ul>
                <Link className="all-threads" to="/threads" state={{ fromHome: true }}>
                  All threads →
                </Link>
              </Section>
            )}

            <Section id="start" title="Quick start">
              <QuickStart places={data.places} agents={data.agents} onOutput={() => setOutput(true)} />
            </Section>

            {data.hosts.length > 0 && (
              <Section id="machines" title="Machines">
                <Machines hosts={data.hosts} skew={skew} />
              </Section>
            )}
            {error && <p className="notice error">{error}</p>}
          </>
        )}
      </main>

      {output && <OutputSheet onClose={() => setOutput(false)} />}

      <div className="dock">
        <Link to="/new" className="fab" title="New chat" aria-label="New chat">
          <svg className="fab-plus" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" fill="none" />
          </svg>
        </Link>
        <SpeechBar />
      </div>
    </div>
  )
}

/**
 * A morning digest (the agenda, …): never read out on its own — its read-out
 * is rendered held on the server, and ▶ plays it (`replay-id`), which marks
 * it heard. The dot is "not heard yet"; a press clears it at once rather than
 * at the next poll. The title opens it to read (routes/digest.tsx).
 */
function DigestRow({ d, skew }: { d: DashDigest; skew: number }) {
  const { replayId } = useSpeechActions()
  const [pressed, setPressed] = useState(false)
  const rid = d.speech?.id ?? null
  const unheard = rid !== null && !d.speech?.heard && !pressed
  return (
    <li className="digest-row" data-digest={d.id}>
      <button
        className="msg-key digest-play"
        disabled={rid === null}
        aria-label={rid === null ? `${d.title}: still being prepared` : `Play ${d.title}`}
        onClick={() => {
          if (rid === null) return
          setPressed(true)
          replayId(rid)
        }}
      >
        <IconPlay />
      </button>
      {d.n != null ? (
        <Link className="digest-title" to={`/digests/${d.n}`}>
          {d.title}
        </Link>
      ) : (
        <span className="digest-title">{d.title}</span>
      )}
      {unheard && <span className="digest-new" aria-label="not heard yet" />}
      <span className="digest-when">{ago(d.changed_at, skew)}</span>
    </li>
  )
}

/** One question or approval, answerable here. */
function NeedCard({ need, settle }: { need: DashNeed; settle: (session: string, key: string, next: Approval | null) => void }) {
  const title = useTitle(need.session, need.title) || need.session.slice(0, 8)
  const actions: ThreadActions = useMemo(
    () => ({
      answer: async (approval: Approval, choice: number | QuestionAnswer[]) => {
        const res = await answer(
          Array.isArray(choice)
            ? { session: need.session, key: approval.key, answers: choice, ...(approval.id ? { request_id: approval.id } : {}) }
            : { session: need.session, choice, key: approval.key }
        )
        if (res.ok) {
          settle(need.session, approval.key, res.res.approval || null)
          return { error: '', key: '' }
        }
        if (res.changed) {
          settle(need.session, approval.key, res.approval)
          return { error: 'The question changed — choose again.', key: res.approval?.key || '' }
        }
        return { error: res.error, key: approval.key }
      }
    }),
    [need.session, settle]
  )
  return (
    <article className="need-card" data-session={need.session} data-kind={need.kind}>
      <header>
        <Link to={`/t/${encodeURIComponent(need.session)}`} state={{ title }} className="need-title">
          {title}
        </Link>
        <span className="badge approval">{need.kind === 'question' ? 'question' : 'approval'}</span>
      </header>
      <ThreadActionsContext.Provider value={actions}>
        <ApprovalCard approval={need.approval} />
      </ThreadActionsContext.Provider>
    </article>
  )
}

function WorkingRow({ w, skew }: { w: DashWorking; skew: number }) {
  const title = useTitle(w.session, w.title) || w.session.slice(0, 8)
  const now = useNow(1000)
  const secs = w.since ? now / 1000 - skew - w.since : null
  return (
    <li>
      <Link to={`/t/${encodeURIComponent(w.session)}`} state={{ title }} className="dash-row working-row">
        <span className="live-pulse" role="img" aria-label="working" />
        <span className="dash-main">
          <span className="dash-title">{title}</span>
          {w.project && <span className="row-project">{w.project}</span>}
          <span className="dash-sub">
            {w.current || 'Thinking…'}
            {w.count > 0 && ` · ${w.count} step${w.count === 1 ? '' : 's'}`}
          </span>
        </span>
        <PlayingMark session={w.session} />
        {secs !== null && (
          <span className="dash-when" aria-label={`working for ${elapsed(secs)}`}>
            {elapsed(secs)}
          </span>
        )}
      </Link>
    </li>
  )
}

/**
 * One line for the voice: the global speech bar is the control; this says
 * what it is doing and what is waiting. Live state from the app's one
 * /speech/now poll (useSpeech), which is fresher than the dashboard's.
 */
function Listening({ queuedFallback, target, onOutput }: { queuedFallback: number; target: string | null; onOutput: () => void }) {
  const { now } = useSpeech()
  const title = useTitle(now?.session || undefined, now?.title || '')
  const queued = now?.queued?.length ?? queuedFallback
  const urgent = now?.queued?.some((q) => q.urgent)
  const where = now?.target ?? target
  let what: ReactNode
  if (now?.live)
    what = (
      <>
        {now.paused ? 'Paused' : 'Speaking'}
        {title ? (
          <>
            {' · '}
            {now.session ? (
              <Link to={`/t/${encodeURIComponent(now.session)}`} state={{ title }} className="listening-thread">
                <b>{title}</b>
              </Link>
            ) : (
              <b>{title}</b>
            )}
          </>
        ) : null}
      </>
    )
  else what = 'Quiet'
  return (
    <div className="listening-line">
      <span className={`speak-dot ${now?.live ? (now.paused ? 'paused' : 'on') : 'off'}`} aria-hidden="true" />
      <span className="listening-what">
        {what}
        {queued > 0 && <span className={urgent ? 'queued urgent' : 'queued'}> · {queued} waiting</span>}
      </span>
      <button type="button" className="chip output-chip" onClick={onOutput} title="Where speech plays">
        {where ? `on ${TARGET_LABEL[where] || where}` : 'Output'} ›
      </button>
    </div>
  )
}

function RecapRow({ r, skew }: { r: DashRecent; skew: number }) {
  const title = useTitle(r.session, r.title) || r.session.slice(0, 8)
  const [open, setOpen] = useState(false)
  const text = r.recap?.text || ''
  return (
    <li className="recap-row">
      <div className="recap-head">
        <span className="title-col">
          <Link to={`/t/${encodeURIComponent(r.session)}`} state={{ title }} className="dash-title">
            {title}
          </Link>
          {r.project && <span className="row-project">{r.project}</span>}
        </span>
        <PlayingMark session={r.session} />
        {r.live ? <span className="badge waiting">live</span> : r.rested ? <span className="badge resting">resting</span> : null}
        <span className="dash-when">{ago(r.at, skew)}</span>
      </div>
      {text ? (
        <button type="button" className={open ? 'recap-text open' : 'recap-text'} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {text}
        </button>
      ) : (
        <p className="recap-text none">No recap yet.</p>
      )}
    </li>
  )
}

function QuickStart({ places, agents, onOutput }: { places: { name: string; path: string }[]; agents: { name: string; present: boolean }[]; onOutput: () => void }) {
  const present = agents.filter((a) => a.present).map((a) => a.name)
  const first = present.includes('claude') ? 'claude' : present[0] || 'claude'
  const chips: { key: string; to: string; label: string }[] = []
  // The top places with the main agent, then the top place with each other one.
  for (const p of places.slice(0, 4)) chips.push({ key: `${p.path}|${first}`, to: `/new?cwd=${encodeURIComponent(p.path)}&agent=${first}`, label: `${p.name} · ${AGENT_LABEL[first] || first}` })
  if (places[0]) for (const a of present.filter((x) => x !== first)) chips.push({ key: `${places[0].path}|${a}`, to: `/new?cwd=${encodeURIComponent(places[0].path)}&agent=${a}`, label: `${places[0].name} · ${AGENT_LABEL[a] || a}` })
  return (
    <div className="chips quick-chips">
      {chips.map((c) => (
        <Link key={c.key} className="chip quick" to={c.to}>
          {c.label}
        </Link>
      ))}
      <Link className="chip quick" to="/new">
        New chat…
      </Link>
      <button type="button" className="chip quick" onClick={onOutput}>
        Speech output…
      </button>
    </div>
  )
}
