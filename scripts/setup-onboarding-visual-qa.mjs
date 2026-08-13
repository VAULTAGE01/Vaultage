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
  { name: 'desktop', width: 1280, height: 900 },
]
const motionModes = [
  { name: 'normal', reducedMotion: 'no-preference' },
  { name: 'reduced', reducedMotion: 'reduce' },
]
const strongPassword = 'Correct Horse Battery Staple! 2026'
const baseStatesPerContext = 17
const closedAccountStatesPerContext = 3

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

async function inspectLayout(page) {
  return page.evaluate(() => {
    const shell = document.querySelector('.ui26-onboarding-shell')
    const section = document.querySelector('[aria-labelledby="setup-security-model-title"]')
    const password = document.querySelector('#setup-master-password')
    const panel = document.querySelector('.ui26-onboarding-frame')
    const warning = document.querySelector('.ui26-onboarding-callout--warning')
    const primaryAction = document.querySelector('[data-ui26-tone="primary"]')
    const sectionRect = section?.getBoundingClientRect()
    const passwordRect = password?.getBoundingClientRect()
    const panelRect = panel?.getBoundingClientRect()
    const warningRect = warning?.getBoundingClientRect()
    const primaryRect = primaryAction?.getBoundingClientRect()
    const shellStyle = shell ? getComputedStyle(shell) : null
    const animations = document.getAnimations().filter(animation => animation.playState === 'running')
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
        overflowY: shellStyle?.overflowY,
      } : null,
      sectionBeforePassword: Boolean(sectionRect && passwordRect && sectionRect.bottom <= passwordRect.top),
      panelStartsWithinViewport: Boolean(panelRect && panelRect.top >= 0),
      panelStartReachable: Boolean(panelRect && ((shell?.scrollTop ?? 0) > 0 || panelRect.top >= 0)),
      panelFullyVisible: Boolean(panelRect && panelRect.top >= 0 && panelRect.bottom <= window.innerHeight),
      warningFullyVisible: Boolean(warningRect && warningRect.bottom <= window.innerHeight && warningRect.top >= 0),
      primaryActionWithinViewport: Boolean(primaryRect && primaryRect.left >= 0 && primaryRect.right <= window.innerWidth),
      runningCssAnimationCount: animations.length,
    }
  })
}

