// Sort It in a phone-sized browser: starts, the frame, settings, saves, and playing Pour.
import { test, expect } from '@playwright/test'
import { solve } from '../js/pour/solver.js'
import { parseLevel } from '../js/pour/rules.js'

async function open(page) {
  await page.goto('./')
  await page.getByRole('button', { name: 'Tap to Start' }).click()
}

// Plays a level by tapping the tubes on the canvas, following the solver.
async function solveLevel(page, n) {
  const levels = await page.evaluate(() => window.sortIt.levels())
  const r = solve(parseLevel(levels[n - 1]))
  for (const [a, b] of r.moves) {
    for (const i of [a, b]) {
      const spot = await page.evaluate((i) => window.sortIt.board.spots[i], i)
      const box = await page.locator('#board').boundingBox()
      await page.mouse.click(box.x + spot.x, box.y + spot.y + 30)
    }
    await page.waitForFunction(() => !window.sortIt.board.anim)
    await page.waitForTimeout(30)
  }
}

test('starts on the launch page in the frame', async ({ page }) => {
  await open(page)
  await expect(page.locator('#home h1')).toHaveText('Sort It')
  await expect(page.getByRole('button', { name: 'Exit to GameHub' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible()
  await expect(page.locator('#play')).toHaveText('Play')
  await expect(page.locator('#levels')).toBeHidden()
})

test('play level 1 by tapping, see fireworks and go on to level 2', async ({ page }) => {
  await open(page)
  await page.locator('#play').click()
  await page.locator('#rules').click() // the rules open by themselves the first time
  await expect(page.getByRole('button', { name: 'Back to the game’s home' })).toBeVisible()
  await solveLevel(page, 1)
  await expect(page.locator('#done')).toBeVisible()
  await expect(page.locator('#done-title')).toHaveText('Level 1 done!')
  const fewest = await page.evaluate(() => window.sortIt.fewest()[0])
  await expect(page.locator('#done-min')).toHaveText(String(fewest))
  const moves = Number(await page.locator('#done-moves').textContent())
  await expect(page.locator('#done-score')).toHaveText(
    moves === fewest ? 'Perfect! The fewest moves possible.' : `${moves - fewest} more than the fewest. Can you match it?`,
  )
  // Replay starts level 1 again, fresh; finishing it again leads on to level 2.
  await expect(page.locator('#done-replay')).toBeVisible()
  await expect(page.locator('#done-home')).toBeVisible()
  await page.locator('#done-replay').click()
  await expect(page.locator('#level-name')).toHaveText('Level 1')
  expect(await page.evaluate(() => window.sortIt.run().moves)).toBe(0)
  await solveLevel(page, 1)
  await page.locator('#done-next').click()
  await expect(page.locator('#level-name')).toHaveText('Level 2')
  const save = await page.evaluate(() => window.sortIt.save())
  expect(save.reached).toBe(2)
  expect(save.results[1].moves).toBeGreaterThan(0)
})

test('a level in progress is saved and comes back', async ({ page }) => {
  await open(page)
  await page.locator('#play').click()
  await page.locator('#rules').click()
  const levels = await page.evaluate(() => window.sortIt.levels())
  const [a, b] = solve(parseLevel(levels[0])).moves[0]
  await page.evaluate(([a, b]) => window.sortIt.tap(a).then(() => window.sortIt.tap(b)), [a, b])
  await page.waitForFunction(() => !window.sortIt.board.anim && window.sortIt.run().moves === 1)
  await page.reload()
  await page.getByRole('button', { name: 'Tap to Start' }).click()
  await expect(page.locator('#play')).toHaveText('Continue level 1')
  await page.locator('#play').click()
  expect(await page.evaluate(() => window.sortIt.run().moves)).toBe(1)
})

test('undo is limited to five, and stuck offers Restart', async ({ page }) => {
  await open(page)
  await page.evaluate(() => window.sortIt.startLevel(1))
  await page.locator('#rules').click()
  // Pour back and forth, undoing each time, until the undos run out.
  for (let k = 0; k < 5; k++) {
    await page.evaluate(async () => {
      const s = window.sortIt
      const b = s.run().board
      const from = b.findIndex((t) => t.length)
      const to = b.findIndex((t) => !t.length)
      await s.tap(from)
      await s.tap(to)
    })
    await page.waitForFunction(() => !window.sortIt.board.anim)
    await page.locator('#undo').click()
  }
  await expect(page.locator('#undo-label')).toHaveText('Undo · 0')
  await expect(page.locator('#undo')).toBeDisabled()
  // Restart takes two taps and refills the undos.
  await page.locator('#restart').click()
  await expect(page.locator('#restart-label')).toHaveText('Tap again')
  await page.locator('#restart').click()
  await expect(page.locator('#undo-label')).toHaveText('Undo · 5')
})

test('settings: colour marks and night filter', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByText('Colour marks').click()
  expect(await page.evaluate(() => window.sortIt.board.marks)).toBe(true)
  await page.getByRole('radio', { name: 'Night' }).check({ force: true }).catch(() => page.getByText('Night', { exact: true }).click())
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'night')
  await expect(page.locator('#night-filter')).toBeVisible()
  const saved = await page.evaluate(() => window.sortIt.store.get('my-settings'))
  expect(saved.marks).toBe(true)
  // A Challenge game: Island Breeze by default, not the Cozy games' Quiet Words music.
  expect(await page.evaluate(() => window.sortIt.panel.settings.music)).toBe('island')
})

// The hidden tools: 5 taps on the Settings heading + the family code (kept private, outside the
// repo; the test is skipped without it). A level set by hand is the one Play opens, even with
// another level in progress.
test('setting the level by hand takes over a level in progress', async ({ page }) => {
  const { existsSync, readFileSync } = await import('node:fs')
  const file = new URL('../../hub/private/family-code.txt', import.meta.url)
  test.skip(!existsSync(file), 'no family code on this computer')
  const code = readFileSync(file, 'utf8').trim()
  await open(page)
  await page.locator('#play').click()
  await page.locator('#rules').click()
  await page.getByRole('button', { name: 'Settings' }).click()
  for (let i = 0; i < 5; i++) await page.locator('dialog h2').first().click()
  await page.locator('.hub-secret input').fill(code)
  await page.locator('.hub-secret button').click()
  await page.locator('dialog input[type=number]').first().fill('300')
  await page.getByRole('button', { name: 'Set', exact: true }).click()
  await expect(page.locator('.hub-message')).toHaveText('Set: Pour level 300.')
  await page.getByRole('button', { name: 'Close settings' }).click()
  await expect(page.locator('#play')).toHaveText('Play level 300')
  await page.locator('#play').click()
  await expect(page.locator('#level-name')).toHaveText('Level 300')
})
