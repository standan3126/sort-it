// Fewest moves to untangle (A* search). Two facts keep it fast:
// - Moving the same rope twice in a row is never needed: it passes in front both times, so one
//   move straight to the second hole does the same.
// - Lower bound: any two ropes wound around each other need one of them to move (moving other
//   ropes never changes how those two wind). So at least "the fewest ropes that touch every wound
//   pair" moves are left, and at least 1 while anything is still tangled.
import { move, solved, freeHoles, linkedPairs, stateKey } from './rules.js'

// Every set of ropes as a bit mask, smallest sets first (made once per rope count).
const masksCache = new Map()
function masksBySize(n) {
  if (!masksCache.has(n)) {
    const size = (m) => (m ? (m & 1) + size(m >> 1) : 0)
    const list = [...Array(1 << n).keys()].map((m) => [m, size(m)]).sort((a, b) => a[1] - b[1])
    masksCache.set(n, list)
  }
  return masksCache.get(n)
}

export function lowerBound(state) {
  const pairs = linkedPairs(state)
  if (!pairs.length) return solved(state) ? 0 : 1
  const n = state.top.length
  // (1) The fewest ropes touching every wound pair: each of those must move at least once.
  const edges = pairs.map(([a, b]) => (1 << a) | (1 << b))
  let cover = n
  search: for (const [mask, size] of masksBySize(n)) {
    for (let e = 0; e < edges.length; e++) if (!(mask & edges[e])) continue search
    cover = size
    break
  }
  // When every pair winds just once, (2) can't beat (1) (a set of separate pairs is never larger
  // than the fewest ropes touching them all), so skip it.
  if (pairs.every(([, , t]) => t === 1)) return Math.max(cover, 1)
  // (2) Pairs that share no rope need their windings undone by different moves: the best such
  // set of pairs, adding up their turns (worked out for every set of used ropes, largest first).
  const turns = new Int8Array(n * n)
  for (const [a, b, t] of pairs) turns[a * n + b] = t
  const full = (1 << n) - 1
  const best = new Int16Array(1 << n)
  for (let used = full - 1; used >= 0; used--) {
    const i = 31 - Math.clz32(~used & full & -(~used & full)) // lowest rope not used yet
    let v = best[used | (1 << i)]
    for (let j = i + 1; j < n; j++) {
      const t = turns[i * n + j]
      if (t && !(used & (1 << j))) v = Math.max(v, t + best[used | (1 << i) | (1 << j)])
    }
    best[used] = v
  }
  return Math.max(cover, best[0], 1)
}

const keyOf = stateKey

/**
 * Fewest moves from `start` to untangled, and one way to do it ([[rope, hole], ...]).
 * Returns null if it would look at more than `limit` positions.
 */
export function fewestMoves(start, limit = 60000) {
  if (solved(start)) return { moves: 0, path: [] }
  // A small bucket queue: f = g + h is a small whole number.
  const buckets = []
  const push = (node) => (buckets[node.f] ??= []).push(node)
  const seen = new Map([[keyOf(start), 0]])
  push({ s: start, g: 0, f: lowerBound(start), last: -1, parent: null, mv: null })
  const pathOf = (node, mv) => {
    const out = [mv]
    for (let n = node; n.mv; n = n.parent) out.unshift(n.mv)
    return out
  }
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
          if (solved(next)) return { moves: g, path: pathOf(node, [r, h]) }
          const k = keyOf(next)
          if (seen.has(k) && seen.get(k) <= g) continue
          seen.set(k, g)
          push({ s: next, g, f: g + lowerBound(next), last: r, parent: node, mv: [r, h] })
        }
      }
    }
  }
  return null
}
