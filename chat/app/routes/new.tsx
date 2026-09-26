/**
 * A new thread: a local, unsent thread with a place picker (/targets.places)
 * and an agent picker. It becomes real on the first send:
 * POST /ask {text, target: "new", cwd?, agent?}; the returned session becomes
 * the thread id (§14 onSwitchToNewThread / onNew in a new thread).
 *
 * Both pickers fold into one line, "agent-media · Claude ▾" (as Home's quick chips say it), with the choices
 * in a sheet (David, 26 Sep 2026): as chips they took the screen from the box
 * once a message ran to several lines.
 */
import { BackLink } from '../components/Nav'
import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router'
import { askNew, getHarnesses } from '../api'
import type { Agent, HarnessRow } from '../api/types'
import { Sheet } from '../components/SessionSheets'
import { SpeechBar } from '../components/SpeechBar'
import { Thread } from '../components/Thread'
import type { Carry } from '../hooks/useDictation'
import { useTargets } from '../hooks/useThreads'
import { draftSent, NEW_CHAT } from '../lib/drafts'

const AGENTS: { id: Agent; label: string }[] = [
  { id: 'claude', label: 'Claude' },
  { id: 'codex', label: 'Codex' },
  { id: 'pi', label: 'pi' },
  { id: 'hermes', label: 'Hermes' }
]

/**
 * What each agent's chip does with what the server says about it (§6.6):
 * an agent that is not installed here is not offered at all — there is
 * nothing to pick — while one that is merely signed out stays on show,
 * dimmed, because that is two taps from fixed and a chip that vanished
 * would read as the app losing Codex. /ask refuses either way; this is so
 * the refusal is rarely the way you find out.
 */
function pickable(rows: HarnessRow[] | null, id: Agent): HarnessRow | null {
  return rows ? rows.find((r) => r.name === id) || null : null
}

const noAnswer = { answer: async () => ({ error: 'nothing to answer', key: '' }) }

export default function NewThread() {
  const navigate = useNavigate()
  const { places, error } = useTargets()
  // Preset from Home's quick start: /new?cwd=<a place's path>&agent=<agent>.
  const [params] = useSearchParams()
  const [cwd, setCwd] = useState(() => params.get('cwd') || '')
  const [agent, setAgent] = useState<Agent>(() => {
    const a = params.get('agent') as Agent | null
    return a && AGENTS.some((x) => x.id === a) ? a : 'claude'
  })
  const [status, setStatus] = useState<{ text: string; failed?: boolean } | null>(null)
  const [picking, setPicking] = useState(false)
  // What the host has. Null until it answers: all four are offered until
  // there is a reason not to, so a slow check never holds up a chat.
  const [harnesses, setHarnesses] = useState<HarnessRow[] | null>(null)
  useEffect(() => {
    const ac = new AbortController()
    getHarnesses(ac.signal)
      .then((r) => setHarnesses(r.agents))
      .catch(() => {})
    return () => ac.abort()
  }, [])
  const chosen = pickable(harnesses, agent)
  const signedOut = chosen?.present && chosen.auth === 'out'
  // Opened by the phone's assistant button (components/NativeHooks.tsx): a
  // stamp per press, and each new one listens straight away.
  // Or by a thread's "New chat instead" chip, with the words it took.
  const navState = useLocation().state as { assist?: number; carry?: Carry } | null
  const assist = navState?.assist
  const carry = navState?.carry

  const onSend = useCallback(
    async (text: string) => {
      setStatus({ text: 'Opening a session…' })
      try {
        const res = await askNew(text, { cwd: cwd || undefined, agent })
        // Started: the new-chat draft is spent. (A failure throws, and
        // Thread puts the words back in the box.)
        draftSent(NEW_CHAT, text)
        if (res.session) {
          navigate(`/t/${encodeURIComponent(res.session)}`, { replace: true, state: { title: res.title || text.slice(0, 60) } })
          return
        }
        // Delivered, but the session's id never surfaced within 10 s (§6.3).
        setStatus({ text: `Sent to ${res.pane || 'the host'}; its session id has not registered yet.` })
      } catch (err) {
        setStatus({ text: err instanceof Error ? err.message : String(err), failed: true })
        throw err
      }
    },
    [cwd, agent, navigate]
  )

  const where = places.find((p) => p.path === cwd)?.name

  return (
    <div className="page thread-page">
      <header className="bar">
        <BackLink />
        <h1 className="grow">{where ? `New chat in ${where}` : 'New chat'}</h1>
      </header>
      <Thread
        items={[]}
        isRunning={false}
        working={null}
        workingAt={0}
        thinking={false}
        suggestion=""
        onSend={onSend}
        onStop={() => {}}
        actions={noAnswer}
        placeholder="Start a new chat…"
        draftKey={NEW_CHAT}
        listenNow={assist}
        carry={carry}
        handOffAlways
        speechBar={<SpeechBar />}
        empty={
          <div className="new-pickers">
            <button type="button" className="new-summary" onClick={() => setPicking(true)} aria-label="Where and which agent">
              {where || 'Default place'} · {AGENTS.find((a) => a.id === agent)?.label} <span aria-hidden="true">▾</span>
            </button>
            {chosen && !chosen.present && (
              <p className="picker-note">
                {chosen.name} is not installed here. <Link to="/harnesses">Coding agents</Link> installs it.
              </p>
            )}
            {signedOut && (
              <p className="picker-note">
                Signed out here, so it would not answer. <Link to="/harnesses">Sign in</Link>.
              </p>
            )}
            {error && <p className="error">{error}</p>}
            {picking && (
              <Sheet label="Where and which agent" onClose={() => setPicking(false)} className="action-sheet new-sheet">
                {/* Newest first, as the server sends them (sessions.places). */}
                <p className="action-title">Where</p>
                <div role="menu" className="action-list">
                  <button role="menuitem" className={cwd === '' ? 'on' : ''} onClick={() => setCwd('')}>
                    default
                  </button>
                  {places.map((p) => (
                    <button key={p.path} role="menuitem" className={cwd === p.path ? 'on' : ''} onClick={() => setCwd(p.path)} title={p.path}>
                      {p.name}
                    </button>
                  ))}
                </div>
                <p className="action-title">Agent</p>
                <div className="chips">
                  {AGENTS.filter((a) => {
                    const row = pickable(harnesses, a.id)
                    return !row || row.present || a.id === agent
                  }).map((a) => {
                    const row = pickable(harnesses, a.id)
                    const out = row ? !row.present || row.auth === 'out' : false
                    return (
                      <button
                        key={a.id}
                        className={`${agent === a.id ? 'chip on' : 'chip'}${out ? ' chip-out' : ''}`}
                        onClick={() => setAgent(a.id)}
                      >
                        {a.label}
                      </button>
                    )
                  })}
                </div>
                <div className="row">
                  <button type="button" className="primary" onClick={() => setPicking(false)}>
                    Done
                  </button>
                </div>
              </Sheet>
            )}
          </div>
        }
        status={status && <p className={status.failed ? 'status failed' : 'status'}>{status.text}</p>}
      />
    </div>
  )
}
