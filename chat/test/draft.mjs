// The composer keeps its text per thread: switching threads, a reload, the
// tab hidden, another device's newer copy, a send. Mock only — a POST
// /draft is harmless, but this suite sends replies too.
import { chromium, SHOTS } from './lib.mjs'
const BASE = process.env.BASE || 'http://127.0.0.1:8811'
let fails = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++ }
await fetch(BASE + '/mock/delay?ms=0')
await fetch(BASE + '/mock/reply?delay=0&skew=0&flatten=0&fail=0')
await fetch(BASE + '/mock/pair')
const pr = await (await fetch(BASE + '/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'c0ffee42' }) })).json()
const H = { Authorization: 'Bearer ' + pr.token, 'Content-Type': 'application/json' }
const targets = await (await fetch(BASE + '/targets', { headers: H })).json()
const sid = (t) => targets.sessions.find((s) => s.title === t).session
const A = sid('Mock: shelved conversation')
const B = sid('Mock: not on the shelf yet')
const server = async (s) => (await (await fetch(BASE + '/mock/drafts')).json())[s]?.text || ''
const setServer = (session, text, at) => fetch(BASE + '/draft', { method: 'POST', headers: H, body: JSON.stringify({ session, text, at }) })

await setServer(A, '', 0)
await setServer(B, '', 0)
const b = await chromium.launch()
const page = await (await b.newContext({ viewport: { width: 390, height: 780 } })).newPage()
await page.route('**/input', (r) => r.abort())
const posts = []
page.on('request', (r) => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/draft') posts.push({ t: Date.now(), body: JSON.parse(r.postData() || '{}') }) })
page.on('pageerror', (e) => console.log('  pageerror', e.message))
await page.goto(BASE + '/settings')
await page.evaluate(([base, res]) => { localStorage.setItem('sasonica.chat.baseUrl', base); localStorage.setItem('sasonica.chat.device', JSON.stringify({ token: res.token, device_id: res.device_id, name: 't', server: res.server, pairedAt: Date.now() })) }, [BASE, pr])
const box = () => page.locator('.composer textarea')
const open = async (s) => {
  await page.goto(BASE + '/t/' + s)
  await box().waitFor()
}
const back = async () => {
  await page.locator('a.icon[title="Threads"]').click()
  await page.waitForSelector('.thread-row')
}

// 1. Type in A, switch to B, back to A → restored; the server has it (debounced).
await open(A)
await box().pressSequentially('half a thought for A')
await page.waitForTimeout(1300)
ok((await server(A)) === 'half a thought for A', 'debounced POST /draft reached the server')
const p1 = posts.filter((p) => p.body.session === A)
ok(p1.length >= 1 && p1.length <= 3 && typeof p1.at(-1).body.at === 'number', `debounced, not per keystroke (${p1.length} POSTs for 20 keys), with an at`)
await back()
ok((await page.locator(`a.thread-row[href="/t/${A}"] .draft-mark`).count()) === 1, 'list marks A "Draft"')
await page.locator(`a.thread-row[href="/t/${B}"]`).click()
await box().waitFor()
await page.waitForTimeout(500)
ok((await box().inputValue()) === '', "B's box is empty (A's words stay with A)")
await box().pressSequentially('b words')
await back() // left the thread within the debounce: flushed on the way out
await page.waitForTimeout(400)
ok((await server(B)) === 'b words', 'leaving the thread flushed at once (inside the debounce)')
await page.screenshot({ path: SHOTS + '/draft-01-list.png' })
await page.locator(`a.thread-row[href="/t/${A}"]`).click()
await box().waitFor()
ok((await box().inputValue()) === 'half a thought for A', 'back to A: its words are back')

// 2. Reload → restored (before the network answers: slow link).
await fetch(BASE + '/mock/delay?ms=2500')
await page.reload()
await box().waitFor()
await page.waitForTimeout(300)
ok((await box().inputValue()) === 'half a thought for A', 'reload: restored at once from this device')
await fetch(BASE + '/mock/delay?ms=0')
await page.waitForTimeout(2500)

// 3. Hidden → flushed at once.
await box().pressSequentially(', more')
await page.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
  document.dispatchEvent(new Event('visibilitychange'))
})
await page.waitForTimeout(350)
ok((await server(A)) === 'half a thought for A, more', 'hidden: pushed at once, not after the debounce')
await page.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
  document.dispatchEvent(new Event('visibilitychange'))
})

