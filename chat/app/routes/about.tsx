/**
 * About Sasonica: the mark, what the app is, which build this is, the server
 * it talks to, and what it is built on. Reached from the foot of Settings.
 *
 * The version is the commit and time of the build (vite.config.ts `define`).
 * The server has no version route (server-contract.md), so only its host and
 * the name pairing gave it are shown.
 */
import { useEffect, useState } from 'react'
import { BackLink } from '../components/Nav'
import { Mark } from '../components/Mark'
import { pairedDevice, serverBase } from '../api/auth'
import { isNativeShell, nativeVersion } from '../lib/native'

const REPO = 'https://github.com/davidj4tech/Sasonica'

const CREDITS: { name: string; url: string; licence: string }[] = [
  { name: 'React', url: 'https://react.dev', licence: 'MIT' },
  { name: 'React Router', url: 'https://reactrouter.com', licence: 'MIT' },
  { name: 'assistant-ui', url: 'https://www.assistant-ui.com', licence: 'MIT' },
  { name: 'Capacitor', url: 'https://capacitorjs.com', licence: 'MIT' },
  { name: 'Fraunces', url: 'https://fonts.google.com/specimen/Fraunces', licence: 'OFL 1.1' },
  { name: 'IBM Plex Sans', url: 'https://github.com/IBM/plex', licence: 'OFL 1.1' }
]

function built(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
  } catch {
    return iso.slice(0, 10)
  }
}

function hostOf(base: string): string {
  try {
    return new URL(base).host
  } catch {
    return base
  }
}

export default function About() {
  const device = pairedDevice()
  const base = device?.server.base || serverBase()
  const [shell, setShell] = useState<string | null>(null)
  const [native, setNative] = useState(false)

  useEffect(() => {
    setNative(isNativeShell())
    let live = true
    void nativeVersion().then((v) => live && setShell(v))
    return () => {
      live = false
    }
  }, [])

  const sha = __APP_SHA__
  return (
    <div className="page">
      <header className="bar">
        <BackLink />
        <h1 className="grow">About</h1>
      </header>
      <div className="settings about">
        <div className="brand-hero">
          <Mark size={160} />
          <p className="wordmark">Sasonica</p>
          <p className="tagline">Talk to your agents.</p>
        </div>
        <p className="about-what">
          A voice-first front end for your coding agents. Hear their replies read aloud and follow along as they speak, answer their
          questions, and steer your sessions from the phone.
        </p>
        <dl className="facts">
          <div>
            <dt>Version</dt>
            <dd data-testid="app-version">
              {sha === 'dev' ? (
                'dev'
              ) : (
                <a href={`${REPO}/commit/${sha}`} target="_blank" rel="noreferrer">
                  {sha}
                </a>
              )}
              <span className="muted"> · built {built(__APP_BUILT__)}</span>
            </dd>
          </div>
          {native && (
            <div>
              <dt>App</dt>
              <dd data-testid="native-version">Sasonica Next{shell ? ` ${shell}` : ''}</dd>
            </div>
          )}
          <div>
            <dt>Server</dt>
            <dd data-testid="server">
              {base ? hostOf(base) : 'Not set'}
              {device?.server.name ? <span className="muted"> · {device.server.name}</span> : null}
              {!device && base ? <span className="muted"> · not paired</span> : null}
            </dd>
          </div>
        </dl>
        <section className="credits" aria-labelledby="built-on">
          <h2 id="built-on">Built on</h2>
          <ul>
            {CREDITS.map((c) => (
              <li key={c.name}>
                <a href={c.url} target="_blank" rel="noreferrer">
                  {c.name}
                </a>
                <span className="muted">{c.licence}</span>
              </li>
            ))}
          </ul>
        </section>
        <a className="button source" href={REPO} target="_blank" rel="noreferrer">
          Source on GitHub · davidj4tech/Sasonica
        </a>
        <small>Sasonica is free software under the Apache License 2.0.</small>
      </div>
    </div>
  )
}
