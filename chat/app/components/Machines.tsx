/**
 * The home screen's Machines section: one compact row per host, read at a
 * glance (David, 22 Sep 2026: "easy to see dynamic icons").
 *
 *   memory ring   fills with memory in use, green → amber → red with pressure
 *                 (the reaper's own "tight" wins: it is what closes sessions)
 *   sessions      a count badge
 *   service dots  Sasonica Shell and sessiond: a steady green dot when up, a
 *                 hollow grey one when down, a dashed one when unknown
 *   online dot    a peer (hpo) from the tailnet: online / offline, last seen
 *
 * Motion is small and optional: the ring eases to a new fill and an up
 * service breathes slowly; `prefers-reduced-motion` stills both (app.css).
 * Every icon carries its meaning in an aria-label / title, never colour
 * alone. A tap on a row opens its numbers and the reaper's last run.
 */
import { useState } from 'react'
import type { DashHost, DashService } from '../api/types'

export type Pressure = 'ok' | 'warm' | 'tight' | 'unknown'

/** How short of memory a host is. 'tight' at ≥ 85 % used or when the reaper says so. */
export function pressureOf(h: DashHost): Pressure {
  if (h.tight) return 'tight'
  const { mem_used_mb: used, mem_total_mb: total } = h
  if (used == null || !total) return 'unknown'
  const f = used / total
  return f >= 0.85 ? 'tight' : f >= 0.7 ? 'warm' : 'ok'
}

const PRESSURE_WORD: Record<Pressure, string> = { ok: 'fine', warm: 'getting full', tight: 'tight', unknown: 'unknown' }

const gb = (mb: number | null | undefined) => (mb == null ? '?' : mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`)

function ago(at: number | null | undefined, skew: number): string {
  if (!at) return ''
  const s = Math.max(0, Date.now() / 1000 - skew - at)
  if (s < 90) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} d ago`
}

/** The ring: a track and an arc for the fraction in use, the percentage inside. */
export function MemRing({ host }: { host: DashHost }) {
  const p = pressureOf(host)
  const f = host.mem_used_mb != null && host.mem_total_mb ? Math.min(1, Math.max(0, host.mem_used_mb / host.mem_total_mb)) : 0
  const R = 15
  const C = 2 * Math.PI * R
  const label =
    p === 'unknown' ? 'Memory: unknown' : `Memory ${Math.round(f * 100)}% used, ${PRESSURE_WORD[p]} (${gb(host.mem_available_mb)} free of ${gb(host.mem_total_mb)})`
  return (
    <svg className={`mem-ring ${p}`} viewBox="0 0 40 40" width="40" height="40" role="img" aria-label={label} data-pressure={p} data-fill={f.toFixed(2)}>
      <title>{label}</title>
      <circle className="track" cx="20" cy="20" r={R} />
      {p !== 'unknown' && (
        <circle className="arc" cx="20" cy="20" r={R} strokeDasharray={C.toFixed(2)} strokeDashoffset={(C * (1 - f)).toFixed(2)} transform="rotate(-90 20 20)" />
      )}
      <text x="20" y="20" dominantBaseline="central" textAnchor="middle">
        {p === 'unknown' ? '–' : Math.round(f * 100)}
      </text>
    </svg>
  )
}

type DotState = 'up' | 'down' | 'unknown'
const dotOf = (active: boolean | null | undefined): DotState => (active === true ? 'up' : active === false ? 'down' : 'unknown')

function StatusDot({ state, label }: { state: DotState; label: string }) {
  const word = state === 'up' ? 'up' : state === 'down' ? 'down' : 'unknown'
  return (
    <span className="svc" title={`${label}: ${word}`}>
      <span className={`svc-dot ${state}`} role="img" aria-label={`${label}: ${word}`} data-state={state} />
      <span className="svc-name" aria-hidden="true">
        {label}
      </span>
    </span>
  )
}

const svcLabel = (s: DashService | null, fallback: string) => (s?.service === 'sasonica-shell' ? 'Shell' : s?.service === 'agent-media-sessiond' ? 'sessiond' : fallback)

export function Machines({ hosts, skew }: { hosts: DashHost[]; skew: number }) {
  const [open, setOpen] = useState<string | null>(null)
  if (!hosts.length) return null
  return (
    <ul className="machines">
      {hosts.map((h) => {
        const peer = !h.local
        const online = dotOf(h.online)
        const expanded = open === h.name
        return (
          <li key={h.name} className={`machine${expanded ? ' open' : ''}`} data-host={h.name}>
            <button type="button" className="machine-row" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : h.name)}>
              {peer ? (
                <span className={`online-dot ${online}`} role="img" aria-label={`${h.name} ${online === 'up' ? 'online' : online === 'down' ? 'offline' : 'status unknown'}`} data-state={online} />
              ) : (
                <MemRing host={h} />
              )}
              <span className="machine-name">
                {h.name}
                {h.role && <small>{h.role}</small>}
              </span>
              <span className="machine-icons">
                {h.sessions != null && (
                  <span className="count-badge" aria-label={`${h.sessions} open sessions`} title={`${h.sessions} open sessions`}>
                    {h.sessions}
                  </span>
                )}
                {h.shell && <StatusDot state={dotOf(h.shell.active)} label={svcLabel(h.shell, 'Shell')} />}
                {h.sessiond && <StatusDot state={dotOf(h.sessiond.active)} label={svcLabel(h.sessiond, 'sessiond')} />}
                {peer && <span className="machine-note">{online === 'up' ? 'online' : online === 'down' ? `offline${h.last_seen ? ` · seen ${ago(h.last_seen, skew)}` : ''}` : 'unknown'}</span>}
              </span>
            </button>
            {expanded && (
              <dl className="machine-details">
                {h.mem_total_mb != null && (
                  <>
                    <dt>Memory</dt>
                    <dd>
                      {gb(h.mem_used_mb)} used of {gb(h.mem_total_mb)} · {gb(h.mem_available_mb)} free
                      {h.sessions_mem_mb != null && ` · sessions hold ${gb(h.sessions_mem_mb)}`}
                    </dd>
                  </>
                )}
                {h.sessions != null && (
                  <>
                    <dt>Sessions</dt>
                    <dd>{h.sessions} open</dd>
                  </>
                )}
                {h.reaper && (
                  <>
                    <dt>Idle closer</dt>
                    <dd>
                      {h.reaper.last_run_at
                        ? `last ran ${ago(h.reaper.last_run_at, skew)}, closed ${h.reaper.closed_last_run}`
                        : 'has not run'}
                      {h.reaper.mode === 'dry-run' && ' (dry run)'}
                    </dd>
                  </>
                )}
                {h.shell && (
                  <>
                    <dt>Sasonica Shell</dt>
                    <dd>{h.shell.active === true ? 'running' : h.shell.active === false ? 'not running' : 'unknown'}</dd>
                  </>
                )}
                {h.sessiond && (
                  <>
                    <dt>Session host</dt>
                    <dd>{h.sessiond.active === true ? 'running' : h.sessiond.active === false ? 'not running' : 'unknown'}</dd>
                  </>
                )}
                {peer && (
                  <>
                    <dt>Tailnet</dt>
                    <dd>{online === 'up' ? 'online' : online === 'down' ? `offline${h.last_seen ? `, last seen ${ago(h.last_seen, skew)}` : ''}` : 'unknown'}</dd>
                  </>
                )}
              </dl>
            )}
          </li>
        )
      })}
    </ul>
  )
}
