// Untangle: how the levels are made (tools/make-untangle.mjs writes data/untangle-levels.json).
// A level starts untangled, then moves tangle it (so it can always be undone). Since 2026-11-14
// ("twisty", user: "exactly what i want") each move is picked to wind the ropes more and pull in
// ropes not tangled yet, and from 4 ropes every rope must end up tangled (from 5, some pair wound
// twice). The solver finds the fewest moves; the level is kept only if that matches its target.
//   Ropes: 2 at level 1, 8 from level 250 (user: more ropes = harder later).
//   Spare holes: 2 early in each rope count, then 1 (fewer spares = harder). From 8 ropes on,
//     every 4th level has 2 spares, for variety.
//   Fewest moves: climbs within each rope count; from level 250 it climbs from 6 to 8 along a
//     slow log curve, so level 1000 and level 3000 aren't far apart (like Pour).
import { untangled, move, freeHoles, rng, linkedPairs, isFree } from './rules.js'
import { lowerBound } from './solver.js'

export const LEVEL_COUNT = 3000

// [first level, ropes, fewest moves at the start of the step, at the end]
// Twisty ramp (2026-11-14), from the 5 trial levels the user liked: 4 ropes 5, 5 ropes 6,
// 6 ropes 8, 7 ropes 9, 8 ropes 11 fewest moves.
const STEPS = [
  [1, 2, 1, 1],
  [3, 3, 2, 3],
  [10, 4, 3, 5],
  [30, 5, 4, 6],
  [70, 6, 5, 8],
  [130, 7, 6, 9],
  [250, 8, 8, 11],
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

const turnsOf = (s) => linkedPairs(s).reduce((a, p) => a + p[2], 0)

/**
 * One try at level n: an untangled start (spare holes in random places), then `target` moves.
 * Each move is one of the best 3 of every allowed move (never the same rope twice running, never
 * a move that passes nothing), scored by how much more the ropes wind, how many ropes are
 * tangled, and a little chance. Returns { start, moves, state }.
 */
export function attempt(n, tryNo) {
  const { ropes, spares, target } = plan(n)
  const r = rng(n * 7919 + tryNo * 104729 + 17)
  const holes = ropes + spares
  const slots = [...Array(holes).keys()]
  for (let s = 0; s < spares; s++) slots.splice(Math.floor(r() * slots.length), 1)
  const start = untangled(ropes, holes, slots)
  const moves = []
  let state = start
  let last = -1
  while (moves.length < target) {
    const opts = []
    const before = turnsOf(state)
    for (let rope = 0; rope < ropes; rope++) {
      if (rope === last) continue
      for (const h of freeHoles(state)) {
        const next = move(state, rope, h)
        if (next.word.length === state.word.length) continue
        const touched = new Set(linkedPairs(next).flatMap(([a, b]) => [a, b])).size
        opts.push({ rope, h, next, score: (turnsOf(next) - before) * 2 + touched * 0.7 + r() * 3 })
      }
    }
    if (!opts.length) break
    opts.sort((a, b) => b.score - a.score)
    const pick = opts[Math.floor(r() * Math.min(3, opts.length))]
    state = pick.next
    moves.push([pick.rope, pick.h])
    last = pick.rope
  }
  return { start, moves, state }
}

/** Tangled enough for level n: from 4 ropes every rope tangled, from 5 a pair wound twice. */
export function twistyEnough(n, state) {
  const { ropes } = plan(n)
  if (ropes >= 4 && state.top.some((x) => isFree(state, x))) return false
  if (ropes >= 5 && !linkedPairs(state).some((p) => p[2] >= 2)) return false
  return true
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
