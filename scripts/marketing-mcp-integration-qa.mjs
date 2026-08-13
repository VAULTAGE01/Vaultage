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
const viewports = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'compact', width: 375, height: 812 },
]

function startServer() {
  const server = spawn(process.execPath, [
    viteEntrypoint,
    '--config', 'vite.config.ts',
    '--host', '127.0.0.1',
    '--port', '4191',
    '--strictPort',
  ], {
    cwd: marketingRoot,
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

async function captureState(page, viewport, state, selection, receipts) {
  const module = page.locator('[data-marketing-connect]')
  await module.scrollIntoViewIfNeeded()
  const layout = await module.evaluate(element => ({
    documentHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    moduleHorizontalOverflow: element.scrollWidth > element.clientWidth,
  }))
  assert.equal(layout.documentHorizontalOverflow, false)
  assert.equal(layout.moduleHorizontalOverflow, false)
  await page.evaluate(async () => {
    await new Promise(requestAnimationFrame)
    await new Promise(requestAnimationFrame)
  })
  const screenshotPath = resolve(evidenceRoot, `${viewport.name}-${state}.png`)
  const screenshot = await page.screenshot({ path: screenshotPath })
  receipts.push({
    ...layout,
    ...selection,
    file: basename(screenshotPath),
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
        }, receipts)
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
        }, receipts)
      }
    }
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
    `${JSON.stringify({ baseUrl, states: receipts }, null, 2)}\n`,
  )
  process.stdout.write(`marketing MCP QA passed: ${receipts.length} captures in ${evidenceRoot}\n`)
} finally {
  await browser.close()
  await stopServer(server)
}
