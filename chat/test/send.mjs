// A sent message shows once: the "sending…" copy is replaced by the
// server's line when it comes back, even when that line arrives in a poll
// BEFORE /reply answers, with the server's clock 40 s behind the phone's,
// and with the text's whitespace flattened. A refused send keeps the words
// with Retry. Mock only.
import { chromium, SHOTS } from './lib.mjs'
const BASE = process.env.BASE || 'http://127.0.0.1:8811'
let fails = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++ }
const mock = (q) => fetch(`${BASE}/mock/reply?${q}`)
await fetch(BASE + '/mock/pair')
const pr = await (await fetch(BASE + '/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'c0ffee42' }) })).json()
const targets = await (await fetch(BASE + '/targets', { headers: { Authorization: 'Bearer ' + pr.token } })).json()
const sid = (t) => targets.sessions.find((s) => s.title === t).session
const b = await chromium.launch()
const page = await (await b.newContext({ viewport: { width: 390, height: 780 } })).newPage()
await page.route('**/input', (r) => r.abort())
page.on('pageerror', (e) => console.log('  pageerror', e.message))
await page.goto(BASE + '/settings')
await page.evaluate(([base, res]) => { localStorage.setItem('sasonica.chat.baseUrl', base); localStorage.setItem('sasonica.chat.device', JSON.stringify({ token: res.token, device_id: res.device_id, name: 't', server: res.server, pairedAt: Date.now() })) }, [BASE, pr])
const copies = (words) => page.evaluate((w) => [...document.querySelectorAll('.msg.user .bubble')].filter((b) => b.textContent.replace(/\s+/g, ' ').includes(w)).map((b) => (b.querySelector('.sending-mark') ? 'local:' + b.querySelector('.sending-mark').textContent.trim() : 'server')), words)
const send = async (text) => {
  await page.locator('.composer textarea').fill(text)
  await page.locator('.composer textarea').press('Control+Enter')
}
const watch = async (words, ms) => {
  let worst = 0
  const seen = new Set()
  for (const t0 = Date.now(); Date.now() - t0 < ms; ) {
    const c = await copies(words)
    worst = Math.max(worst, c.length)
    c.forEach((x) => seen.add(x))
    await page.waitForTimeout(150)
  }
  return { worst, seen: [...seen], final: await copies(words) }
}

const thread = sid('Mock: not on the shelf yet')
await page.goto(BASE + '/t/' + thread)
await page.waitForSelector('text=A brand new chat.')

// 1. The race: line back in a poll before /reply answers; clock skew; flattened text.
await mock('delay=3000&skew=-40&flatten=1&fail=0')
await send('first  line\n\nsecond   line')
const r1 = await watch('first line second line', 7000)
console.log('  race:', JSON.stringify(r1))
ok(r1.worst === 1, 'never two copies (line back before /reply answered, server clock 40 s behind, whitespace flattened)')
ok(r1.final.length === 1 && r1.final[0] === 'server', "ends as the server's line, no sending mark")
ok(r1.seen.includes('local:sending…'), 'showed "sending…" at once')

// 2. Same words twice: two sends, two lines, never four.
await mock('delay=800&skew=25&flatten=0')
await send('again')
await page.waitForTimeout(400)
await send('again')
const r2 = await watch('again', 6000)
console.log('  twice:', JSON.stringify(r2))
ok(r2.worst <= 2 && r2.final.length === 2 && r2.final.every((x) => x === 'server'), 'identical sends: one bubble each, both reconciled')

// 3. A refused send keeps the words with Retry; Retry sends it once.
await mock('delay=300&skew=0&fail=1')
await send('please retry me')
await page.waitForSelector('.sending-mark.failed')
await page.screenshot({ path: SHOTS + '/send-01-failed.png' })
ok((await page.locator('.sending-mark.failed').innerText()).includes('could not deliver'), 'refusal shown on the message')
ok((await page.locator('.composer textarea').inputValue()) === '', 'the box is empty (the words are in the bubble, not twice)')
await mock('fail=0')
await page.getByRole('button', { name: 'Retry' }).click()
const r3 = await watch('please retry me', 4000)
ok(r3.worst === 1 && r3.final.length === 1 && r3.final[0] === 'server', 'Retry → sent once, reconciled')

// 4. Cache paint: away and back shows each message once.
await page.goto(BASE + '/')
await page.waitForSelector('.thread-row')
await page.locator(`a.thread-row[href="/t/${thread}"]`).click()
await page.waitForSelector('.msg.user')
await page.waitForTimeout(1500)
ok((await copies('first line second line')).length === 1 && (await copies('please retry me')).length === 1, 'back into the thread (snapshot paint, then poll): still one each')
await mock('delay=0&skew=0&flatten=0&fail=0')
await b.close()
console.log(fails ? `${fails} FAILED` : 'ALL PASS')
process.exit(fails ? 1 : 0)
