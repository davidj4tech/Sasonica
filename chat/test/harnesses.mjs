// Coding agents, from Settings: a row per harness with its version and
// sign-in state; Codex's Sign in opens the window, shows its link, and a
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
  ok((await row('claude').getByRole('button', { name: 'Update' }).count()) === 1, `${name}: an installed one says Update`)
  await page.screenshot({ path: path.join(SHOTS, `harnesses-${name}.png`) })

  // Sign in to Codex: the link shows, a code goes back, the list agrees.
  await row('codex').getByRole('button', { name: 'Sign in' }).click()
  await page.waitForSelector('.setup-window .setup-screen:has-text("auth.example.com")')
  ok((await page.locator('.setup-cmd').innerText()) === 'codex login', `${name}: the window names its command`)
  ok(await row('claude').getByRole('button', { name: 'Update' }).isDisabled(), `${name}: other buttons wait while a window is open`)
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

  // Install pi: runs to finished, then pi is there.
  await row('pi').getByRole('button', { name: 'Install' }).click()
  await page.waitForSelector('.setup-exit.ok', { timeout: 10000 })
  await page.locator('.setup-window').getByRole('button', { name: 'Done' }).click()
  await page.waitForFunction(() => !document.querySelector('.setup-item[data-agent=pi]')?.textContent?.includes('not installed'))
  ok((await row('pi').getByRole('button', { name: 'Update' }).count()) === 1, `${name}: pi installed, its button now Update`)
  const log = await (await fetch(BASE + '/mock/harnesses')).json()
  ok(JSON.stringify(log.runs) === JSON.stringify([{ agent: 'codex', action: 'login' }, { agent: 'pi', action: 'install' }]), `${name}: ran exactly codex login, pi install`)
  ok(log.closed.length === 2, `${name}: both windows closed on the server`)

  const small = await page.evaluate(() => [...document.querySelectorAll('.setup-actions button')].filter((e) => e.getBoundingClientRect().height < 32).length)
  ok(small === 0, `${name}: action buttons are tappable`)
  ok(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)), `${name}: no sideways scroll`)
  ok(errors.length === 0, `${name}: no page errors${errors.length ? ' — ' + errors.join('; ') : ''}`)
  await ctx.close()
}
await b.close()
process.exit(fails ? 1 : 0)
