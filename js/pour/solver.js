// Pour: a solver. Proves a level can be finished and measures how tricky it is.
// Depth-first search over boards (tubes sorted, so the same board in another order is seen once),
// trying the most useful pours first. Used by the level maker and the tests, not by the game.
import { HEIGHT, isComplete, isSolved, pour, pourAmount, top, topRun } from './rules.js'

const key = (board) => board.slice().sort().join('|')

// Pours worth trying from this board, best first.
function candidates(board, height) {
  const out = []
  for (let a = 0; a < board.length; a++) {
    const from = board[a]
    if (!from || isComplete(from, height)) continue
    const uniform = topRun(from) === from.length
    let emptyTried = false
    for (let b = 0; b < board.length; b++) {
      const n = pourAmount(board, a, b, height)
      if (!n) continue
      const to = board[b]
      if (!to) {
        if (uniform || emptyTried) continue // moving a one-colour tube to an empty one gains nothing
        emptyTried = true // all empty tubes are the same
      }
      // Score: finishing a tube > joining a colour > uncovering a colour > using an empty tube.
      let score = 0
      if (to) score += 10 + (to.length + n === height && topRun(to) + n === height ? 20 : 0)
      if (n === topRun(from)) score += 5
      if (to && topRun(to) === to.length) score += 3
      if (!to) score -= 5
      out.push({ a, b, score })
    }
  }
  return out.sort((x, y) => y.score - x.score)
}

// Returns { moves: [[a, b], ...], nodes } or null if no way was found within the limit.
export function solve(start, { height = HEIGHT, limit = 200000 } = {}) {
  const seen = new Set()
  let nodes = 0
  const path = []
  const go = (board) => {
    if (isSolved(board, height)) return true
    if (++nodes > limit) return false
    const k = key(board)
    if (seen.has(k)) return false
    seen.add(k)
    for (const { a, b } of candidates(board, height)) {
      path.push([a, b])
      if (go(pour(board, a, b, height).board)) return true
      path.pop()
      if (nodes > limit) return false
    }
    return false
  }
  return go(start) ? { moves: path.slice(), nodes } : null
}

// How tricky a level is: how many boards the solver had to look at, plus how long the way was.
export function difficulty(board, opts) {
  const r = solve(board, opts)
  return r ? r.nodes + r.moves.length : Infinity
}

export { top }

// ---- The fewest moves (A* search) ---------------------------------------------------------------
// Every pour can join at most one run of colour to another, so (runs - colours) is never more
// than the moves still needed: the search can stop at the first finish and know it's the fewest.
function runs(board) {
  let n = 0
  for (const t of board) for (let k = 0; k < t.length; k++) if (k === 0 || t[k] !== t[k - 1]) n++
  return n
}

class Heap {
  constructor() {
    this.a = []
  }
  push(x) {
    const a = this.a
    a.push(x)
    let i = a.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (a[p].f <= x.f) break
      a[i] = a[p]
      i = p
    }
    a[i] = x
  }
  pop() {
    const a = this.a
    const top = a[0]
    const last = a.pop()
    if (a.length) {
      let i = 0
      for (;;) {
        let c = 2 * i + 1
        if (c >= a.length) break
        if (c + 1 < a.length && a[c + 1].f < a[c].f) c++
        if (a[c].f >= last.f) break
        a[i] = a[c]
        i = c
      }
      a[i] = last
    }
    return top
  }
  get size() {
    return this.a.length
  }
}

// Returns the fewest pours that finish the board, or null if the search grew past `limit` boards.
export function minMoves(start, { height = HEIGHT, limit = 3000000 } = {}) {
  const colors = new Set(start.join('')).size
  const best = new Map([[key(start), 0]])
  const heap = new Heap()
  heap.push({ board: start, g: 0, f: runs(start) - colors })
  let seen = 0
  while (heap.size) {
    const { board, g } = heap.pop()
    if (best.get(key(board)) < g) continue
    if (isSolved(board, height)) return g
    if (++seen > limit) return null
    for (const { a, b } of candidates(board, height)) {
      const next = pour(board, a, b, height).board
      const k = key(next)
      if (best.has(k) && best.get(k) <= g + 1) continue
      best.set(k, g + 1)
      heap.push({ board: next, g: g + 1, f: g + 1 + runs(next) - colors })
    }
  }
  return null
}
