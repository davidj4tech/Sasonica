/**
 * "Background agents" (§6.12): the thread's subagents, under its header.
 * Hidden while it has none; collapsed by default to one line ("3 running ·
 * 12 done"); open, a tree — forks and children nested under their parent —
 * each row its description, a status dot, how long it has run and, while it
 * runs, the step it is on. A tap opens that agent's own thread, read-only
 * (routes/agent.tsx).
 *
 * The counts ride on the thread's stream (the snapshot's `agents` and the
 * `agents` event); the list is GET /threads/{session}/agents, read when the
 * counts change and every AGENTS_POLL_MS while open with anything running.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { getAgents } from '../api'
import type { AgentCounts, AgentRow } from '../api/types'
import { agentSummary, agentTree, elapsedOf, loadAgentSort, saveAgentSort, type AgentSort } from '../lib/agents'

const AGENTS_POLL_MS = 5000
/** Open or not, per thread, for this page load: back from an agent's log finds it as it was left. */
const WAS_OPEN = new Map<string, boolean>()

export function AgentsStrip({ session, counts }: { session: string; counts: AgentCounts | null }) {
  const [open, setOpenState] = useState(() => WAS_OPEN.get(session) || false)
  const setOpen = (fn: (o: boolean) => boolean) =>
    setOpenState((o) => {
      const next = fn(o)
      WAS_OPEN.set(session, next)
      return next
    })
  const [rows, setRows] = useState<AgentRow[] | null>(null)
  const [error, setError] = useState('')
  const [sort, setSort] = useState<AgentSort>(() => loadAgentSort())
  const [nowS, setNow] = useState(() => Date.now() / 1000)

  const load = useCallback(async () => {
    try {
      const res = await getAgents(session)
      setRows(res.agents || [])
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [session])

  const total = counts?.total || 0
  const running = rows ? rows.some((r) => r.status === 'running') : !!counts?.running
  // Read once there is something to read, and again whenever the counts move.
  useEffect(() => {
    if (total > 0) void load()
  }, [total, counts?.running, load])
  // Open with work going: poll the list, and run the elapsed clocks.
  useEffect(() => {
    if (!open || !running) return
    const poll = window.setInterval(() => void load(), AGENTS_POLL_MS)
    const tick = window.setInterval(() => setNow(Date.now() / 1000), 1000)
    return () => {
      window.clearInterval(poll)
      window.clearInterval(tick)
    }
  }, [open, running, load])
  useEffect(() => {
    if (open) setNow(Date.now() / 1000)
  }, [open])

  const tree = useMemo(() => agentTree(rows || [], sort), [rows, sort])
  if (!total && !(rows && rows.length)) return null
  const summary = agentSummary(counts, rows)
  const flip = () => {
    const next: AgentSort = sort === 'running' ? 'start' : 'running'
    setSort(next)
    saveAgentSort(next)
  }

  return (
    <section className={open ? 'agents-strip open' : 'agents-strip'} aria-label="Background agents">
      <button type="button" className="agents-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className={`dot ${running ? 'working' : 'shelved'}`} aria-hidden="true" />
        <span className="agents-label">Background agents</span>
        <span className="agents-summary">{summary}</span>
        <span className="caret" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open && (
        <div className="agents-body">
          <div className="agents-tools">
            <button type="button" className="agents-sort" onClick={flip} title="Change the order">
              {sort === 'running' ? 'Running first' : 'Start order'}
            </button>
          </div>
          {error && <p className="error">{error}</p>}
          {!rows && !error && <p className="hint">Loading…</p>}
          <ul className="agents-list">
            {tree.map(({ row, level }) => (
              <li key={row.id} data-level={level} style={{ paddingLeft: `${level * 1.1}rem` }}>
                <Link className="agent-row" data-status={row.status} data-id={row.id} to={`/t/${encodeURIComponent(session)}/agents/${encodeURIComponent(row.id)}`} state={{ description: row.description }}>
                  <span className={`dot agent-${row.status}`} aria-label={row.status} />
                  <span className="agent-main">
                    <span className="agent-desc">
                      {level > 0 && <span className="agent-branch" aria-hidden="true">↳ </span>}
                      {row.description || row.agent_type || row.id}
                      {row.is_fork && <span className="agent-kind">fork</span>}
                    </span>
                    {row.status === 'running' && row.current_step && <span className="agent-step">{row.current_step}</span>}
                  </span>
                  <span className="agent-time">{elapsedOf(row, nowS)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
