// Background agents in a thread (§6.12) and menus that dismiss. Its own mock
// (run.mjs gives it P+3, MOCK_AGENT_STEP_S=1).
//
//   strip     hidden without agents; collapsed "2 running · 2 done · 1
//             failed · 1 stopped"; open: a tree (children under their
//             parent), running first then most recent; a running row's
//             current step moves; elapsed ticks; Start order persists
//   event     an agent finishing is an `agents` event: the summary follows
//   log       a row opens the agent's own thread, read-only (no composer),
//             its steps; Load earlier pages back; back finds the strip open
//   menus     the ⋮ menu closes on a tap outside — and that tap does not
//             press what was under it — on Escape, and on Android back
//             (window.__sasonicaBack, what Next's MainActivity calls); the
//             long-press sheet closes on a scrim tap
import { chromium, SHOTS } from './lib.mjs'
const BASE = process.env.BASE || 'http://127.0.0.1:8814'
let fails = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++ }
await fetch(BASE + '/mock/delay?ms=0')
await fetch(BASE + '/mock/agents?reset=1')
await fetch(BASE + '/mock/pair')
const pr = await (await fetch(BASE + '/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'c0ffee42' }) })).json()
const H = { Authorization: 'Bearer ' + pr.token }
const targets = (await (await fetch(BASE + '/targets', { headers: H })).json()).sessions
const sid = (t) => targets.find((s) => s.title === t)?.session
const W = sid('Mock: working')

// The mock's shapes are the contract's.
const list = await (await fetch(`${BASE}/threads/${W}/agents`, { headers: H })).json()
const keys = ['id', 'description', 'agent_type', 'is_fork', 'parent_id', 'depth', 'started_at', 'ended_at', 'status', 'current_step', 'steps', 'last_at']
ok(list.ok && list.counts.running === 2 && list.counts.total === 6 && list.agents.every((a) => JSON.stringify(Object.keys(a).sort()) === JSON.stringify([...keys].sort())), 'mock /threads/{s}/agents: counts and row keys')
const nf = await fetch(`${BASE}/threads/${W}/agents/nope/log`, { headers: H })
ok(nf.status === 404 && (await nf.json()).error === 'no such agent', 'an unknown agent is 404 "no such agent"')

const b = await chromium.launch()
const page = await (await b.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true, colorScheme: 'dark' })).newPage()
await page.route('**/input', (r) => r.abort())
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.goto(BASE + '/settings')
await page.evaluate(([base, res]) => { localStorage.setItem('sasonica.chat.baseUrl', base); localStorage.setItem('sasonica.chat.device', JSON.stringify({ token: res.token, device_id: res.device_id, name: 't', server: res.server, pairedAt: Date.now() })); localStorage.removeItem('sasonica.chat.agentsSort') }, [BASE, pr])

// 1. A thread without agents shows no strip
await page.goto(BASE + '/t/' + sid('Mock: shelved conversation'))
await page.waitForSelector('.msg')
await page.waitForTimeout(600)
ok((await page.locator('.agents-strip').count()) === 0, 'no agents: no strip')

// 2. Collapsed
await page.goto(BASE + '/t/' + W)
await page.waitForSelector('.agents-strip')
const head = page.locator('.agents-head')
await page.waitForFunction(() => document.querySelector('.agents-summary')?.textContent?.includes('stopped'))
ok((await page.locator('.agents-summary').innerText()) === '2 running · 2 done · 1 failed · 1 stopped', `collapsed: ${await page.locator('.agents-summary').innerText()}`)
ok((await head.getAttribute('aria-expanded')) === 'false' && (await page.locator('.agent-row').count()) === 0, 'collapsed by default')
await page.screenshot({ path: SHOTS + '/agents-01-collapsed.png' })

// 3. Open: the tree, running first
await head.click()
await page.waitForSelector('.agent-row')
const rows = async () => page.locator('.agents-list li').evaluateAll((els) => els.map((li) => ({ level: Number(li.dataset.level), text: li.querySelector('.agent-desc').textContent.replace('↳ ', '').replace(/fork$/, '').trim(), status: li.querySelector('.agent-row').dataset.status })))
let r = await rows()
ok(r.length === 6, `six rows (${r.length})`)
ok(JSON.stringify(r.map((x) => x.text)) === JSON.stringify(['Build the server half', 'App half (fork)', 'Research headless modes', 'Map the client routes', 'Run the long test suite', 'Old research']), `running first, children under their parent: ${r.map((x) => x.text).join(' | ')}`)
ok(r[1].level === 1 && r[2].level === 1 && r.filter((x) => x.level === 0).length === 4, 'the fork and its sibling nest one level in')
ok((await page.locator('.agents-list li').nth(1).locator('.agent-kind').innerText()) === 'fork', 'the fork is marked')
const running = page.locator('.agent-row[data-status=running]').first()
const step1 = await running.locator('.agent-step').innerText()
const t1 = await running.locator('.agent-time').innerText()
ok(!!step1 && /^\d+m \d\ds$/.test(t1), `running row: step "${step1}", elapsed ${t1}`)
ok((await page.locator('.agent-row[data-status=done] .agent-step').count()) === 0, 'a finished row shows no step')
await page.screenshot({ path: SHOTS + '/agents-02-open.png' })
await page.waitForTimeout(5600)
const step2 = await running.locator('.agent-step').innerText()
ok(step2 !== step1, `the step moved (${step1} → ${step2})`)
ok((await running.locator('.agent-time').innerText()) !== t1, 'elapsed ticks')

