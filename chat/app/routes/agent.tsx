/**
 * One background agent's own thread (§6.12), read-only: its task, its steps
 * and what it said, from GET /threads/{session}/agents/{id}/log — the same
 * message shapes as a thread (§6.2.2), drawn by the same Thread, with no
 * composer. "Load earlier" pages back with `before`. Re-read every
 * AGENT_POLL_MS while the agent runs.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useParams } from 'react-router'
import { getAgentLog } from '../api'
import type { AgentRow, Message } from '../api/types'
import { BackLink } from '../components/Nav'
import { Thread } from '../components/Thread'
import { elapsedOf } from '../lib/agents'
import { buildItems } from '../lib/convert'
import { mergeSnapshot } from '../lib/messages'

const AGENT_POLL_MS = 3000
const PAGE = 30

const STATUS_LABEL: Record<string, string> = { running: 'running', done: 'done', failed: 'failed', stopped: 'stopped' }

export default function AgentRoute() {
  const { session = '', id = '' } = useParams()
  return <AgentPage key={`${session}/${id}`} session={session} id={id} />
}

function AgentPage({ session, id }: { session: string; id: string }) {
  const location = useLocation()
  const hint = (location.state as { description?: string } | null)?.description || ''
  const [agent, setAgent] = useState<AgentRow | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [older, setOlder] = useState(false)
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [earlier, setEarlier] = useState({ loading: false, error: '' })
  const held = useRef({ messages, older })
  held.current = { messages, older }

  const load = useCallback(async () => {
    try {
      const res = await getAgentLog(session, id, { limit: PAGE })
      setAgent(res.agent)
      const merged = mergeSnapshot(held.current.messages, held.current.older, res.messages || [], !!res.older)
      setMessages(merged.messages)
      setOlder(merged.older)
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoaded(true)
    }
  }, [session, id])

  useEffect(() => {
    void load()
  }, [load])
  const running = agent?.status === 'running'
  useEffect(() => {
    if (!running) return
    const t = window.setInterval(() => void load(), AGENT_POLL_MS)
    return () => window.clearInterval(t)
  }, [running, load])

  const loadEarlier = useCallback(async (): Promise<boolean> => {
    const first = held.current.messages[0]
    if (!first || earlier.loading) return false
    setEarlier({ loading: true, error: '' })
    try {
      const res = await getAgentLog(session, id, { before: first.id, limit: 60 })
      const got = res.messages || []
      setMessages((cur) => {
        const have = new Set(cur.map((m) => m.id))
        return [...got.filter((m) => !have.has(m.id)), ...cur]
      })
      setOlder(!!res.older && got.length > 0)
      setEarlier({ loading: false, error: '' })
      return got.length > 0
    } catch (e) {
      setEarlier({ loading: false, error: e instanceof Error ? e.message : String(e) })
      return false
    }
  }, [session, id, earlier.loading])

  const items = useMemo(() => buildItems({ session, messages, approval: null, live: null, liveId: null, optimistic: [] }), [session, messages])
  const actions = useMemo(() => ({ answer: async () => ({ error: 'This agent is read-only here.', key: '' }) }), [])
  const noop = useCallback(async () => {}, [])
  const title = agent?.description || hint || id
  const last = messages[messages.length - 1]

  let empty: React.ReactNode = null
  if (!messages.length) empty = <p className={error ? 'empty error' : 'empty'}>{error || (loaded ? 'Nothing from this agent yet.' : 'Loading…')}</p>

  return (
    <div className="page thread-page agent-page">
      <header className="bar">
        <BackLink />
        <h1 className="grow">
          <span className="agent-title">{title}</span>
          {agent && (
            <span className="thread-project">
              {agent.is_fork ? 'fork' : agent.agent_type} · {elapsedOf(agent, Date.now() / 1000)} · {agent.steps} steps
            </span>
          )}
        </h1>
        {agent && <span className={`badge agent-${agent.status}`}>{STATUS_LABEL[agent.status] || agent.status}</span>}
      </header>
      <Thread
        items={items}
        isRunning={!!(running && last?.turn?.running)}
        working={null}
        workingAt={0}
        thinking={false}
        suggestion=""
        onSend={noop}
        onStop={() => {}}
        actions={actions}
        empty={empty}
        older={older}
        onLoadEarlier={loadEarlier}
        earlierLoading={earlier.loading}
        earlierError={earlier.error}
        readOnly
        status={error && messages.length > 0 ? <p className="status failed">{error}</p> : null}
      />
    </div>
  )
}
