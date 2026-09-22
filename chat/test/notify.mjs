// Background notifications' Settings toggle (Sasonica Next, NotifyService):
// only inside the Android shell — here a faked native bridge (window.androidBridge
// + Capacitor PluginHeaders) that plays SecureStore and BackgroundNotify and
// logs every call. On by default and synced once paired; off and on again
// (kept across a reload); the hint when Android refuses notifications; a tap
// on the service's notification opens that thread; unpairing stops it after
// the token is gone; nothing of it in a browser.
import { chromium, SHOTS } from './lib.mjs'
const BASE = process.env.BASE || 'http://127.0.0.1:8811'
let fails = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++ }
await fetch(BASE + '/mock/pair')
const pr = await (await fetch(BASE + '/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'c0ffee42' }) })).json()
const device = { token: pr.token, device_id: pr.device_id, name: 't', server: pr.server, pairedAt: Date.now() }
const sessions = await (await fetch(BASE + '/targets', { headers: { Authorization: 'Bearer ' + pr.token } })).json()
const someThread = sessions.sessions[0].session

/** The shell's native side, faked. State lives in localStorage so it outlives a reload. */
function fakeShell({ permitted }) {
  const KEY = '__fake_native'
  const load = () => JSON.parse(localStorage.getItem(KEY) || 'null') || { secure: {}, bg: {}, log: [] }
  const save = (s) => localStorage.setItem(KEY, JSON.stringify(s))
  const listeners = {}
  let nextCb = 1
  const status = (s) => ({ enabled: s.bg.enabled !== false, decided: 'enabled' in s.bg, permitted, running: s.bg.enabled !== false && permitted && !!s.secure['sasonica.chat.device'], state: 'Connected to mock' })
  const m = (name, rtype = 'promise') => ({ name, rtype })
  window.androidBridge = { postMessage() {} }
  window.Capacitor = {
    PluginHeaders: [
      { name: 'SecureStore', methods: [m('get'), m('set'), m('remove')] },
      { name: 'BackgroundNotify', methods: [m('status'), m('setEnabled'), m('sync'), m('clear'), m('addListener', 'callback'), m('removeListener', 'callback')] }
    ],
    nativePromise: async (plugin, method, o = {}) => {
      const s = load()
      s.log.push({ plugin, method, o: plugin === 'SecureStore' ? { key: o.key } : o })
      let ret
      if (plugin === 'SecureStore') {
        if (method === 'get') ret = { value: s.secure[o.key] ?? null }
        if (method === 'set') s.secure[o.key] = o.value
        if (method === 'remove') delete s.secure[o.key]
      } else {
        if (method === 'setEnabled') s.bg.enabled = o.enabled
        if (method === 'sync') s.bg.base = o.base
        if (method !== 'clear') ret = status(s)
      }
      save(s)
      return ret
    },
    nativeCallback: (plugin, method, o, cb) => {
      const id = String(nextCb++)
      if (method === 'addListener') (listeners[`${plugin}.${o.eventName}`] ||= []).push(cb)
      return id
    }
  }
  window.__fireNative = (plugin, event, data) => (listeners[`${plugin}.${event}`] || []).forEach((cb) => cb(data))
}

const b = await chromium.launch()
async function newPage(shell) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true })
  const page = await ctx.newPage()
  await page.route('**/input', (r) => r.abort())
  page.errors = []
  page.on('pageerror', (e) => page.errors.push(String(e)))
  if (shell) await page.addInitScript(fakeShell, shell)
  return page
}
const fake = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('__fake_native') || 'null'))
const seed = (page, secure) =>
  page.evaluate(([base, secure]) => {
    localStorage.setItem('sasonica.chat.baseUrl', base)
    localStorage.setItem('__fake_native', JSON.stringify({ secure, bg: {}, log: [] }))
  }, [BASE, secure])

// 1. A browser: no toggle.
{
  const page = await newPage(null)
  await page.goto(BASE + '/settings')
  await page.evaluate(([base, d]) => {
    localStorage.setItem('sasonica.chat.baseUrl', base)
    localStorage.setItem('sasonica.chat.device', JSON.stringify(d))
  }, [BASE, device])
  await page.goto(BASE + '/settings')
  await page.waitForSelector('.settings fieldset')
  ok((await page.getByTestId('bg-notify').count()) === 0, 'browser: no background-notifications toggle')
  await page.context().close()
}

