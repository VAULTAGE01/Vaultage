#!/usr/bin/env node
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { mkdir, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { chromium } from 'playwright-core'

const projectRoot = resolve(import.meta.dirname, '..')
const marketingRoot = resolve(projectRoot, 'marketing-web')
const evidenceRoot = resolve(
  process.argv[2] ?? resolve(projectRoot, '.omo/evidence/marketing-mcp-integration'),
)
const viteEntrypoint = resolve(projectRoot, 'marketing-web/node_modules/vite/bin/vite.js')
const baseUrl = 'http://127.0.0.1:4191'
const transports = ['mcp', 'cli']
const clients = [
  { id: 'claude-code' },
  { id: 'codex' },
  { id: 'cursor' },
  { id: 'claude-desktop' },
]
const journeys = [
  { id: 'retrieve', label: 'Retrieve' },
  { id: 'provision', label: 'Provision' },
  { id: 'manage', label: 'Manage' },
  { id: 'browser-fill', label: 'Fill in browser' },
  { id: 'browser-save', label: 'Save from browser' },
]
const allViewports = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'tablet', width: 768, height: 900 },
  { name: 'compact', width: 375, height: 812 },
]
const requestedViewport = process.env.MARKETING_QA_VIEWPORT
const viewports = requestedViewport
  ? allViewports.filter(viewport => viewport.name === requestedViewport)
  : allViewports

if (viewports.length === 0) throw new Error(`Unknown MARKETING_QA_VIEWPORT: ${requestedViewport}`)

