// Untangle: how the levels are made (tools/make-untangle.mjs writes data/untangle-levels.json).
// A level starts untangled, then random moves tangle it (so it can always be undone); the
// solver finds the fewest moves, and the level is kept only if that matches the level's target.
//   Ropes: 2 at level 1, 8 from level 250 (user: more ropes = harder later).
//   Spare holes: 2 early in each rope count, then 1 (fewer spares = harder). From 8 ropes on,
//     every 4th level has 2 spares, for variety.
//   Fewest moves: climbs within each rope count; from level 250 it climbs from 6 to 8 along a
//     slow log curve, so level 1000 and level 3000 aren't far apart (like Pour).
import { untangled, move, freeHoles, rng } from './rules.js'
import { lowerBound } from './solver.js'

export const LEVEL_COUNT = 3000

// [first level, ropes, fewest moves at the start of the step, at the end]
// Gentler since 2026-11-14: a simulated player showed 8 ropes needing 9-10 moves was far
// harder than 7 ropes, so 8 ropes come later and top out at 8 fewest moves.
const STEPS = [
  [1, 2, 1, 1],
  [3, 3, 2, 3],
  [10, 4, 2, 4],
  [30, 5, 3, 5],
  [70, 6, 4, 6],
  [130, 7, 5, 7],
  [250, 8, 6, 8],
]
export const PLAN_VERSION = JSON.stringify(STEPS) // the level maker starts over if this changes

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
  // A move that passes over nothing is tried again, but never forever: in a tiny level the only
  // allowed move can pass nothing (that hung the level maker on 2026-11-13), so after 200 such
  // tries the tangle simply stops a move short.
  for (let tries = 0; moves.length < count && tries < 200; tries++) {
    let rope
    do rope = Math.floor(r() * ropes)
    while (rope === last && ropes > 1)
    const free = freeHoles(state)
    const h = free[Math.floor(r() * free.length)]
    const next = move(state, rope, h)
    if (next.word.length === state.word.length) continue // passed nothing: try again
    state = next
    moves.push([rope, h])
    last = rope
  }
  return { start, moves, state }
}

/**
 * Backup maker: a tangle built one move at a time, each move raising the solver's lower bound by
 * exactly 1. A move can raise it by at most 1, so after `target` moves the bound equals the move
 * count and the fewest moves is exactly `target`, proven without searching. Null if it can't.
 */
export function exactAttempt(n, tryNo) {
  const { ropes, spares, target } = plan(n)
  const r = rng(n * 6151 + tryNo * 92821 + 5)
  for (let restart = 0; restart < 80; restart++) {
    const holes = ropes + spares
    const slots = [...Array(holes).keys()]
    for (let s = 0; s < spares; s++) slots.splice(Math.floor(r() * slots.length), 1)
    const start = untangled(ropes, holes, slots)
    let state = start
    const moves = []
    while (moves.length < target) {
      const opts = []
      for (let rope = 0; rope < ropes; rope++) if (rope !== moves.at(-1)?.[0]) for (const h of freeHoles(state)) opts.push([rope, h])
      for (let i = opts.length - 1; i > 0; i--) {
        const j = Math.floor(r() * (i + 1))
        ;[opts[i], opts[j]] = [opts[j], opts[i]]
      }
      const ok = opts.find(([rope, h]) => lowerBound(move(state, rope, h)) === moves.length + 1)
      if (!ok) break
      state = move(state, ...ok)
      moves.push(ok)
    }
    if (moves.length === target) return { start, moves, state }
  }
  return null
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
