// Pour: how the levels are made (tools/make-levels.mjs writes them to data/pour-levels.json).
// Every level is a random mix, checked by the solver; it gets harder as it goes:
//   more colours (2 at level 1, 12 from level 420), and within the levels with the same number of
//   colours, the trickier of the mixes the solver tried.
import { HEIGHT, isComplete } from './rules.js'
import { difficulty } from './solver.js'

export const LEVEL_COUNT = 600
export const EMPTY_TUBES = 2
export const LETTERS = 'abcdefghijkl' // one letter per colour, 12 colours

// [first level, colours from there on]
const STEPS = [
  [1, 2],
  [2, 3],
  [4, 4],
  [10, 5],
  [25, 6],
  [50, 7],
  [90, 8],
  [140, 9],
  [210, 10],
  [300, 11],
  [420, 12],
]

export function colorsFor(n) {
  let c = STEPS[0][1]
  for (const [from, count] of STEPS) if (n >= from) c = count
  return c
}

// Where level n sits among the levels with its number of colours: 0 (first) to 1 (last).
function placeInStep(n) {
  const i = STEPS.findLastIndex(([from]) => n <= LEVEL_COUNT && n >= from)
  const from = STEPS[i][0]
  const to = (STEPS[i + 1]?.[0] ?? LEVEL_COUNT + 1) - 1
  return to === from ? 0.5 : (n - from) / (to - from)
}

// A small seeded random number maker, so the same seed always makes the same levels.
export function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// A random mix of `colors` colours, HEIGHT layers each, plus the empty tubes.
export function randomBoard(colors, random, height = HEIGHT) {
  const layers = []
  for (let c = 0; c < colors; c++) layers.push(...LETTERS[c].repeat(height))
  for (let i = layers.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[layers[i], layers[j]] = [layers[j], layers[i]]
  }
  const board = []
  for (let t = 0; t < colors; t++) board.push(layers.slice(t * height, (t + 1) * height).join(''))
  for (let e = 0; e < EMPTY_TUBES; e++) board.push('')
  return board
}

// No tube may start finished, and no tube may start with three of a colour together on top
// (that's a free move, not a puzzle).
function fair(board, height = HEIGHT) {
  return board.every((t) => !t || (!isComplete(t, height) && !/(.)\1\1/.test(t)))
}

// Level n: the mixes tried, sorted by how tricky they are; early levels in a step take an easy
// one, later ones a trickier one.
export function makeLevel(n, { tries = 14, seed = 2026 } = {}) {
  const random = rng(seed * 100003 + n * 7919)
  const colors = colorsFor(n)
  const found = []
  let guard = 0
  while (found.length < tries && guard++ < tries * 40) {
    const board = randomBoard(colors, random)
    if (!fair(board)) continue
    const d = difficulty(board, { limit: 60000 })
    if (Number.isFinite(d)) found.push({ board, d })
  }
  found.sort((x, y) => x.d - y.d)
  const pick = Math.round(placeInStep(n) * 0.85 * (found.length - 1)) // the very trickiest are left out
  return found[pick]
}
