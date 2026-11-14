// Untangle in a phone-sized browser: the card, dragging pegs, Undo, the Cut, the done card, saves.
import { test, expect } from '@playwright/test'
import { parseLevel } from '../js/untangle/levels.js'
import { play, move, cut } from '../js/untangle/rules.js'
import { fewestMoves } from '../js/untangle/solver.js'

async function open(page) {
  await page.goto('./')
  await page.getByRole('button', { name: 'Tap to Start' }).click()
}

async function startUntangle(page) {
  await page.locator('#card-untangle').click()
  await expect(page.locator('#card-untangle')).toHaveAttribute('aria-checked', 'true')
  await page.locator('#play').click()
  if (await page.locator('#untangle-rules').isVisible()) await page.locator('#untangle-rules').click()
  await ready(page)
}

const ready = (page) => page.waitForFunction(() => window.sortIt.untangle.game() && !window.sortIt.untangle.game().busy && window.sortIt.untangle.game().tangled, null, { timeout: 60000 })

// Drag the peg of rope `r` (the rules' number now) into hole h, the way a finger does: the peg
// floats 72 px above the touch, so the finger goes 72 px below the hole.
async function drag(page, r, h) {
  const box = await page.locator('#untangle-stage canvas').boundingBox()
  const p = await page.evaluate(([r, h]) => {
    const g = window.sortIt.untangle.game()
    return { x0: g.L.holeX(g.state.hole[r]), x1: g.L.holeX(h), y: g.L.yHole }
  }, [r, h])
  await page.mouse.move(box.x + p.x0, box.y + p.y)
  await page.mouse.down()
  for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + p.x0 + ((p.x1 - p.x0) * i) / 8, box.y + p.y + 72 - 30 + (30 * i) / 8)
  await page.waitForTimeout(100)
  await page.mouse.up()
  await page.waitForTimeout(150)
}

async function solveHere(page) {
  const st = await page.evaluate(() => {
    const g = window.sortIt.untangle.game()
    return { text: g.text, actions: window.sortIt.untangle.run().actions }
  })
  const lv = parseLevel(st.text)
  let now = play(lv.start, lv.moves)
  let ids = now.top.slice()
  for (const [r, h] of st.actions) {
    if (h === 'cut') {
      const c = cut(now, ids.indexOf(r))
      now = c.state
      ids = c.ids.map((o) => ids[o])
    } else now = move(now, ids.indexOf(r), h)
  }
  const { path } = fewestMoves(now)
  for (const [r, h] of path) await drag(page, r, h)
}

test('Untangle card: play level 1 by dragging pegs, then the done card', async ({ page }) => {
  await open(page)
  await startUntangle(page)
  await expect(page.locator('#untangle-name')).toHaveText('Level 1')
  await expect(page.locator('#untangle-scenery svg')).toHaveCount(1)
  await solveHere(page)
  await expect(page.locator('#done')).toBeVisible({ timeout: 10000 })
  await expect(page.locator('#done-title')).toHaveText('Level 1 untangled!')
  const fewest = await page.evaluate(() => window.sortIt.untangle.fewest()[0])
  await expect(page.locator('#done-min')).toHaveText(String(fewest))
  await expect(page.locator('#done-score')).toHaveText('Perfect! The fewest moves possible.')
  await page.locator('#done-next').click()
  await ready(page)
  await expect(page.locator('#untangle-name')).toHaveText('Level 2')
  const save = await page.evaluate(() => window.sortIt.untangle.save())
  expect(save.reached).toBe(2)
  expect(save.results[1].moves).toBe(fewest)
  // Home: the launch page remembers Untangle is chosen.
  await page.getByRole('button', { name: 'Back to the game’s home' }).click()
  await expect(page.locator('#play')).toHaveText('Continue level 2')
  await expect(page.locator('#untangle-level')).toHaveText(/Level 2 of 3000/)
})

