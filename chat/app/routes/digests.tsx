/**
 * Past digests, newest first (§6.17 `GET /alerts/digests`): every digest,
 * or one kind's (`?id=digest.landscape`); a row opens it to read
 * (routes/digest.tsx). Kept 90 days on the server; "Load earlier" pages back.
 */
import { useEffect, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router'
import { getDigests } from '../api'
import { hasCredential } from '../api/auth'
import type { DigestEntry } from '../api/types'
import { BackLink } from '../components/Nav'
import { digestWhen } from '../lib/digests'

export default function Digests() {
  if (!hasCredential()) return <Navigate to="/pairing" replace />
  return <DigestsScreen />
}

function DigestsScreen() {
  const [params] = useSearchParams()
  const id = params.get('id') || undefined
  const [rows, setRows] = useState<DigestEntry[] | null>(null)
  const [more, setMore] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const ac = new AbortController()
    setRows(null)
    getDigests({ id }, ac.signal)
      .then((r) => {
        setRows(r.digests)
        setMore(r.digests.length >= 60)
      })
      .catch((e) => {
        if ((e as Error)?.name !== 'AbortError') setError((e as Error).message || 'Could not load digests')
      })
    return () => ac.abort()
  }, [id])

  const earlier = () => {
    const last = rows?.[rows.length - 1]
    if (!last) return
    getDigests({ id, before: last.n })
      .then((r) => {
        setRows((prev) => [...(prev || []), ...r.digests])
        setMore(r.digests.length >= 60)
      })
      .catch((e) => setError((e as Error).message || 'Could not load digests'))
  }

  return (
    <div className="page digests-page">
      <header className="bar">
        <BackLink />
        <h1 className="grow">Digests</h1>
      </header>
      <main className="dash">
        {id && (
          <p className="digest-filter">
            Just this digest · <Link to="/digests">show all</Link>
          </p>
        )}
        {error && <p className="notice error">{error}</p>}
        {!rows && !error && <p className="notice delayed">Loading…</p>}
        {rows && rows.length === 0 && <p className="notice">No digests yet.</p>}
        {rows && rows.length > 0 && (
          <ul className="dash-list">
            {rows.map((d) => (
              <li key={d.n} className="digest-row" data-n={d.n}>
                <Link className="digest-title" to={`/digests/${d.n}`}>
                  {d.title}
                </Link>
                <span className="digest-when">{digestWhen(d.at)}</span>
              </li>
            ))}
          </ul>
        )}
        {more && (
          <button className="button digest-more" onClick={earlier}>
            Load earlier
          </button>
        )}
      </main>
    </div>
  )
}
