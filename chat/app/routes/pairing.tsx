/**
 * Pair this device with a canvas (server-contract.md §9).
 *
 * At the desk: `media-visual-canvas pair --device "Pixel 8a"` prints
 * `sasonica://pair?server=<base>&code=<code>` (and a browser link). Here:
 * paste either link, or type the server address and the code. `POST /pair`
 * trades the one-time code for a device token, which api/auth.ts keeps.
 *
 * Also the landing for a pairing link opened straight into the app:
 * `/?pair=<code>&server=<base>` (root.tsx forwards it here, and the preview
 * server's /pair?c= redirects to it) pairs at once, with no typing.
 *
 * Shown on first run (no credential at all) and from Settings.
 */
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { hasCredential, normaliseServer, pair, pairedDevice, parsePairLink, PairError, serverBase, storedBaseUrl, type PairRequest } from '../api/auth'

/** A code redeemed (or being redeemed) in this page load: a code dies on its
 * first success, so a remount (StrictMode, a back-and-forth) must not spend
 * it twice and then report the second attempt's 403. */
const attempted = new Set<string>()

function explain(err: unknown): string {
  if (err instanceof PairError) {
    if (err.status === 403) return 'That code is wrong, already used, or expired. Mint a new one at the desk: media-visual-canvas pair --device NAME'
    if (err.status === 429) return err.message || 'Too many attempts; try again in a few minutes.'
    if (err.status === 404 || err.status === 405) return 'That server does not do device pairing (is it the canvas, on port 8781?).'
    return err.message
  }
  return err instanceof Error ? err.message : String(err)
}

export default function Pairing() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const first = !hasCredential()
  const [link, setLink] = useState('')
  const [server, setServer] = useState(() => storedBaseUrl() || serverBase())
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  const run = async (req: PairRequest) => {
    const key = `${normaliseServer(req.server)}|${req.code}`
    if (attempted.has(key)) return
    attempted.add(key)
    setBusy(true)
    setError('')
    try {
      const dev = await pair(req)
      setDone(`Paired${dev.server.name ? ` with ${dev.server.name}` : ''}.`)
      // Off the pairing address (it carries a spent code), onto the list.
      window.setTimeout(() => navigate('/', { replace: true }), 600)
    } catch (err) {
      attempted.delete(key)
      setError(explain(err))
    } finally {
      setBusy(false)
    }
  }

  // Opened with a pairing link's parameters: pair straight away.
  const auto = useRef(false)
  useEffect(() => {
    if (auto.current) return
    const c = params.get('pair') || params.get('code') || ''
    if (!c) return
    auto.current = true
    const s = params.get('server') || server
    setCode(c)
    if (s) setServer(s)
    void run({ server: s, code: c })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params])

  const submit = () => {
    const fromLink = parsePairLink(link)
    if (link.trim() && !fromLink) {
      setError('That is not a pairing link. It looks like sasonica://pair?server=…&code=…')
      return
    }
    const req = fromLink ? { server: fromLink.server || server, code: fromLink.code } : { server, code: code.trim() }
    if (!req.code) {
      setError('Paste the pairing link, or type the code.')
      return
    }
    if (!req.server) {
      setError('Which server? Type its address, e.g. http://red5:8781')
      return
    }
    void run(req)
  }

  const current = pairedDevice()

  return (
    <div className="page">
      <header className="bar">
        {!first && (
          <Link className="icon" to="/settings" title="Settings">
            ←
          </Link>
        )}
        <h1 className="grow">Pair this device</h1>
      </header>
      <form
        className="settings"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        {first && <p className="lead">Sasonica needs to be paired with your server once.</p>}
        <p className="hint">
          At the desk, run <code>media-visual-canvas pair --device "Phone"</code> and paste the <code>sasonica://pair?…</code> link it prints.
        </p>
        {current && (
          <p className="status">
            Already paired{current.server.name ? ` with ${current.server.name}` : ''}. Pairing again replaces it.
          </p>
        )}
        <label>
          Pairing link
          <input
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="sasonica://pair?server=…&code=…"
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </label>
        <p className="or">or</p>
        <label>
          Server address
          <input value={server} onChange={(e) => setServer(e.target.value)} placeholder="http://red5:8781" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
        </label>
        <label>
          Code
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="8 characters" autoCapitalize="off" autoCorrect="off" spellCheck={false} autoComplete="one-time-code" />
        </label>
        <div className="row">
          <button type="submit" disabled={busy}>
            {busy ? 'Pairing…' : 'Pair'}
          </button>
          {first && (
            <Link className="quiet-link" to="/settings">
              Use an Audiobookshelf token instead
            </Link>
          )}
        </div>
        {error && <p className="status failed">{error}</p>}
        {done && <p className="status">{done}</p>}
      </form>
    </div>
  )
}