// 2. The shell, paired: on by default, synced with the server address.
{
  const page = await newPage({ permitted: true })
  await page.goto(BASE + '/about')
  await seed(page, { 'sasonica.chat.device': JSON.stringify(device) })
  await page.goto(BASE + '/')
  await page.waitForSelector('.home-page .dash-section')
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('__fake_native')).log.some((c) => c.method === 'sync'))
  const f = await fake(page)
  ok(f.bg.base === BASE, 'shell: paired → sync({base}) with the server address')
  ok(!f.log.some((c) => c.method === 'setEnabled'), 'shell: nothing chosen for the person (on by default)')

  await page.goto(BASE + '/settings')
  const box = page.getByTestId('bg-notify').getByRole('checkbox', { name: 'Notify me when the app is closed' })
  await box.waitFor()
  ok(await box.isChecked(), 'Settings: the toggle is on by default')
  ok((await page.getByTestId('bg-notify').innerText()).includes('listening for replies'), 'Settings: says what the persistent notification is')
  await page.getByTestId('bg-notify').screenshot({ path: SHOTS + '/notify-01-on.png' })

  await box.click()
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('__fake_native')).log.some((c) => c.method === 'setEnabled'))
  const off = (await fake(page)).log.filter((c) => c.method === 'setEnabled')
  ok(off.length === 1 && off[0].o.enabled === false, 'off → setEnabled({enabled: false})')
  ok(!(await box.isChecked()), 'the toggle shows off')
  ok((await page.getByTestId('bg-notify').innerText()).includes('only while the app is open'), 'off: says what that means')

  await page.reload()
  await box.waitFor()
  ok(!(await box.isChecked()), 'off is kept across a reload (the native side holds it)')
  await box.click()
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('__fake_native')).bg.enabled === true)
  ok(await box.isChecked(), 'on again → setEnabled({enabled: true})')

  // A tap on the service's notification opens that thread.
  await page.evaluate((s) => window.__fireNative('BackgroundNotify', 'open', { session: s }), someThread)
  await page.waitForURL('**/t/' + someThread)
  ok(true, 'a tap on a "New reply" notification opens its thread')

  // Unpair: the token goes first, then the service is told.
  await page.goto(BASE + '/settings')
  // Let the page's own start-up sync land before the log is cleared.
  await page.getByTestId('bg-notify').waitFor()
  await page.waitForTimeout(500)
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('__fake_native'))
    s.log = []
    localStorage.setItem('__fake_native', JSON.stringify(s))
  })
  await page.getByRole('button', { name: 'Unpair' }).click()
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('__fake_native')).log.some((c) => c.method === 'sync'))
  const log = (await fake(page)).log
  const removed = log.findIndex((c) => c.plugin === 'SecureStore' && c.method === 'remove' && c.o.key === 'sasonica.chat.device')
  const synced = log.findIndex((c) => c.method === 'sync')
  if (!(removed >= 0 && synced > removed)) console.log('  log:', JSON.stringify(log))
  ok(removed >= 0 && synced > removed, 'unpair: the device token is removed, then sync (the service stops)')
  ok(page.errors.length === 0, `no page errors (${page.errors.join(' | ')})`)
  await page.context().close()
}

// 3. The shell, notifications refused by Android: the toggle says why.
{
  const page = await newPage({ permitted: false })
  await page.goto(BASE + '/about')
  await seed(page, { 'sasonica.chat.device': JSON.stringify(device) })
  await page.goto(BASE + '/settings')
  await page.getByTestId('bg-notify').waitFor()
  ok((await page.getByTestId('bg-notify').innerText()).includes('not letting Sasonica post notifications'), 'refused: the hint says to allow them')
  await page.getByTestId('bg-notify').screenshot({ path: SHOTS + '/notify-02-refused.png' })
  await page.context().close()
}

await b.close()
process.exit(fails ? 1 : 0)
