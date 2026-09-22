// Another session's message in a thread (§6.2.2 `peer`): a small "From
// <name>" over an outlined bubble, never the listener's filled one; the
// listener's own messages carry no note.
import { chromium, SHOTS } from './lib.mjs'
const BASE = process.env.BASE || 'http://127.0.0.1:8811'
let fails = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++ }
await fetch(BASE + '/mock/pair')
const pr = await (await fetch(BASE + '/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'c0ffee42', device: 'peer' }) })).json()
const H = { Authorization: 'Bearer ' + pr.token, 'Content-Type': 'application/json' }
const targets = await (await fetch(BASE + '/targets?archived=1', { headers: H })).json()
const row = (targets.sessions || []).find((s) => s.title === 'Mock: archived earlier')
ok(!!row, 'the archived mock thread is listed')

const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true, colorScheme: 'dark' })
const page = await ctx.newPage()
await page.route('**/input', (r) => r.abort())
await page.goto(BASE + '/settings')
await page.evaluate(([base, res]) => {
  localStorage.setItem('sasonica.chat.baseUrl', base)
  localStorage.setItem('sasonica.chat.device', JSON.stringify({ token: res.token, device_id: res.device_id, name: 'peer', server: res.server, pairedAt: Date.now() }))
}, [BASE, pr])
await page.goto(BASE + '/t/' + row.session)
await page.waitForSelector('.msg.user')
const r = await page.evaluate(() => {
  const users = [...document.querySelectorAll('.msg.user')]
  const peer = users.filter((m) => m.classList.contains('peer'))
  const bg = (m) => getComputedStyle(m.querySelector('.bubble')).backgroundColor
  return {
    users: users.length,
    peers: peer.length,
    note: peer[0]?.querySelector('.peer-note')?.textContent || '',
    text: peer[0]?.querySelector('.bubble')?.textContent || '',
    peerBg: peer[0] ? bg(peer[0]) : '',
    ownBg: users.filter((m) => !m.classList.contains('peer')).map(bg)[0] || '',
    ownNotes: users.filter((m) => !m.classList.contains('peer')).some((m) => m.querySelector('.peer-note'))
  }
})
ok(r.peers === 1 && r.users === 2, `one peer message among the user ones (${r.peers} of ${r.users})`)
ok(r.note === 'From agent-media-71', `it says who sent it ("${r.note}")`)
ok(r.text.includes('The canvas is restarted'), 'its words are shown')
ok(r.peerBg !== r.ownBg, `its bubble is not the listener's fill (${r.peerBg} vs ${r.ownBg})`)
ok(!r.ownNotes, "the listener's own messages carry no note")
await page.screenshot({ path: `${SHOTS}/peer.png` })
await b.close()
console.log(fails ? `${fails} FAILED` : 'all passed')
process.exit(fails ? 1 : 0)
