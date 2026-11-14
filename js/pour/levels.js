// Pour: how the levels are made (tools/make-levels.mjs writes them to data/pour-levels.json).
// Every level is a random mix, checked by the solver; it gets harder as it goes:
//   levels 1-600: more colours (2 at level 1, 12 from level 420), and within the levels with the
//     same number of colours, the trickier of the mixes the solver tried;
//   levels 601-3000 (added 2026-11-13, user: "keep increasing the difficulty but slower"): 12
//     colours, and the pick moves slowly toward the trickiest of more and more mixes, fast at
//     first and slower and slower, so level 1000 and level 3000 aren't far apart.
// The first 600 must never change (made exactly as before; FIRST_COUNT keeps their old maths).
import { HEIGHT, isComplete } from './rules.js'
import { difficulty } from './solver.js'

export const LEVEL_COUNT = 3000
const FIRST_COUNT = 600 // the first batch; its levels are made with the original rules
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
  const i = STEPS.findLastIndex(([from]) => n <= FIRST_COUNT && n >= from)
  const from = STEPS[i][0]
  const to = (STEPS[i + 1]?.[0] ?? FIRST_COUNT + 1) - 1
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

// After level 600: how far along the long climb (0 at 601, 1 at 3000), bending so it rises
// quickly at first and then ever more slowly.
export function climb(n) {
  const t = Math.min(1, Math.max(0, (n - FIRST_COUNT) / (LEVEL_COUNT - FIRST_COUNT)))
  return Math.log1p(12 * t) / Math.log1p(12)
}

export function makeLevel(n, opts = {}) {
  if (n <= FIRST_COUNT) return makeFirst(n, opts)
  // More mixes tried (14 → 30) and a pick nearer the trickiest (85% → 97%) as the climb goes on.
  const c = climb(n)
  return pickLevel(n, { tries: Math.round(14 + 16 * c), place: 0.85 + 0.12 * c, seed: opts.seed })
}

function makeFirst(n, { tries = 14, seed = 2026 } = {}) {
  return pickLevel(n, { tries, place: placeInStep(n) * 0.85, seed })
}

// Level n: the mixes tried, sorted by how tricky they are, and the one at `place` (0 = easiest).
function pickLevel(n, { tries, place, seed = 2026 }) {
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
  const pick = Math.round(place * (found.length - 1)) // the very trickiest are left out
  return found[pick]
}