// 4. Start order, kept per device
await page.locator('.agents-sort').click()
r = await rows()
ok(JSON.stringify(r.map((x) => x.text)) === JSON.stringify(['Old research', 'Map the client routes', 'Run the long test suite', 'Build the server half', 'Research headless modes', 'App half (fork)']), `start order: ${r.map((x) => x.text).join(' | ')}`)
await page.reload()
await page.waitForSelector('.agents-head')
await page.locator('.agents-head').click()
await page.waitForSelector('.agent-row')
ok((await page.locator('.agents-sort').innerText()) === 'Start order' && (await rows())[0].text === 'Old research', 'Start order survives a reload')
await page.locator('.agents-sort').click()

// 5. The `agents` event: one finishes
await fetch(BASE + '/mock/agents?finish=a47fdcc9d305699f4')
await page.waitForFunction(() => document.querySelector('.agents-summary')?.textContent?.startsWith('1 running'), null, { timeout: 4000 }).catch(() => {})
ok((await page.locator('.agents-summary').innerText()) === '1 running · 3 done · 1 failed · 1 stopped', `after the event: ${await page.locator('.agents-summary').innerText()}`)

// 6. An agent's own thread, read-only, Load earlier
await page.locator('.agent-row', { hasText: 'Map the client routes' }).click()
await page.waitForURL(/\/agents\/a1c01e7815570a8f6$/)
await page.waitForSelector('.msg')
ok((await page.locator('.agent-title').innerText()) === 'Map the client routes', 'the header names the agent')
ok((await page.locator('.bar .badge').innerText()) === 'done', 'and its status')
ok((await page.locator('.composer').count()) === 0, 'read-only: no composer')
const before = await page.locator('.msg').count()
ok((await page.locator('.earlier-button').count()) === 1, 'Load earlier is offered')
await page.locator('.earlier-button').click()
await page.waitForFunction((n) => document.querySelectorAll('.msg').length > n, before, { timeout: 4000 }).catch(() => {})
const after = await page.locator('.msg').count()
ok(after > before, `Load earlier: ${before} → ${after} messages`)
ok((await page.locator('.msg.user').first().innerText()).includes('The task: Map the client routes'), 'the first message is its task')
await page.screenshot({ path: SHOTS + '/agents-03-log.png' })
await page.goBack()
await page.waitForSelector('.agents-strip')
ok((await page.locator('.agents-head').getAttribute('aria-expanded')) === 'true', 'back: the strip is as it was left (open)')

// 7. The ⋮ menu dismisses — and the dismissing tap presses nothing
const menuBtn = page.getByRole('button', { name: 'Thread menu' })
const url0 = page.url()
await menuBtn.click()
await page.waitForSelector('.menu.popover')
const box = await page.locator('.agents-head').boundingBox()
await page.mouse.click(box.x + 40, box.y + box.height / 2)
await page.waitForTimeout(200)
ok((await page.locator('.menu.popover').count()) === 0, 'a tap outside closes the ⋮ menu')
ok((await page.locator('.agents-head').getAttribute('aria-expanded')) === 'true', 'and does not press what was under it (the strip stayed open)')
await menuBtn.click()
await page.waitForSelector('.menu.popover')
const back = await page.locator('.bar a.icon').first().boundingBox()
await page.mouse.click(back.x + back.width / 2, back.y + back.height / 2)
await page.waitForTimeout(300)
ok((await page.locator('.menu.popover').count()) === 0 && page.url() === url0, 'a tap on ← while it is open only closes it (no navigation)')
await menuBtn.click()
await page.waitForSelector('.menu.popover')
await page.keyboard.press('Escape')
await page.waitForTimeout(100)
ok((await page.locator('.menu.popover').count()) === 0, 'Escape closes it')
await menuBtn.click()
await page.waitForSelector('.menu.popover')
const closed = await page.evaluate(() => window.__sasonicaBack())
await page.waitForTimeout(100)
const again = await page.evaluate(() => window.__sasonicaBack())
// The thread was opened cold (nothing behind it), so the second back goes up
// a level — Home — rather than leaving the app (components/Nav.tsx UpOnBack).
await page.waitForTimeout(300)
ok(closed === true && again === true && new URL(page.url()).pathname === '/', `Android back closes the menu first, then goes up to Home (${page.url()})`)
await page.goto(url0)
await menuBtn.waitFor()
await menuBtn.click()
await page.getByRole('menuitem', { name: 'Rename…' }).click()
await page.waitForSelector('.rename-sheet')
await page.mouse.click(195, 60)
await page.waitForTimeout(150)
ok((await page.locator('.rename-sheet').count()) === 0 && page.url() === url0, 'the rename sheet closes on a scrim tap, pressing nothing')

// 8. The list's long-press sheet: scrim tap and back
await page.goto(BASE + '/threads')
await page.waitForSelector('.thread-row')
await page.locator(`a.thread-row[href="/t/${W}"]`).dispatchEvent('contextmenu')
await page.waitForSelector('.action-sheet')
await page.mouse.click(195, 30)
await page.waitForTimeout(150)
ok((await page.locator('.action-sheet').count()) === 0 && page.url() === BASE + '/threads', 'long-press sheet: a scrim tap closes it, nothing opened')
await page.locator(`a.thread-row[href="/t/${sid('Mock: shelved conversation')}"]`).dispatchEvent('contextmenu')
await page.waitForSelector('.action-sheet')
await page.keyboard.press('Escape')
await page.waitForTimeout(100)
ok((await page.locator('.action-sheet').count()) === 0, 'and Escape closes it')

ok(!errors.length, `no page errors ${errors.join('; ')}`)
await b.close()
console.log(fails ? `${fails} FAILED` : 'ALL PASS')
process.exit(fails ? 1 : 0)
