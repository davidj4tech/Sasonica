import { chromium, SHOTS } from './lib.mjs'
const BASE = process.env.BASE || 'http://127.0.0.1:8811'
let fails = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++ }
const b = await chromium.launch()
const newPage = async () => {
  const ctx = await b.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true })
  const page = await ctx.newPage()
  await page.route('**/input', (r) => r.abort())
  page.reqs = []
  page.on('request', (r) => { const u = new URL(r.url()); if (u.origin === BASE && !u.pathname.startsWith('/assets') && r.method() !== 'OPTIONS') page.reqs.push({ m: r.method(), p: u.pathname + u.search, auth: r.headers()['authorization'] || '', body: r.postData() }) })
  page.on('pageerror', (e) => console.log('  pageerror', e.message))
  return page
}
const sessions = await (await fetch(BASE + '/targets', { headers: { Authorization: 'Bearer abs' } })).json()
const sid = (t) => sessions.sessions.find((s) => s.title === t).session

// 1. Fresh install → Pair screen → code → list → open by session → reply
await fetch(BASE + '/mock/pair')
let page = await newPage()
await page.goto(BASE + '/')
await page.waitForURL('**/pairing')
ok(true, 'fresh install lands on /pairing')
await page.screenshot({ path: SHOTS + '/pair-01-first-run.png' })
await page.getByLabel('Server address').fill(BASE)
await page.getByLabel('Code').fill('c0ffee42')
await page.getByRole('button', { name: 'Pair' }).click()
await page.waitForURL(BASE + '/')
await page.waitForSelector('.thread-row')
const dev = await page.evaluate(() => JSON.parse(localStorage.getItem('sasonica.chat.device')))
ok(dev && dev.token.startsWith('mock-dev-') && dev.device_id.startsWith('d_') && dev.server.base === BASE, 'paired: token + device_id + server base stored')
ok(!(await page.evaluate(() => localStorage.getItem('sasonica.chat.token'))), 'no ABS token stored')
const listReqs = page.reqs.filter((r) => r.p.startsWith('/targets'))
ok(listReqs.length && listReqs.every((r) => r.auth === 'Bearer ' + dev.token), 'list asked with the device token')
// open a shelved thread, cold (no cache for it — new context was fresh, but prefetch may have warmed it; count from click)
await page.waitForTimeout(300)
page.reqs.length = 0
const target = sid('Mock: shelved conversation')
await page.goto(BASE + '/t/' + target) // fresh load: memory cache empty
await page.waitForSelector('.msg')
await page.waitForTimeout(600)
const convReqs = page.reqs.filter((r) => r.p.startsWith('/conversation'))
console.log('  open requests:', JSON.stringify(convReqs.map((r) => r.m + ' ' + r.p)))
ok(convReqs.length >= 1 && convReqs[0].p === `/conversation/log?session=${target}`, 'first request is /conversation/log?session=')
ok(!convReqs.some((r) => r.p.startsWith('/conversation?')), 'no /conversation?session= lookup')
ok(!page.reqs.some((r) => r.p.includes('item=')), 'no item anywhere')
// reply
await page.locator('.composer textarea').fill('hello by session')
await page.locator('.composer textarea').press('Control+Enter')
await page.waitForSelector('text=hello by session')
await page.waitForSelector('text=I heard: “hello by session”', { timeout: 15000 })
const rep = page.reqs.find((r) => r.m === 'POST' && r.p === '/reply')
ok(rep && JSON.parse(rep.body).session === target && !('item' in JSON.parse(rep.body)), 'POST /reply {session, text}')
ok(true, 'reply answered in the thread')

// 2. not-on-shelf thread readable + repliable
page.reqs.length = 0
const fresh = sid('Mock: not on the shelf yet')
await page.goto(BASE + '/t/' + fresh)
await page.waitForSelector('text=A brand new chat.')
ok(!(await page.locator('text=Not on the shelf yet.').count()), 'unshelved thread shows its lines (no "not on the shelf" state)')
await page.locator('.composer textarea').fill('unshelved reply')
await page.locator('.composer textarea').press('Control+Enter')
await page.waitForSelector('text=I heard: “unshelved reply”', { timeout: 15000 })
ok(true, 'unshelved thread repliable')
await page.screenshot({ path: SHOTS + '/pair-02-unshelved.png' })

