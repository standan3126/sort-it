// Fewest moves to untangle (A* search). Two facts keep it fast:
// - Moving the same rope twice in a row is never needed: it passes in front both times, so one
//   move straight to the second hole does the same.
// - Lower bound: any two ropes wound around each other need one of them to move (moving other
//   ropes never changes how those two wind). So at least "the fewest ropes that touch every wound
//   pair" moves are left, and at least 1 while anything is still tangled.
import { move, solved, freeHoles, linkedPairs, tangleKey } from './rules.js'

function lowerBound(state) {
  const pairs = linkedPairs(state)
  if (!pairs.length) return solved(state) ? 0 : 1
  const n = state.top.length
  let best = n
  // Smallest set of ropes touching every pair (n ≤ 8: try them all, smallest first).
  for (let mask = 0; mask < 1 << n; mask++) {
    let size = 0
    for (let m = mask; m; m &= m - 1) size++
    if (size >= best) continue
    if (pairs.every(([a, b]) => mask & (1 << a) || mask & (1 << b))) best = size
  }
  return best
}

const keyOf = (s) => `${Object.values(s.hole).join(',')}#${tangleKey(s.top.length, s.word)}`

/**
 * Fewest moves from `start` to untangled, and one way to do it ([[rope, hole], ...]).
 * Returns null if it would look at more than `limit` positions.
 */
export function fewestMoves(start, limit = 200000) {
  if (solved(start)) return { moves: 0, path: [] }
  // A small bucket queue: f = g + h is a small whole number.
  const buckets = []
  const push = (node) => (buckets[node.f] ??= []).push(node)
  const seen = new Map([[keyOf(start), 0]])
  push({ s: start, g: 0, f: lowerBound(start), last: -1, path: [] })
  let looked = 0
  for (let f = 0; f < buckets.length; f++) {
    const list = buckets[f]
    while (list?.length) {
      const node = list.pop()
      if (++looked > limit) return null
      for (const r of node.s.top) {
        if (r === node.last) continue
        for (const h of freeHoles(node.s)) {
          const next = move(node.s, r, h)
          const g = node.g + 1
          const path = [...node.path, [r, h]]
          if (solved(next)) return { moves: g, path }
          const k = keyOf(next)
          if (seen.has(k) && seen.get(k) <= g) continue
          seen.set(k, g)
          push({ s: next, g, f: g + lowerBound(next), last: r, path })
        }
      }
    }
  }
  return null
}