test('Undo takes the move back off the count; a level in progress continues after leaving', async ({ page }) => {
  await open(page)
  await page.evaluate(() => {
    const s = window.sortIt.store
    // Changed in place: the page saves its own copy when it closes, so a store.set would be undone.
    Object.assign(window.sortIt.untangle.save(), { reached: 12, results: {}, run: null, cutsUsed: 0 })
    s.set('seen-untangle-rules', true)
  })
  await page.reload()
  await page.getByRole('button', { name: 'Tap to Start' }).click()
  await startUntangle(page)
  await expect(page.locator('#untangle-name')).toHaveText('Level 12')
  // A move into a free hole.
  const free = await page.evaluate(() => {
    const g = window.sortIt.untangle.game()
    const used = Object.values(g.state.hole)
    return { r: g.state.top[0], h: [...Array(g.L.holes).keys()].find((h) => !used.includes(h)) }
  })
  await drag(page, free.r, free.h)
  await expect(page.locator('#untangle-moves')).toHaveText('1 move')
  await expect(page.locator('#u-undo')).toBeEnabled()
  await page.locator('#u-undo').click()
  await ready(page)
  await expect(page.locator('#untangle-moves')).toHaveText('0 moves')
  await expect(page.locator('#u-undo-label')).toHaveText('Undo · 2')
  // Move again, leave, come back: the move is still there.
  await drag(page, free.r, free.h)
  await page.getByRole('button', { name: 'Back to the game’s home' }).click()
  await expect(page.locator('#play')).toHaveText('Continue level 12')
  await page.locator('#play').click()
  await ready(page)
  const g = await page.evaluate(() => ({ hole: window.sortIt.untangle.game().state.hole, run: window.sortIt.untangle.run() }))
  expect(g.run.moves).toBe(1)
  expect(g.run.undosLeft).toBe(2)
  expect(g.hole[free.r]).toBe(free.h)
})

test('the Cut: earned at level 50, takes a rope out, no Perfect, Restart gives it back', async ({ page }) => {
  await open(page)
  await page.evaluate(() => {
    const s = window.sortIt.store
    // Changed in place: the page saves its own copy when it closes, so a store.set would be undone.
    Object.assign(window.sortIt.untangle.save(), { reached: 50, results: {}, run: null, cutsUsed: 0 })
    s.set('seen-untangle-rules', true)
  })
  await page.reload()
  await page.getByRole('button', { name: 'Tap to Start' }).click()
  await page.locator('#card-untangle').click()
  await page.locator('#levels').click()
  await page.locator('.hub-book-tile', { hasText: 'Level 50' }).click()
  await page.getByRole('button', { name: 'Play level 50' }).click()
  await ready(page)
  await expect(page.locator('#u-cut-label')).toHaveText('Cut · 1')
  const ropes = await page.evaluate(() => window.sortIt.untangle.game().state.top.length)
  // Cut, then Restart: the rope comes back and the Cut is still there.
  await page.locator('#u-cut').click()
  await expect(page.locator('#cut-note')).toBeVisible()
  const peg = await page.evaluate(() => {
    const g = window.sortIt.untangle.game()
    return { x: g.L.holeX(g.state.hole[0]), y: g.L.yHole }
  })
  const box = await page.locator('#untangle-stage canvas').boundingBox()
  await page.mouse.click(box.x + peg.x, box.y + peg.y)
  expect(await page.evaluate(() => window.sortIt.untangle.game().state.top.length)).toBe(ropes - 1)
  await expect(page.locator('#untangle-moves')).toHaveText('1 move')
  await expect(page.locator('#u-cut')).toBeHidden()
  await page.locator('#u-restart').click()
  await page.locator('#u-restart').click()
  expect(await page.evaluate(() => window.sortIt.untangle.game().state.top.length)).toBe(ropes)
  await expect(page.locator('#u-cut-label')).toHaveText('Cut · 1')
  // Cut again and finish: no Perfect, and the Cut is spent.
  await page.locator('#u-cut').click()
  await page.mouse.click(box.x + peg.x, box.y + peg.y)
  await solveHere(page)
  await expect(page.locator('#done')).toBeVisible({ timeout: 10000 })
  await expect(page.locator('#done-score')).toHaveText('Untangled with a Cut. Try it without one for a Perfect.')
  const save = await page.evaluate(() => window.sortIt.untangle.save())
  expect(save.cutsUsed).toBe(1)
  expect(save.results[Object.keys(save.results)[0]].cut).toBe(true)
})