// 3. Settings shows the device; Unpair
await page.goto(BASE + '/settings')
await page.waitForSelector('text=Paired as')
await page.screenshot({ path: SHOTS + '/pair-03-settings-paired.png' })
ok((await page.locator('.paired').innerText()).includes(dev.device_id), 'Settings shows device id')
await page.getByRole('button', { name: 'Unpair' }).click()
await page.waitForSelector('text=Not paired.')
ok(!(await page.evaluate(() => localStorage.getItem('sasonica.chat.device'))), 'unpair forgets the device')
await page.screenshot({ path: SHOTS + '/pair-04-unpaired.png' })
await page.goto(BASE + '/')
await page.waitForURL('**/pairing')
ok(true, 'unpaired → list sends to /pairing')

// 4. Used code refused; wrong code refused; re-armed code via auto-pair link
await page.getByLabel('Server address').fill(BASE)
await page.getByLabel('Code').fill('c0ffee42')
await page.getByRole('button', { name: 'Pair' }).click()
await page.waitForSelector('.status.failed')
ok((await page.locator('.status.failed').innerText()).includes('wrong, already used, or expired'), 'spent code refused with the explanation')
await page.screenshot({ path: SHOTS + '/pair-05-refused.png' })
await fetch(BASE + '/mock/pair')
page.reqs.length = 0
await page.goto(`${BASE}/?pair=c0ffee42&server=${encodeURIComponent(BASE)}`)
await page.waitForSelector('.thread-row', { timeout: 10000 })
ok(page.url() === BASE + '/', 'auto-pair link → paired, lands on the list, code gone from the URL')
ok(page.reqs.filter((r) => r.p === '/pair').length === 1, 'auto-pair spent exactly one POST /pair')

// 5. pasted sasonica:// link
await page.evaluate(() => localStorage.removeItem('sasonica.chat.device'))
await fetch(BASE + '/mock/pair')
await page.goto(BASE + '/pairing')
await page.getByLabel('Pairing link').fill(`sasonica://pair?server=${encodeURIComponent(BASE)}&code=c0ffee42`)
await page.getByRole('button', { name: 'Pair' }).click()
await page.waitForURL(BASE + '/')
ok(!!(await page.evaluate(() => localStorage.getItem('sasonica.chat.device'))), 'pasted sasonica:// link pairs')

// 6. revoked device → 401 in the list
const d2 = await page.evaluate(() => JSON.parse(localStorage.getItem('sasonica.chat.device')))
await fetch(BASE + '/mock/devices?revoke=' + d2.device_id)
await page.goto(BASE + '/')
await page.waitForSelector('.notice.error')
ok((await page.locator('.notice.error').innerText()).includes('rejected'), 'revoked device token → 401 shown')

// 7. Legacy ABS token still works (Advanced / legacy)
await page.evaluate(() => localStorage.removeItem('sasonica.chat.device'))
await page.goto(BASE + '/settings')
await page.locator('details.advanced summary').click()
await page.getByLabel('Server address').fill(BASE)
await page.getByLabel('Audiobookshelf token').fill('legacy-abs')
await page.getByRole('button', { name: 'Save and test' }).click()
await page.waitForSelector('text=OK —')
await page.screenshot({ path: SHOTS + '/pair-06-legacy.png' })
page.reqs.length = 0
await page.goto(BASE + '/')
await page.waitForSelector('.thread-row')
await page.waitForTimeout(300)
ok(page.reqs.filter((r) => r.p.startsWith('/targets')).every((r) => r.auth === 'Bearer legacy-abs'), 'legacy ABS token sent when not paired')
page.reqs.length = 0
await page.goto(BASE + '/t/' + target)
await page.waitForSelector('.msg')
ok(page.reqs.some((r) => r.p === `/conversation/log?session=${target}` && r.auth === 'Bearer legacy-abs'), 'legacy token opens a thread by session')
await b.close()
console.log(fails ? `${fails} FAILED` : 'ALL PASS')
process.exit(fails ? 1 : 0)
