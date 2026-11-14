// Untangle: how the levels are made (tools/make-untangle.mjs writes data/untangle-levels.json).
// A level starts untangled, then random moves tangle it (so it can always be undone); the
// solver finds the fewest moves, and the level is kept only if that matches the level's target.
//   Ropes: 2 at level 1, 8 from level 160 (user: more ropes = harder later).
//   Spare holes: 2 early in each rope count, then 1 (fewer spares = harder). From 8 ropes on,
//     every 4th level has 2 spares, for variety.
//   Fewest moves: climbs within each rope count; from level 160 it climbs from 7 to 10 along a
//     slow log curve, so level 1000 and level 3000 aren't far apart (like Pour).
import { untangled, move, freeHoles, rng } from './rules.js'

export const LEVEL_COUNT = 3000

// [first level, ropes, fewest moves at the start of the step, at the end]
const STEPS = [
  [1, 2, 1, 1],
  [3, 3, 2, 3],
  [8, 4, 2, 4],
  [20, 5, 3, 5],
  [45, 6, 4, 6],
  [90, 7, 5, 7],
  [160, 8, 7, 10],
]

function step(n) {
  let i = 0
  while (i + 1 < STEPS.length && n >= STEPS[i + 1][0]) i++
  const [from, ropes, lo, hi] = STEPS[i]
  const last = i + 1 < STEPS.length ? STEPS[i + 1][0] - 1 : LEVEL_COUNT
  const x = last > from ? (n - from) / (last - from) : 0
  return { ropes, lo, hi, x, eight: i === STEPS.length - 1 }
}

/** What level n should be: ropes, spare holes and the fewest moves it aims for. */
export function plan(n) {
  const { ropes, lo, hi, x, eight } = step(n)
  const curve = eight ? Math.log(1 + 9 * x) / Math.log(10) : x
  const target = Math.round(lo + (hi - lo) * curve)
  const spares = eight ? (n % 4 === 0 ? 2 : 1) : x < 0.5 ? 2 : 1
  return { ropes, spares, target: Math.max(1, target) }
}

/**
 * One try at level n: an untangled start (spare holes in random places), then random moves.
 * Returns { start, moves } where start is the untangled state and moves tangle it.
 */
export function attempt(n, tryNo) {
  const { ropes, spares, target } = plan(n)
  const r = rng(n * 7919 + tryNo * 104729 + 17)
  const holes = ropes + spares
  const slots = [...Array(holes).keys()]
  for (let s = 0; s < spares; s++) slots.splice(Math.floor(r() * slots.length), 1)
  const start = untangled(ropes, holes, slots)
  const count = target + (r() < 0.6 ? 0 : 1) // about the target: most random moves don't cancel
  const moves = []
  let state = start
  let last = -1
  while (moves.length < count) {
    let rope
    do rope = Math.floor(r() * ropes)
    while (rope === last && ropes > 1)
    const free = freeHoles(state)
    const h = free[Math.floor(r() * free.length)]
    const next = move(state, rope, h)
    if (next.word.length === state.word.length && moves.length) continue // passed nothing: try again
    state = next
    moves.push([rope, h])
    last = rope
  }
  return { start, moves, state }
}

/** A level as text: "ropes.holes.slots.moves", e.g. "3.4.013.0312" (rope, hole pairs). */
export const levelText = ({ start, moves }) =>
  `${start.top.length}.${start.holes}.${start.top.map((r) => start.hole[r].toString(36)).join('')}.${moves.map(([r, h]) => r + h.toString(36)).join('')}`

export function parseLevel(text) {
  const [ropes, holes, slots, mv] = text.split('.')
  const start = untangled(+ropes, +holes, [...slots].map((c) => parseInt(c, 36)))
  const moves = []
  for (let i = 0; i < mv.length; i += 2) moves.push([+mv[i], parseInt(mv[i + 1], 36)])
  return { start, moves }
}