// 4. Another device's newer copy wins on open…
await setServer(A, 'from the desk', Date.now() / 1000 + 5)
await back()
await page.locator(`a.thread-row[href="/t/${A}"]`).click()
await box().waitFor()
await page.waitForTimeout(600)
ok((await box().inputValue()) === 'from the desk', "a newer server copy replaces this device's")
// …unless the person has typed since open: theirs stays, and is pushed.
await setServer(A, 'from the desk, again', Date.now() / 1000 + 10)
await back()
await fetch(BASE + '/mock/delay?ms=1500')
await page.locator(`a.thread-row[href="/t/${A}"]`).click()
await box().waitFor()
await box().pressSequentially(' + mine')
await fetch(BASE + '/mock/delay?ms=0')
await page.waitForTimeout(2500)
ok((await box().inputValue()) === 'from the desk + mine', 'typed since open: the box keeps what was typed')
ok((await server(A)) === 'from the desk + mine', '…and it is pushed over the server copy')
// An older server copy never wins.
await setServer(A, 'stale', 1)
await back()
await page.locator(`a.thread-row[href="/t/${A}"]`).click()
await box().waitFor()
await page.waitForTimeout(800)
ok((await box().inputValue()) === 'from the desk + mine', 'an older server copy does not replace it')
ok((await server(A)) === 'from the desk + mine', '…and the newer local copy is pushed back')

// 5. A refused send keeps the draft; a good one clears it, here and there.
await fetch(BASE + '/mock/reply?fail=1')
await box().press('Control+Enter')
await page.waitForSelector('text=Retry', { timeout: 5000 })
await page.waitForTimeout(1200)
ok((await page.evaluate((a) => JSON.parse(localStorage.getItem('sasonica.chat.draft.' + a)).text, A)) === 'from the desk + mine', 'failed send: the draft is kept (a reload loses the bubble)')
ok((await server(A)) === 'from the desk + mine', 'failed send: the server copy is kept')
await fetch(BASE + '/mock/reply?fail=0')
await page.locator('text=Retry').first().click()
await page.waitForTimeout(1500)
ok((await server(A)) === '', 'Retry succeeded: the server draft is deleted')
await box().fill('sent straight')
await box().press('Control+Enter')
await page.waitForTimeout(1500)
ok((await box().inputValue()) === '', 'good send: the box is empty')
ok((await page.evaluate((a) => JSON.parse(localStorage.getItem('sasonica.chat.draft.' + a)).text, A)) === '', 'good send: the local draft is cleared')
ok(posts.some((p) => p.body.session === A && p.body.text === ''), 'good send: POST /draft {text: ""}')
ok((await server(A)) === '', 'good send: nothing on the server')
await back()
ok((await page.locator(`a.thread-row[href="/t/${A}"] .draft-mark`).count()) === 0, 'list: A no longer marked')

// 6. New chat: kept on this device only, cleared on a good start.
await page.goto(BASE + '/new')
await box().waitFor()
const before = posts.length
await box().pressSequentially('an idea for later')
await page.goto(BASE + '/')
await page.waitForSelector('.thread-row')
await page.goto(BASE + '/new')
await box().waitFor()
ok((await box().inputValue()) === 'an idea for later', 'new chat: the draft survives leaving and coming back')
ok(posts.length === before, 'new chat: no POST /draft (no session yet)')
await box().press('Control+Enter')
await page.waitForURL(/\/t\//, { timeout: 15000 })
await page.goto(BASE + '/new')
await box().waitFor()
ok((await box().inputValue()) === '', 'new chat: cleared once started')

ok(posts.every((p) => /^[0-9a-f-]{36}$|^\d{8}_\d{6}_/.test(p.body.session || '')), 'every POST /draft names a session')
await b.close()
process.exit(fails ? 1 : 0)
