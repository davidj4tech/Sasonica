/**
 * A new thread: a local, unsent thread with a place picker (/targets.places)
 * and an agent picker. It becomes real on the first send:
 * POST /ask {text, target: "new", cwd?, agent?}; the returned session becomes
 * the thread id (§14 onSwitchToNewThread / onNew in a new thread).
 */
import { BackLink } from '../components/Nav'
import { useCallback, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { askNew } from '../api'
import type { Agent } from '../api/types'
import { SpeechBar } from '../components/SpeechBar'
import { Thread } from '../components/Thread'
import { useTargets } from '../hooks/useThreads'
import { draftSent, NEW_CHAT } from '../lib/drafts'

const AGENTS: { id: Agent; label: string }[] = [
  { id: 'claude', label: 'Claude' },
  { id: 'codex', label: 'Codex' },
  { id: 'pi', label: 'pi' },
  { id: 'hermes', label: 'Hermes' }
]

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
        speechBar={<SpeechBar />}
        empty={
          <div className="new-pickers">
            <p className="picker-label">Where</p>
            <div className="chips">
              <button className={cwd === '' ? 'chip on' : 'chip'} onClick={() => setCwd('')}>
                default
              </button>
              {places.map((p) => (
                <button key={p.path} className={cwd === p.path ? 'chip on' : 'chip'} onClick={() => setCwd(p.path)} title={p.path}>
                  {p.name}
                </button>
              ))}
            </div>
            <p className="picker-label">Agent</p>
            <div className="chips">
              {AGENTS.map((a) => (
                <button key={a.id} className={agent === a.id ? 'chip on' : 'chip'} onClick={() => setAgent(a.id)}>
                  {a.label}
                </button>
              ))}
            </div>
            {error && <p className="error">{error}</p>}
          </div>
        }
        status={status && <p className={status.failed ? 'status failed' : 'status'}>{status.text}</p>}
      />
    </div>
  )
}
