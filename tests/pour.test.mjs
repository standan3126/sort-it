// Pour's rules and levels (no browser): node --test tests/pour.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { climb, colorsFor, LEVEL_COUNT } from '../js/pour/levels.js'
import { isComplete, isSolved, isStuck, legalMoves, parseLevel, pour, pourAmount, topRun } from '../js/pour/rules.js'
import { minMoves, solve } from '../js/pour/solver.js'

const data = JSON.parse(readFileSync(new URL('../data/pour-levels.json', import.meta.url)))

test('pouring follows the rules', () => {
  const b = ['aab', 'ab', 'b', '']
  assert.equal(topRun('aabb'), 2)
  assert.equal(pourAmount(b, 0, 2), 1) // b onto b
  assert.equal(pourAmount(['aab', 'ba'], 0, 1), 0) // b onto a: no
  assert.equal(pourAmount(b, 1, 3), 1) // into an empty tube
  assert.equal(pourAmount(b, 3, 0), 0) // nothing to pour
  assert.equal(pourAmount(['aa', 'aaa'], 0, 1), 1) // only as much as fits
  assert.deepEqual(pour(b, 0, 2).board, ['aa', 'ab', 'bb', ''])
  assert.equal(pourAmount(['aaaa', ''], 0, 1), 0) // a finished tube stays put
})

test('solved, finished and stuck', () => {
  assert.ok(isComplete('cccc'))
  assert.ok(!isComplete('ccc'))
  assert.ok(isSolved(['aaaa', 'bbbb', '']))
  assert.ok(!isSolved(['aaab', 'bbba', '']))
  assert.ok(isStuck(['abab', 'baba']))
  assert.ok(!isStuck(['abab', 'bab']))
  assert.equal(legalMoves(['abab', 'bab']).length, 1)
})

test('there are 3000 levels, each with every colour exactly four times', () => {
  assert.equal(data.levels.length, LEVEL_COUNT)
  data.levels.forEach((text, k) => {
    const board = parseLevel(text)
    const colors = colorsFor(k + 1)
    assert.equal(board.length, colors + 2, `level ${k + 1} tubes`)
    const counts = {}
    for (const c of board.join('')) counts[c] = (counts[c] || 0) + 1
    assert.equal(Object.keys(counts).length, colors, `level ${k + 1} colours`)
    for (const n of Object.values(counts)) assert.equal(n, 4, `level ${k + 1} layers`)
    assert.ok(!board.some((t) => t && isComplete(t)), `level ${k + 1} starts with a finished tube`)
  })
})

test('every level can be solved', () => {
  data.levels.forEach((text, k) => {
    const board = parseLevel(text)
    const r = solve(board, { limit: 200000 })
    assert.ok(r, `level ${k + 1} has no solution found`)
    let b = board
    for (const [a, c] of r.moves) {
      assert.ok(pourAmount(b, a, c) > 0)
      b = pour(b, a, c).board
    }
    assert.ok(isSolved(b), `level ${k + 1} solution checks out`)
  })
})

test('it gets harder: more colours as the levels go on', () => {
  assert.equal(colorsFor(1), 2)
  assert.equal(colorsFor(600), 12)
  for (let n = 2; n <= 600; n++) assert.ok(colorsFor(n) >= colorsFor(n - 1))
})

// The plainest possible search (every pour, breadth first): slow, but certainly the fewest.
function bfs(start) {
  const key = (b) => b.slice().sort().join('|')
  let frontier = [start]
  const seen = new Set([key(start)])
  for (let depth = 0; frontier.length; depth++) {
    const next = []
    for (const b of frontier) {
      if (isSolved(b)) return depth
      for (const [a, c] of legalMoves(b)) {
        const n = pour(b, a, c).board
        const k = key(n)
        if (!seen.has(k)) {
          seen.add(k)
          next.push(n)
        }
      }
    }
    frontier = next
  }
  return null
}

test('the fewest moves are right (checked by plain search on the early levels)', () => {
  assert.equal(data.min.length, LEVEL_COUNT)
  for (let n = 1; n <= 30; n++) assert.equal(minMoves(parseLevel(data.levels[n - 1])), bfs(parseLevel(data.levels[n - 1])), `level ${n}`)
  for (let n = 1; n <= 30; n++) assert.equal(data.min[n - 1], bfs(parseLevel(data.levels[n - 1])), `saved level ${n}`)
})

test('every level has a fewest-moves number no bigger than a found solution', () => {
  data.levels.forEach((text, k) => {
    const found = solve(parseLevel(text)).moves.length
    assert.ok(data.min[k] > 0 && data.min[k] <= found, `level ${k + 1}: fewest ${data.min[k]}, found ${found}`)
  })
})

test('levels 1-600 never change (the ones played before 3000 were made)', () => {
  const hash = createHash('sha256').update(data.levels.slice(0, 600).join('\n')).digest('hex')
  assert.equal(hash, '6012870031663d4ae9b1bb59eac7602b581d1e799b7b9c44340e6bac87f8371f')
})

test('after level 600 the climb keeps rising, ever more slowly', () => {
  assert.equal(climb(600), 0)
  assert.equal(climb(3000), 1)
  let last = 0
  let lastStep = Infinity
  for (let n = 700; n <= 3000; n += 100) {
    const c = climb(n)
    assert.ok(c > last)
    assert.ok(c - last <= lastStep + 1e-9)
    lastStep = c - last
    last = c
  }
})

// Pour's sounds may only use instruments the published toolbox has: the toolbox on this computer
// can hold newer, unpublished ones (that broke level 1 on the phones on 2026-11-13).
test('every instrument the sounds use is in the published toolbox', async () => {
  const { execFileSync } = await import('node:child_process')
  let published
  try {
    published = execFileSync('git', ['-C', new URL('../../hub', import.meta.url).pathname, 'show', 'origin/main:shared/v1/sound/instruments.js'], { encoding: 'utf8' })
  } catch {
    return // no hub repo here (the publish check on GitHub): nothing to compare
  }
  const used = new Set([...readFileSync(new URL('../js/pour/sounds.js', import.meta.url), 'utf8').matchAll(/INSTRUMENTS\.(\w+)/g)].map((m) => m[1]))
  for (const name of used) assert.match(published, new RegExp(`^  ${name}: \\{`, 'm'), `instrument ${name} is not published yet`)
})
