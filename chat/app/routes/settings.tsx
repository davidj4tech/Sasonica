/**
 * Settings: the canvas base URL and the bearer (v0: an Audiobookshelf token,
 * server-contract.md §4.1). v1 replaces both with a pairing link (§9) —
 * see api/auth.ts, the only module that stores them.
 */
import { useState } from 'react'
import { Link } from 'react-router'
import { getTargets } from '../api'
import { hasToken, serverBase, setBaseUrl, setToken, storedBaseUrl } from '../api/auth'
import { getTextSize, setTextSize, TEXT_SIZES, type TextSizeId } from '../lib/textSize'

export default function Settings() {
  const [url, setUrl] = useState(() => storedBaseUrl())
  const [token, setTok] = useState('')
  const [saved, setSaved] = useState('')
  const [check, setCheck] = useState('')
  const [size, setSize] = useState<TextSizeId>(() => getTextSize())

  const save = () => {
    setBaseUrl(url)
    if (token) setToken(token)
    setTok('')
    setSaved('Saved.')
  }

  const test = async () => {
    save()
    setCheck('Checking…')
    try {
      const res = await getTargets()
      setCheck(`OK — ${res.sessions.length} threads, ${res.places.length} places.`)
    } catch (err) {
      setCheck(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="page">
      <header className="bar">
        <Link className="icon" to="/" title="Threads">
          ←
        </Link>
        <h1 className="grow">Settings</h1>
      </header>
      <form
        className="settings"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <label>
          Server address
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={serverBase() || 'http://host:8781'} inputMode="url" autoCapitalize="off" autoCorrect="off" />
          <small>Blank means this page's host on port 8781.</small>
        </label>
        <label>
          Token
          <input type="password" value={token} onChange={(e) => setTok(e.target.value)} placeholder={hasToken() ? '•••••• (set — leave blank to keep)' : 'Audiobookshelf token'} autoComplete="off" />
          <small>v0: your Audiobookshelf bearer. Pairing replaces this later.</small>
        </label>
        <div className="row">
          <button type="submit">Save</button>
          <button type="button" onClick={test}>
            Save and test
          </button>
          <button
            type="button"
            className="quiet"
            onClick={() => {
              setToken('')
              setSaved('Token cleared.')
            }}
          >
            Clear token
          </button>
        </div>
        <fieldset>
          <legend>Text size</legend>
          <div className="text-sizes" role="group">
            {TEXT_SIZES.map((s) => (
              <button
                key={s.id}
                type="button"
                aria-pressed={size === s.id}
                onClick={() => {
                  setTextSize(s.id)
                  setSize(s.id)
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
          <small>On this device only. Applies at once.</small>
        </fieldset>
        {saved && <p className="status">{saved}</p>}
        {check && <p className="status">{check}</p>}
      </form>
    </div>
  )
}
