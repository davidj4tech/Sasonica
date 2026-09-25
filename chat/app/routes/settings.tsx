/**
 * Settings. The connection is a paired device (server-contract.md §9) — see
 * routes/pairing.tsx. "Legacy connection" keeps the v0 way: a server
 * address and an Audiobookshelf bearer (§4.1), used only when this device
 * is not paired. api/auth.ts is the only module that stores any of it.
 *
 * "Advanced" (lib/advanced.ts, per device, off by default) shows what only
 * a developer tunes: the follow-along lead, the device id and server
 * address, and — once paired — the legacy connection. It also gives search
 * its "Tool steps" filter.
 */
import { BackLink } from '../components/Nav'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { getSpeechDefault, getTargets, setSpeechDefault } from '../api'
import type { SpeechLevel } from '../api/types'
import { SPEECH_LEVELS } from '../components/SessionSheets'
import { credentialKind, hasLegacyToken, pairedDevice, serverBase, setBaseUrl, setLegacyToken, storedBaseUrl, unpair } from '../api/auth'
import { LEAD_DEFAULT_S, LEAD_MAX_S, LEAD_MIN_S, LEAD_STEP_S, setFollowLead, useFollowLead } from '../lib/followLead'
import { backgroundNotifyStatus, setBackgroundNotify, syncBackgroundNotify, speechStatus, setSpeechHere, type BackgroundNotifyStatus, type SpeechStatus } from '../lib/native'
import { getShowAmbient, setShowAmbient } from '../lib/pictures'
import { setAdvanced, useAdvanced } from '../lib/advanced'
import { setFollowOn, useFollowOn } from '../lib/followOn'
import { getTextSize, setTextSize, TEXT_SIZE_EVENT, TEXT_SIZES, type TextSizeId } from '../lib/textSize'

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
  // A pinch on this page changes the size too (hooks/usePinchTextSize.ts).
  useEffect(() => {
    const follow = () => setSize(getTextSize())
    window.addEventListener(TEXT_SIZE_EVENT, follow)
    return () => window.removeEventListener(TEXT_SIZE_EVENT, follow)
  }, [])
  const [ambient, setAmbient] = useState(() => getShowAmbient())
  const [kind, setKind] = useState(() => credentialKind())
  // The default speech priority is the server's (GET /speech/default): null
  // until it answers, and the picker hidden if it never does (an older one).
  const [speechDefault, setSpeechDefaultState] = useState<SpeechLevel | null>(null)
  const [speechDefaultError, setSpeechDefaultError] = useState('')
  useEffect(() => {
    let live = true
    getSpeechDefault()
      .then((r) => live && setSpeechDefaultState(r.level))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])
  const lead = useFollowLead()
  const advanced = useAdvanced()
  const followOn = useFollowOn()
  // Background notifications: the Android shell only (null elsewhere).
  const [bg, setBg] = useState<BackgroundNotifyStatus | null>(null)
  // Speech played here: the Android shell only, and off until turned on.
  const [speech, setSpeech] = useState<SpeechStatus | null>(null)
  useEffect(() => {
    let live = true
    void backgroundNotifyStatus().then((s) => live && setBg(s))
    void speechStatus().then((s) => live && setSpeech(s))
    return () => {
      live = false
    }
  }, [])

  const save = () => {
    setBaseUrl(url)
    if (token) setLegacyToken(token)
    else void syncBackgroundNotify(serverBase())
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
                  {advanced ? `${device.server.base} · ${device.device_id}` : ''}
                  {device.pairedAt ? `${advanced ? ' · since' : 'Since'} ${when(device.pairedAt)}` : ''}
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
                    void unpair()
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
          <small>On this device only. Applies at once. Pinch anywhere to change it too.</small>
        </fieldset>
        <fieldset>
          <legend>Follow along</legend>
          <label className="check">
            <input type="checkbox" checked={followOn} onChange={(e) => setFollowOn(e.target.checked)} />
            Scroll with the voice
          </label>
          <small>While a reply is spoken, keep its sentence on screen. Off, the view stays where you put it; the sentence is still in bold. On this device only.</small>
        </fieldset>
        {advanced && (
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
        )}
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
        {bg && (
          <fieldset data-testid="bg-notify">
            <legend>Notifications</legend>
            <label className="check">
              <input
                type="checkbox"
                checked={bg.enabled}
                onChange={(e) => {
                  const on = e.target.checked
                  setBg({ ...bg, enabled: on })
                  void setBackgroundNotify(on).then((s) => s && setBg(s))
                }}
              />
              Notify me when the app is closed
            </label>
            <small>
              {!bg.permitted
                ? 'Android is not letting Sasonica post notifications: allow them in the phone’s settings for this app.'
                : bg.enabled
                  ? `Keeps one quiet connection to the server open, shown as “Sasonica · listening for replies”.${bg.state ? ` Now: ${bg.state}` : ''}`
                  : 'Off: replies are told only while the app is open.'}
            </small>
          </fieldset>
        )}
        {speech && (
          <fieldset data-testid="speech-here">
            <legend>Speech on this phone</legend>
            <label className="check">
              <input
                type="checkbox"
                checked={speech.enabled}
                onChange={(e) => {
                  const on = e.target.checked
                  setSpeech({ ...speech, enabled: on })
                  void setSpeechHere(on).then((s) => s && setSpeech(s))
                }}
              />
              Speak replies on this phone
            </label>
            <small>
              {speech.enabled
                ? speech.listening
                  ? `Listening on ${speech.listening}. Send speech here with media speech-target next on the server, and media speech-target --clear to send it back.${
                      speech.watchingMic ? '' : ' The microphone watch is not running, so nothing will pause a reply while you talk.'
                    }`
                  : 'Starting\u2026'
                : `Off: replies are spoken by the old Sasonica app. While both are installed this one answers on port ${speech.port}, so you can try it without losing the other.`}
            </small>
          </fieldset>
        )}
        {speechDefault && (
          <fieldset data-testid="speech-default">
            <legend>Default speech priority</legend>
            <div className="text-sizes" role="group">
              {SPEECH_LEVELS.map((s) => (
                <button
                  key={s.level}
                  type="button"
                  aria-pressed={speechDefault === s.level}
                  onClick={() => {
                    const was = speechDefault
                    setSpeechDefaultState(s.level)
                    setSpeechDefaultError('')
                    setSpeechDefault(s.level)
                      .then((r) => setSpeechDefaultState(r.level))
                      .catch((e: unknown) => {
                        setSpeechDefaultState(was)
                        setSpeechDefaultError(e instanceof Error ? e.message : 'Could not save it')
                      })
                  }}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <small>{SPEECH_LEVELS.find((s) => s.level === speechDefault)?.note}.</small>
            <small className="server-wide">
              Saved on the server, not this phone: it changes every device paired with it. A thread given its own priority in its
              menu keeps it.
            </small>
            {speechDefaultError && <small className="failed">{speechDefaultError}</small>}
          </fieldset>
        )}
        <fieldset>
          <legend>Advanced</legend>
          <label className="check">
            <input type="checkbox" checked={advanced} onChange={(e) => setAdvanced(e.target.checked)} />
            Advanced
          </label>
          <small>Search can include tool steps (the commands and files agents touched); Settings shows the follow-along lead and connection details. On this device only.</small>
        </fieldset>
        {(advanced || !device) && (
          <details className="advanced" open={!device && hasLegacyToken()}>
            <summary>Legacy connection</summary>
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
        )}
        {saved && <p className="status">{saved}</p>}
        {check && <p className="status">{check}</p>}
        <Link className="about-row" to="/settings/agents">
          <span>Coding agents</span>
          <span aria-hidden="true">›</span>
        </Link>
        <Link className="about-row" to="/about">
          <span>About Sasonica</span>
          <span aria-hidden="true">›</span>
        </Link>
      </form>
    </div>
  )
}
