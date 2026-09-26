// Coding agents, from Settings: a row per harness with its version and
// sign-in state; Sign out only where it is signed in, and it asks first; Codex's Sign in opens the window, shows its link, and a
// pasted code + Enter signs it in (the list says so after Done); pi's
// Install runs to "finished" and pi is then installed; pi has no Sign in,
// Hermes no sign-in state. Portrait, landscape and the largest text size.
import { chromium, SHOTS } from './lib.mjs'
import path from 'node:path'
const BASE = process.env.BASE || 'http://127.0.0.1:8811'
let fails = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++ }
await fetch(BASE + '/mock/pair')
const pr = await (await fetch(BASE + '/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'c0ffee42' }) })).json()

const b = await chromium.launch()
for (const [name, vp, size] of [
  ['portrait', { width: 390, height: 780 }, 'default'],
  ['landscape', { width: 844, height: 390 }, 'default'],
  ['portrait-largest', { width: 390, height: 780 }, 'largest']
]) {
  await fetch(BASE + '/mock/harnesses?reset=1')
  const ctx = await b.newContext({ viewport: vp, isMobile: true, hasTouch: true, colorScheme: 'dark' })
  const page = await ctx.newPage()
  await page.route('**/input', (r) => r.abort())
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(BASE + '/settings')
  await page.evaluate(([base, res, s]) => {
    localStorage.setItem('sasonica.chat.textSize2', s)
    localStorage.setItem('sasonica.chat.baseUrl', base)
    localStorage.setItem('sasonica.chat.device', JSON.stringify({ token: res.token, device_id: res.device_id, name: 't', server: res.server, pairedAt: Date.now() }))
  }, [BASE, pr, size])
  await page.goto(BASE + '/settings')
  const link = page.locator('a.about-row', { hasText: 'Coding agents' })
  await link.scrollIntoViewIfNeeded()
  ok((await link.boundingBox()).height >= 44, `${name}: Settings has a 44 px "Coding agents" row`)
  await link.click()
  await page.waitForURL(/\/settings\/agents$/)
  await page.waitForSelector('.setup-item[data-agent=codex]')
  const row = (a) => page.locator(`.setup-item[data-agent=${a}]`)
  ok((await row('claude').innerText()).includes('signed in (you@example.com)'), `${name}: Claude signed in, with its account`)
  ok((await row('codex').innerText()).includes('codex-cli 0.155.1 · signed out'), `${name}: Codex's version, signed out`)
  ok((await row('pi').innerText()).includes('not installed'), `${name}: pi not installed`)
  ok(!(await row('hermes').innerText()).includes('signed'), `${name}: Hermes claims no sign-in state`)
  ok((await row('pi').getByRole('button', { name: 'Sign in' }).count()) === 0, `${name}: pi has no Sign in`)
  // The slow half (GET /harnesses/updates) lands after the rows: Codex has
  // something newer, Claude has not and so loses its Update button.
  await page.waitForFunction(() => document.querySelector('.setup-item[data-agent=claude]')?.textContent?.includes('up to date'))
  ok((await row('claude').getByRole('button', { name: 'Update' }).count()) === 0, `${name}: an up-to-date agent offers no Update`)
  ok((await row('codex').getByRole('button', { name: 'Update to 0.156.0' }).count()) === 1, `${name}: one that is behind says what it would move to`)
  ok((await row('codex').innerText()).includes('0.156.0 is out'), `${name}: and its row says so`)
  ok((await row('hermes').innerText()).includes('an update is out'), `${name}: the one that is not a package answers its own check`)
  await page.screenshot({ path: path.join(SHOTS, `harnesses-${name}.png`) })

  // Sign in to Codex: the link shows, a code goes back, the list agrees.
  await row('codex').getByRole('button', { name: 'Sign in' }).click()
  await page.waitForSelector('.setup-window .setup-screen:has-text("auth.example.com")')
  ok((await page.locator('.setup-cmd').innerText()) === 'codex login --device-auth', `${name}: the window names its command`)
  ok(await row('codex').getByRole('button', { name: 'Update to 0.156.0' }).isDisabled(), `${name}: other buttons wait while a window is open`)
  await page.screenshot({ path: path.join(SHOTS, `harnesses-${name}-signin.png`) })
  await page.getByLabel('Type into the window').fill('ABCD-1234')
  await page.getByLabel('Type into the window').press('Enter')
  await page.waitForSelector('.setup-exit.ok')
  const typed = (await (await fetch(BASE + '/mock/harnesses')).json()).keys
  ok(typed.some((k) => k.text === 'ABCD-1234' && k.key === 'Enter'), `${name}: the code was typed, then Enter`)
  await page.locator('.setup-window').getByRole('button', { name: 'Done' }).click()
  await page.waitForFunction(() => document.querySelector('.setup-item[data-agent=codex]')?.textContent?.includes('signed in'))
  ok((await page.locator('.setup-window').count()) === 0, `${name}: Done closes the window`)
  ok((await row('codex').innerText()).includes('signed in (you@example.com)'), `${name}: Codex now signed in`)

  // Sign out is offered only where the row says signed in, and asks first.
  ok((await row('pi').getByRole('button', { name: 'Sign out' }).count()) === 0, `${name}: nothing to sign out of on a missing agent`)
  await row('codex').getByRole('button', { name: 'Sign out' }).click()
  ok((await row('codex').innerText()).includes('New Codex chats'), `${name}: the confirm names what it costs`)
  await row('codex').getByRole('button', { name: 'Cancel' }).click()
  ok((await row('codex').innerText()).includes('signed in'), `${name}: Cancel signs nothing out`)
  ok(((await (await fetch(BASE + '/mock/harnesses')).json()).logouts).length === 0, `${name}: and asked the server nothing`)
  await row('codex').getByRole('button', { name: 'Sign out' }).click()
  await row('codex').getByRole('button', { name: 'Sign out' }).click()
  await page.waitForFunction(() => document.querySelector('.setup-item[data-agent=codex]')?.textContent?.includes('signed out'))
  ok((await page.locator('.setup-window').count()) === 0, `${name}: signing out opens no window`)
  ok(((await (await fetch(BASE + '/mock/harnesses')).json()).logouts).join() === 'codex', `${name}: exactly one sign-out, of Codex`)
  ok((await row('codex').getByRole('button', { name: 'Sign out' }).count()) === 0, `${name}: and the button is gone with it`)

  // Install pi: runs to finished, then pi is there.
  await row('pi').getByRole('button', { name: 'Install' }).click()
  await page.waitForSelector('.setup-exit.ok', { timeout: 10000 })
  await page.locator('.setup-window').getByRole('button', { name: 'Done' }).click()
  await page.waitForFunction(() => !document.querySelector('.setup-item[data-agent=pi]')?.textContent?.includes('not installed'))
  // Freshly installed, so it is current: nothing to update, and no button.
  await page.waitForFunction(() => document.querySelector('.setup-item[data-agent=pi]')?.textContent?.includes('up to date'))
  ok((await row('pi').getByRole('button', { name: 'Update' }).count()) === 0, `${name}: pi is current, so it offers no Update`)
  const log = await (await fetch(BASE + '/mock/harnesses')).json()
  ok(JSON.stringify(log.runs) === JSON.stringify([{ agent: 'codex', action: 'login' }, { agent: 'pi', action: 'install' }]), `${name}: ran exactly codex login, pi install`)
  ok(log.closed.length === 2, `${name}: both windows closed on the server`)

  // New chat offers what could answer: Codex is here but signed out (dimmed,
  // with the way to fix it), and nothing that is not installed is offered.
  await fetch(BASE + '/mock/harnesses?reset=1')
  await page.goto(BASE + '/new')
  await page.click('.new-summary')
  await page.waitForSelector('.new-sheet .chip')
  const agentChips = page.locator('.new-sheet .chips .chip')
  await page.waitForFunction(() => !![...document.querySelectorAll('.chips .chip')].find((c) => c.textContent === 'Codex' && c.classList.contains('chip-out')))
  ok((await agentChips.filter({ hasText: 'pi' }).count()) === 0, `${name}: an agent this host has not got is not offered`)
  ok((await agentChips.filter({ hasText: 'Claude' }).count()) === 1, `${name}: the signed-in one is`)
  await agentChips.filter({ hasText: 'Codex' }).click()
  await page.click('.new-sheet button.primary')
  ok((await page.locator('.picker-note').innerText()).includes('Signed out'), `${name}: picking it says why it would not answer`)
  ok((await page.locator('.picker-note a').getAttribute('href')) === '/harnesses', `${name}: and links to Coding agents`)
  await page.goto(BASE + '/settings/agents')
  await page.waitForSelector('.setup-item[data-agent=codex]')

  const small = await page.evaluate(() => [...document.querySelectorAll('.setup-actions button')].filter((e) => e.getBoundingClientRect().height < 32).length)
  ok(small === 0, `${name}: action buttons are tappable`)
  ok(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)), `${name}: no sideways scroll`)
  ok(errors.length === 0, `${name}: no page errors${errors.length ? ' — ' + errors.join('; ') : ''}`)
  await ctx.close()
}
await b.close()
process.exit(fails ? 1 : 0)