function startServer() {
  const server = spawn(process.execPath, [
    viteEntrypoint,
    '--config', 'vite.config.ts',
    '--host', '127.0.0.1',
    '--port', '4191',
    '--strictPort',
  ], {
    cwd: marketingRoot,
    env: { ...process.env, VITE_DISABLE_REACT_DEVTOOLS: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  for (const stream of [server.stdout, server.stderr]) {
    stream?.on('data', chunk => { output = `${output}${chunk}`.slice(-16_000) })
  }
  return { server, output: () => output }
}

async function waitForServer(server, output) {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Marketing server exited early\n${output()}`)
    try {
      const response = await fetch(baseUrl)
      if (response.ok) return
    } catch {
      // Vite is still starting.
    }
    await new Promise(resolveWait => setTimeout(resolveWait, 100))
  }
  throw new Error(`Marketing server did not become ready\n${output()}`)
}

async function stopServer(server) {
  if (server.exitCode !== null) return
  server.kill('SIGTERM')
  await Promise.race([once(server, 'exit'), new Promise(resolveWait => setTimeout(resolveWait, 3_000))])
  if (server.exitCode === null) {
    server.kill('SIGKILL')
    await once(server, 'exit')
  }
}

async function captureState(page, viewport, state, selection, receipts, selector) {
  const module = page.locator(selector)
  await module.scrollIntoViewIfNeeded()
  await module.evaluate(element => {
    const top = element.getBoundingClientRect().top
    window.scrollBy({ top: top - 80, behavior: 'instant' })
  })
  const layout = await module.evaluate(element => ({
    documentHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    moduleHorizontalOverflow: element.scrollWidth > element.clientWidth,
    hiddenDescendantOverflow: [...element.querySelectorAll('*')].some(child => child.scrollWidth > child.clientWidth + 1 && getComputedStyle(child).overflowX === 'hidden'),
  }))
  assert.equal(layout.documentHorizontalOverflow, false)
  assert.equal(layout.moduleHorizontalOverflow, false)
  assert.equal(layout.hiddenDescendantOverflow, false)
  await page.evaluate(async () => {
    await new Promise(requestAnimationFrame)
    await new Promise(requestAnimationFrame)
  })
  const screenshotPath = resolve(evidenceRoot, `${viewport.name}-${state}.png`)
  const screenshot = await page.screenshot({ path: screenshotPath })
  assert.deepEqual([...screenshot.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'capture must be PNG')
  assert.equal(screenshot.readUInt32BE(16), viewport.width, 'capture width must match viewport')
  assert.equal(screenshot.readUInt32BE(20), viewport.height, 'capture height must match viewport')
  const modulePath = resolve(evidenceRoot, `${viewport.name}-${state}-module.png`)
  const moduleCapture = await module.screenshot({ path: modulePath })
  if (moduleCapture) assert.deepEqual([...moduleCapture.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'module capture must be PNG')
  receipts.push({
    ...layout,
    ...selection,
    file: basename(screenshotPath),
    ...(moduleCapture && modulePath ? {
      moduleFile: basename(modulePath),
      moduleHeight: moduleCapture.readUInt32BE(20),
      moduleWidth: moduleCapture.readUInt32BE(16),
    } : {}),
    sha256: createHash('sha256').update(screenshot).digest('hex'),
    state,
    viewport,
  })
}

async function assertConnectionState(page, state) {
  assert.equal(
    await page.locator('[data-marketing-connect-state]').getAttribute('data-marketing-connect-state'),
    state,
  )
  assert.equal(await page.locator('[data-marketing-connect-step]').count(), 3)
}

async function verifyViewport(browser, viewport, receipts) {
  const context = await browser.newContext({ viewport, colorScheme: 'dark', reducedMotion: 'reduce' })
  const page = await context.newPage()
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      if (typeof type === 'string' && type.startsWith('webgl')) return null
      return getContext.call(this, type, ...args)
    }
  })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => {
    if (message.type() === 'error' && !message.text().includes('THREE.WebGLRenderer: Error creating WebGL context.')) {
      errors.push(message.text())
    }
  })

  try {
    await page.goto(baseUrl, { waitUntil: 'networkidle' })
    await page.locator('[data-marketing-connect]').waitFor()

    for (const transport of transports) {
      await page.locator(`[data-marketing-connect-transport="${transport}"]`).click()
      assert.equal(
        await page.locator(`[data-marketing-connect-transport="${transport}"]`).getAttribute('aria-selected'),
        'true',
      )
      if (transport === 'cli') {
        await assertConnectionState(page, 'cli')
        assert.equal(await page.locator('[data-marketing-connect-client]').count(), 0)
        await captureState(page, viewport, transport, {
          transport,
        }, receipts, '[data-marketing-connect]')
        continue
      }

      for (const client of clients) {
        await page.locator(`[data-marketing-connect-client="${client.id}"]`).click()
        assert.equal(
          await page.locator(`[data-marketing-connect-client="${client.id}"]`).getAttribute('aria-selected'),
          'true',
        )
        await assertConnectionState(page, `${transport}:${client.id}`)
        await page.waitForTimeout(100)
        await captureState(page, viewport, `${transport}-${client.id}`, {
          client: client.id,
          transport,
        }, receipts, '[data-marketing-connect]')
      }
    }

    const journeyTabs = page.locator('[role="tab"][aria-controls="journey-workspace"]')
    assert.equal(await journeyTabs.count(), journeys.length)
    for (const journey of journeys) {
      const tab = page.getByRole('tab', { name: new RegExp(journey.label) })
      await tab.click()
      assert.equal(await tab.getAttribute('aria-selected'), 'true')
      assert.equal(await page.locator(`[data-journey-product="${journey.id}"]`).count(), 1)
      await captureState(page, viewport, `journey-${journey.id}`, {
        journey: journey.id,
      }, receipts, '.mh-journeys')
    }

    const keyboardTarget = page.getByRole('tab', { name: /Save from browser/ })
    await keyboardTarget.focus()
    await keyboardTarget.press('Home')
    const retrieveTab = page.getByRole('tab', { name: /Retrieve/ })
    assert.equal(await retrieveTab.getAttribute('aria-selected'), 'true')
    assert.equal(await retrieveTab.evaluate(element => document.activeElement === element), true)
    await page.locator('[data-marketing-connect-transport="mcp"]').click()
    const codexTab = page.locator('[data-marketing-connect-client="codex"]')
    await codexTab.focus()
    await codexTab.press('Home')
    const claudeCodeTab = page.locator('[data-marketing-connect-client="claude-code"]')
    assert.equal(await claudeCodeTab.evaluate(element => document.activeElement === element), true)
    const mcpTransport = page.locator('[data-marketing-connect-transport="mcp"]')
    await mcpTransport.focus()
    await mcpTransport.press('End')
    const cliTransport = page.locator('[data-marketing-connect-transport="cli"]')
    assert.equal(await cliTransport.evaluate(element => document.activeElement === element), true)
    assert.equal(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true)
    assert.deepEqual(errors, [])
  } finally {
    await context.close()
  }
}

await mkdir(evidenceRoot, { recursive: true })
const { server, output } = startServer()
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: [
    '--disable-background-networking',
    '--disable-gpu',
    '--no-first-run',
  ],
})
const receipts = []

try {
  await waitForServer(server, output)
  for (const viewport of viewports) await verifyViewport(browser, viewport, receipts)
  await writeFile(
    resolve(evidenceRoot, 'receipt.json'),
    `${JSON.stringify({ baseUrl, requestedViewport: requestedViewport ?? 'all', states: receipts }, null, 2)}\n`,
  )
  process.stdout.write(`marketing MCP QA passed: ${receipts.length} captures in ${evidenceRoot}\n`)
} catch (error) {
  await writeFile(
    resolve(evidenceRoot, 'failure.json'),
    `${JSON.stringify({ error: error instanceof Error ? error.stack : String(error), states: receipts }, null, 2)}\n`,
  )
  throw error
} finally {
  await browser.close()
  await stopServer(server)
}
