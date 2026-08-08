#!/usr/bin/env node
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'

const projectRoot = resolve(import.meta.dirname, '..')
const evidenceRoot = resolve(process.argv[2] ?? resolve(projectRoot, '.omo/evidence/onboarding-phase-1'))
const scenarios = [
  { name: 'narrow', width: 375, height: 812 },
  { name: 'medium', width: 768, height: 800 },
  { name: 'desktop', width: 1280, height: 800 },
]

async function startServer(edition, port) {
  const server = spawn(process.execPath, [
    resolve(projectRoot, 'node_modules/vite/bin/vite.js'),
    '--config', '.omo/frontend-design/harness/vite.config.mts',
    '--host', '127.0.0.1',
    '--port', String(port),
    '--strictPort',
  ], {
    cwd: projectRoot,
    env: { ...process.env, VAULTAGE_OPEN_CORE: edition === 'community' ? '1' : '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  for (const stream of [server.stdout, server.stderr]) {
    stream?.on('data', chunk => { output = `${output}${chunk}`.slice(-16_000) })
  }

  const baseUrl = `http://127.0.0.1:${port}`
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`${edition} harness exited early\n${output}`)
    try {
      const response = await fetch(baseUrl)
      if (response.ok) return { server, baseUrl }
    } catch {
      // Vite is still starting.
    }
    await new Promise(resolveWait => setTimeout(resolveWait, 100))
  }
  throw new Error(`${edition} harness did not become ready\n${output}`)
}

async function stopServer(server) {
  if (server.exitCode !== null) return
  server.kill('SIGTERM')
  await Promise.race([once(server, 'exit'), new Promise(resolveWait => setTimeout(resolveWait, 3_000))])
  if (server.exitCode === null) server.kill('SIGKILL')
}

async function inspectPasswordLayout(page) {
  return page.evaluate(() => {
    const shell = document.querySelector('.liquid-shell')
    const section = document.querySelector('[aria-labelledby="setup-security-model-title"]')
    const password = document.querySelector('input[placeholder^="At least "]')
    const panel = password?.closest('.no-drag')
    const warning = [...document.querySelectorAll('p')]
      .find(element => element.textContent?.includes('Vaultage cannot reset this password'))
    const sectionRect = section?.getBoundingClientRect()
    const passwordRect = password?.getBoundingClientRect()
    const panelRect = panel?.getBoundingClientRect()
    const warningRect = warning?.getBoundingClientRect()
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      documentSize: {
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
      },
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      verticalOverflow: document.documentElement.scrollHeight > document.documentElement.clientHeight,
      shell: shell ? {
        clientHeight: shell.clientHeight,
        scrollHeight: shell.scrollHeight,
        scrollTop: shell.scrollTop,
        verticalOverflow: shell.scrollHeight > shell.clientHeight,
      } : null,
      sectionBeforePassword: Boolean(sectionRect && passwordRect && sectionRect.bottom <= passwordRect.top),
      panelFullyVisible: Boolean(panelRect && panelRect.top >= 0 && panelRect.bottom <= window.innerHeight),
      warningFullyVisible: Boolean(warningRect && warningRect.bottom <= window.innerHeight && warningRect.top >= 0),
    }
  })
}

async function waitForFiniteAnimations(page) {
  await page.evaluate(async () => {
    const finiteAnimations = document.getAnimations().filter(animation => (
      Number.isFinite(animation.effect?.getComputedTiming().endTime)
    ))
    await Promise.all(finiteAnimations.map(animation => animation.finished.catch(() => undefined)))
  })
}

async function captureEdition(browser, edition, port) {
  const { server, baseUrl } = await startServer(edition, port)
  const receipts = []
  try {
    for (const scenario of scenarios) {
      const context = await browser.newContext({
        viewport: { width: scenario.width, height: scenario.height },
        colorScheme: 'dark',
        reducedMotion: 'reduce',
        deviceScaleFactor: 1,
      })
      const page = await context.newPage()
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      page.on('console', message => {
        if (message.type() === 'error') errors.push(message.text())
      })
      await page.goto(`${baseUrl}/?e2e=setup`, { waitUntil: 'networkidle' })
      await page.screenshot({ path: resolve(evidenceRoot, `${edition}-${scenario.name}-welcome.png`) })
      await page.getByTitle('Create your local Vaultage vault. Shortcut: Enter').click()
      const firstPassword = page.locator('input[placeholder^="At least "]')
      const confirmation = page.locator('input[placeholder="Repeat your password"]')
      await firstPassword.waitFor()
      await firstPassword.focus()
      await waitForFiniteAnimations(page)
      await page.screenshot({ path: resolve(evidenceRoot, `${edition}-${scenario.name}-password-focus.png`) })
      await firstPassword.fill('correct horse battery staple')
      await confirmation.fill('correct horse battery staple')
      await waitForFiniteAnimations(page)
      await page.locator('.liquid-shell').evaluate(element => { element.scrollTop = 0 })
      const create = page.getByRole('button', { name: 'Create Vault', exact: true })
      assert.equal(await create.isEnabled(), true)
      await page.screenshot({ path: resolve(evidenceRoot, `${edition}-${scenario.name}-password-valid.png`) })
      const layout = await inspectPasswordLayout(page)
      receipts.push({ edition, scenario, errors, ...layout })
      assert.equal(errors.length, 0)
      assert.equal(layout.viewport.width, scenario.width)
      assert.equal(layout.viewport.height, scenario.height)
      assert.equal(layout.horizontalOverflow, false)
      assert.equal(layout.verticalOverflow, false)
      assert.equal(layout.shell?.verticalOverflow, false)
      assert.equal(layout.shell?.scrollTop, 0)
      assert.equal(layout.sectionBeforePassword, true)
      assert.equal(layout.panelFullyVisible, true)
      assert.equal(layout.warningFullyVisible, true)
      await page.getByLabel('Back').click()
      await page.getByText('Create your local vault', { exact: true }).waitFor()
      await context.close()
    }
    return receipts
  } finally {
    await stopServer(server)
  }
}

async function main() {
  await mkdir(evidenceRoot, { recursive: true })
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--disable-background-networking', '--disable-gpu', '--no-first-run'],
  })
  try {
    const receipts = [
      ...await captureEdition(browser, 'closed', 4188),
      ...await captureEdition(browser, 'community', 4189),
    ]
    const output = {
      generatedAt: new Date().toISOString(),
      pageCount: scenarios.length * 2,
      stateCaptureCount: scenarios.length * 2 * 3,
      receipts,
    }
    await writeFile(resolve(evidenceRoot, 'setup-onboarding-visual-qa.json'), `${JSON.stringify(output, null, 2)}\n`)
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
  } finally {
    await browser.close()
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
