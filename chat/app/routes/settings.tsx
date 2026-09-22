/**
 * Settings. The connection is a paired device (server-contract.md §9) — see
 * routes/pairing.tsx. "Advanced / legacy" keeps the v0 way: a server
 * address and an Audiobookshelf bearer (§4.1), used only when this device
 * is not paired. api/auth.ts is the only module that stores any of it.
 */
import { BackLink } from '../components/Nav'
import { useState } from 'react'
import { Link } from 'react-router'
import { getTargets } from '../api'
import { credentialKind, hasLegacyToken, pairedDevice, serverBase, setBaseUrl, setLegacyToken, storedBaseUrl, unpair } from '../api/auth'
import { LEAD_DEFAULT_S, LEAD_MAX_S, LEAD_MIN_S, LEAD_STEP_S, setFollowLead, useFollowLead } from '../lib/followLead'
import { getShowAmbient, setShowAmbient } from '../lib/pictures'
import { getTextSize, setTextSize, TEXT_SIZES, type TextSizeId } from '../lib/textSize'

function when(ms: number): string {
  try {
    return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
  } catch {
    return ''
  }
}

export default function Settings() {
  const [device, setDevice] = useState(() => pairedDevice())
  const [url, setUrl] = useState(() => storedBaseUrl())
  const [token, setTok] = useState('')
  const [saved, setSaved] = useState('')
  const [check, setCheck] = useState('')
  const [size, setSize] = useState<TextSizeId>(() => getTextSize())
  const [ambient, setAmbient] = useState(() => getShowAmbient())
  const [kind, setKind] = useState(() => credentialKind())
  const lead = useFollowLead()

  const save = () => {
    setBaseUrl(url)
    if (token) setLegacyToken(token)
    setTok('')
    setKind(credentialKind())
    setSaved('Saved.')
  }

  const test = async () => {
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
        <BackLink />
        <h1 className="grow">Settings</h1>
      </header>
      <form
        className="settings"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <fieldset>
          <legend>This device</legend>
          {device ? (
            <div className="paired">
              <p>
                Paired as <strong>{device.name || device.device_id}</strong>
                {device.server.name ? (
                  <>
                    {' '}
                    with <strong>{device.server.name}</strong>
                  </>
                ) : null}
                <br />
                <small>
                  {device.server.base} · {device.device_id}
                  {device.pairedAt ? ` · since ${when(device.pairedAt)}` : ''}
                </small>
              </p>
              <div className="row">
                <button type="button" onClick={test}>
                  Test
                </button>
                <Link className="button" to="/pairing">
                  Pair again
                </Link>
                <button
                  type="button"
                  className="quiet"
                  onClick={() => {
                    unpair()
                    setDevice(null)
                    setKind(credentialKind())
                    setSaved(
                      `Unpaired on this device. To revoke the token itself, at the desk: sasonica devices --revoke ${device.device_id}`
                    )
                  }}
                >
                  Unpair
                </button>
              </div>
            </div>
          ) : (
            <div className="paired">
              <p>{kind === 'legacy' ? 'Not paired — using the Audiobookshelf token (legacy).' : 'Not paired.'}</p>
              <div className="row">
                <Link className="button primary" to="/pairing">
                  Pair this device
                </Link>
              </div>
            </div>
          )}
        </fieldset>
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
        <fieldset>
          <legend>Follow-along lead</legend>
          <div className="stepper" role="group" aria-label="Follow-along lead">
            <button type="button" aria-label="Less lead" disabled={lead <= LEAD_MIN_S} onClick={() => setFollowLead(lead - LEAD_STEP_S)}>
              −
            </button>
            <span className="stepper-value">{lead.toFixed(1)} s</span>
            <button type="button" aria-label="More lead" disabled={lead >= LEAD_MAX_S} onClick={() => setFollowLead(lead + LEAD_STEP_S)}>
              +
            </button>
            {lead !== LEAD_DEFAULT_S && (
              <button type="button" className="quiet" onClick={() => setFollowLead(LEAD_DEFAULT_S)}>
                Reset
              </button>
            )}
          </div>
          <small>How far the bold sentence runs ahead of the voice. More if the bold lags what you hear, less if it jumps ahead. On this device only.</small>
        </fieldset>
        <fieldset>
          <legend>Pictures</legend>
          <label className="check">
            <input
              type="checkbox"
              checked={ambient}
              onChange={(e) => {
                setShowAmbient(e.target.checked)
                setAmbient(e.target.checked)
              }}
            />
            Show ambient artwork
          </label>
          <small>The small pictures drawn beside a reply. Figures (diagrams) always show, as a thumbnail. On this device only.</small>
        </fieldset>
        <details className="advanced" open={!device && hasLegacyToken()}>
          <summary>Advanced / legacy</summary>
          <p className="hint">
            The v0 way in: a server address and your Audiobookshelf token. Used only while this device is not paired; pairing is the
            default and needs neither.
          </p>
          <label>
            Server address
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={serverBase() || 'http://host:8781'} inputMode="url" autoCapitalize="off" autoCorrect="off" />
            <small>Blank means this page's host on port 8781. Pairing sets it.</small>
          </label>
          <label>
            Audiobookshelf token
            <input
              type="password"
              value={token}
              onChange={(e) => setTok(e.target.value)}
              placeholder={hasLegacyToken() ? '•••••• (set — leave blank to keep)' : 'Audiobookshelf token'}
              autoComplete="off"
            />
            {device && hasLegacyToken() && <small>Kept, but not sent: the device token is used first.</small>}
          </label>
          <div className="row">
            <button type="submit">Save</button>
            <button
              type="button"
              onClick={() => {
                save()
                void test()
              }}
            >
              Save and test
            </button>
            <button
              type="button"
              className="quiet"
              onClick={() => {
                setLegacyToken('')
                setKind(credentialKind())
                setSaved('Token cleared.')
              }}
            >
              Clear token
            </button>
          </div>
        </details>
        {saved && <p className="status">{saved}</p>}
        {check && <p className="status">{check}</p>}
        <Link className="about-row" to="/about">
          <span>About Sasonica</span>
          <span aria-hidden="true">›</span>
        </Link>
      </form>
    </div>
  )
}