async function inspectFocus(page) {
  return page.evaluate(() => {
    const active = document.activeElement
    if (!(active instanceof HTMLElement)) return null
    const style = getComputedStyle(active)
    return {
      action: active.dataset.onboardingAction ?? null,
      id: active.id || null,
      borderColor: style.borderColor,
      boxShadow: style.boxShadow,
      outlineColor: style.outlineColor,
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
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

async function openSetup(page, baseUrl, setupResult, accountState = 'ready') {
  const resultQuery = setupResult ? `&setup-result=${setupResult}` : ''
  await page.goto(`${baseUrl}/?e2e=setup&account-state=${accountState}${resultQuery}`, {
    waitUntil: 'networkidle',
  })
  await page.locator('[data-onboarding-action="create-local"]').waitFor()
}

async function enterPassword(page) {
  await page.locator('[data-onboarding-action="create-local"]').click()
  await page.locator('#setup-master-password').waitFor()
}

async function fillValidPassword(page) {
  await page.locator('#setup-master-password').fill(strongPassword)
  await page.locator('#setup-confirm-password').fill(strongPassword)
}

async function captureState(page, stateReceipts, contextName, state) {
  await waitForFiniteAnimations(page)
  const layout = await inspectLayout(page)
  stateReceipts.push({ state, ...layout })
  assert.equal(layout.horizontalOverflow, false)
  assert.equal(layout.verticalOverflow, false)
  assert.equal(layout.shell?.overflowY, 'auto')
  assert.equal(layout.panelStartReachable, true)
  assert.equal(layout.primaryActionWithinViewport, true)
  await page.screenshot({ path: resolve(evidenceRoot, `${contextName}-${state}.png`) })
  return layout
}

async function captureFooterState(page, stateReceipts, contextName, state) {
  const warning = page.locator('.ui26-onboarding-callout--warning')
  await warning.evaluate(element => {
    const shell = element.closest('.ui26-onboarding-shell')
    if (shell) shell.scrollTop = shell.scrollHeight
  })
  const layout = await captureState(page, stateReceipts, contextName, state)
  assert.equal(layout.warningFullyVisible, true)
  return layout
}

async function scrollSetupToTop(page) {
  await page.locator('.ui26-onboarding-shell').evaluate(element => {
    element.scrollTop = 0
  })
}

async function captureEdition(browser, edition, port) {
  const { server, baseUrl } = await startServer(edition, port)
  const receipts = []
  try {
    for (const scenario of scenarios) {
      for (const motion of motionModes) {
        const context = await browser.newContext({
          viewport: { width: scenario.width, height: scenario.height },
          colorScheme: 'dark',
          reducedMotion: motion.reducedMotion,
          deviceScaleFactor: 1,
        })
        const page = await context.newPage()
        const errors = []
        const stateReceipts = []
        const contextName = `${edition}-${scenario.name}-${motion.name}`
        page.on('pageerror', error => errors.push(error.message))
        page.on('console', message => {
          if (message.type() === 'error') errors.push(message.text())
        })

        try {
          await openSetup(page, baseUrl)
          const welcomeLayout = await captureState(page, stateReceipts, contextName, 'welcome-rest')
          assert.deepEqual(welcomeLayout.viewport, { width: scenario.width, height: scenario.height })

          if (edition === 'closed') {
            await openSetup(page, baseUrl, undefined, 'unavailable')
            assert.equal(await page.locator('[data-onboarding-action="create-account"]').isDisabled(), true)
            assert.equal(await page.locator('[data-onboarding-action="sign-in"]').isDisabled(), true)
            assert.equal(await page.locator('[data-onboarding-action="create-local"]').isEnabled(), true)
            await captureState(page, stateReceipts, contextName, 'account-unavailable')

            await openSetup(page, baseUrl, undefined, 'error')
            await page.getByRole('alert').waitFor()
            await captureState(page, stateReceipts, contextName, 'account-error')

            await openSetup(page, baseUrl, undefined, 'signed-in')
            await page.locator('[data-onboarding-action="continue-account"]').waitFor()
            assert.equal(await page.locator('[data-onboarding-action="create-account"]').count(), 0)
            assert.equal(await page.locator('[data-onboarding-action="sign-in"]').count(), 0)
            await captureState(page, stateReceipts, contextName, 'account-signed-in')

            await openSetup(page, baseUrl)
          }

          await page.keyboard.press('Tab')
          const welcomeFocus = await inspectFocus(page)
          assert.equal(welcomeFocus?.action, edition === 'community' ? 'create-local' : 'create-account')
          assert.equal(welcomeFocus?.outlineStyle, 'solid')
          assert.equal(welcomeFocus?.outlineWidth, '2px')
          await captureState(page, stateReceipts, contextName, 'welcome-focus')

          const createLocal = page.locator('[data-onboarding-action="create-local"]')
          await createLocal.hover()
          await page.mouse.down()
          try {
            await captureState(page, stateReceipts, contextName, 'welcome-press')
          } finally {
            await page.mouse.up()
          }

          await page.locator('#setup-master-password').waitFor()
          await page.keyboard.press('Tab')
          await page.keyboard.press('Shift+Tab')
          const passwordFocus = await inspectFocus(page)
          assert.equal(passwordFocus?.id, 'setup-master-password')
          assert.equal(passwordFocus?.outlineStyle, 'solid')
          assert.equal(passwordFocus?.outlineWidth, '2px')
          assert.notEqual(passwordFocus?.outlineColor, 'rgba(0, 0, 0, 0)')
          await captureState(page, stateReceipts, contextName, 'password-focus')

          const firstPassword = page.locator('#setup-master-password')
          const confirmation = page.locator('#setup-confirm-password')
          await firstPassword.fill('too short')
          assert.equal(await firstPassword.getAttribute('aria-invalid'), 'true')
          await captureState(page, stateReceipts, contextName, 'password-invalid')
          await captureFooterState(page, stateReceipts, contextName, 'password-invalid-footer')

          await firstPassword.fill(strongPassword)
          await confirmation.fill('Different Correct Phrase! 2026')
          assert.equal(await confirmation.getAttribute('aria-invalid'), 'true')
          await scrollSetupToTop(page)
          await captureState(page, stateReceipts, contextName, 'password-mismatch')
          await captureFooterState(page, stateReceipts, contextName, 'password-mismatch-footer')

          await confirmation.fill(strongPassword)
          const createVault = page.locator('[data-onboarding-action="create-vault"]')
          assert.equal(await createVault.isEnabled(), true)
          await scrollSetupToTop(page)
          const validLayout = await captureState(page, stateReceipts, contextName, 'password-valid')
          assert.equal(validLayout.sectionBeforePassword, true)
          const semanticColors = await page.evaluate(() => {
            const primary = document.querySelector('[data-onboarding-action="create-vault"]')
            const success = document.querySelector('.ui26-onboarding-strength-status [data-ui26-strength-tone="success"]')
            return {
              primary: primary ? getComputedStyle(primary).backgroundColor : null,
              success: success ? getComputedStyle(success).color : null,
            }
          })
          assert.notEqual(semanticColors.primary, semanticColors.success)

          await createVault.scrollIntoViewIfNeeded()
          assert.equal(await createVault.evaluate(element => {
            const rect = element.getBoundingClientRect()
            return rect.top >= 0 && rect.bottom <= window.innerHeight
          }), true)
          await captureFooterState(page, stateReceipts, contextName, 'password-valid-footer')

          await page.keyboard.press('Escape')
          await page.locator('[data-onboarding-step="welcome"]').waitFor()
          await captureState(page, stateReceipts, contextName, 'welcome-return')

          await page.locator('[data-onboarding-action="restore"]').click()
          await page.locator('[data-onboarding-step="restore"]').waitFor()
          await captureState(page, stateReceipts, contextName, 'restore')
          const chooseBackup = page.locator('[data-onboarding-action="choose-backup"]')
          await chooseBackup.scrollIntoViewIfNeeded()
          assert.equal(await chooseBackup.evaluate(element => {
            const rect = element.getBoundingClientRect()
            return rect.left >= 0 && rect.right <= window.innerWidth
          }), true)
          await page.keyboard.press('Escape')
          const restoreEscapeReturn = page.locator('[data-onboarding-step="welcome"]')
          await restoreEscapeReturn.waitFor()
          const restoreEscapeReturnedToWelcome = await restoreEscapeReturn.isVisible()
          assert.equal(restoreEscapeReturnedToWelcome, true)
          await captureState(page, stateReceipts, contextName, 'restore-escape-welcome-return')

          await openSetup(page, baseUrl, 'loading')
          await enterPassword(page)
          await fillValidPassword(page)
          await page.locator('[data-onboarding-action="create-vault"]').click()
          await page.getByRole('button', { name: 'Creating vault…', exact: true }).waitFor()
          await captureState(page, stateReceipts, contextName, 'password-loading')
          await captureFooterState(page, stateReceipts, contextName, 'password-loading-footer')

          await openSetup(page, baseUrl, 'error')
          await enterPassword(page)
          await fillValidPassword(page)
          await page.locator('[data-onboarding-action="create-vault"]').click()
          await page.getByText('Vaultage could not finish setup safely. Try again.', { exact: true }).waitFor()
          await captureState(page, stateReceipts, contextName, 'password-error')
          await captureFooterState(page, stateReceipts, contextName, 'password-error-footer')

          assert.equal(errors.length, 0)
          const expectedStates = baseStatesPerContext
            + (edition === 'closed' ? closedAccountStatesPerContext : 0)
          assert.equal(stateReceipts.length, expectedStates)
          receipts.push({
            edition,
            scenario,
            motion,
            errors,
            welcomeFocus,
            passwordFocus,
            semanticColors,
            restoreEscapeReturnedToWelcome,
            states: stateReceipts,
          })
        } finally {
          await context.close()
        }
      }
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
      pageCount: scenarios.length * 2 * motionModes.length,
      stateCaptureCount: receipts.reduce((total, receipt) => total + receipt.states.length, 0),
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
