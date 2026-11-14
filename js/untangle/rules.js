// Untangle rules (no drawing). Works in the browser and in node (tests, level maker).
//
// The tangle is a list of crossings ("generators"), top to bottom. A crossing [i, s] swaps the
// ropes at order places i and i+1 (counted left to right); s = +1 when the left rope passes in
// front, -1 when the right one does.
//
// The game's rule: the rope you move always passes OVER the ropes it crosses. Its bottom end
// moves under the other ends, so the crossings are added at the bottom of the list.
//
// "Is it untangled?" has to be exact, because the ropes on screen are real physics and fall
// free whenever they really can. Two lists can describe the same tangle, so each tangle is put in
// one standard form (the Garside normal form of braid theory): Δ^k · A1 · A2 ... where each A is
// a "simple" piece (every pair of ropes crosses at most once, left rope in front). Same tangle =
// same form. Untangled = k is 0 and there are no pieces.

// ---------- simple pieces, stored as permutations ----------
// A piece is a permutation w (an array); adding a crossing at place i on the right swaps
// positions i, i+1; on the left swaps the values i, i+1. With at most 8 ropes there are at most
// 8! = 40320 pieces, so each piece gets a number and every operation is looked up in a table
// made once (this is what makes the solver fast enough to make 3000 levels).
const tableCache = new Map()
function tables(n) {
  if (tableCache.has(n)) return tableCache.get(n)
  const perms = []
  const build = (w, rest) => {
    if (!rest.length) return perms.push(w)
    for (let i = 0; i < rest.length; i++) build([...w, rest[i]], [...rest.slice(0, i), ...rest.slice(i + 1)])
  }
  build([], [...Array(n).keys()])
  const code = (w) => w.reduce((c, v) => c * n + v, 0)
  const index = new Map(perms.map((w, i) => [code(w), i]))
  const m = Math.max(1, n - 1)
  const P = perms.length
  const T = {
    pos: new Int32Array(P * m), // piece × crossing on the right
    val: new Int32Array(P * m), // crossing on the left × piece
    ends: new Int32Array(P), // places a piece could end with (bit mask)
    starts: new Int32Array(P), // places a piece could start with
    flip: new Int32Array(P), // Δ x Δ⁻¹: the same piece in a mirror
    id: index.get(code([...Array(n).keys()])),
    delta: index.get(code([...Array(n).keys()].reverse())),
    m,
  }
  perms.forEach((w, p) => {
    for (let i = 0; i + 1 < n; i++) {
      const sp = w.slice()
      ;[sp[i], sp[i + 1]] = [sp[i + 1], sp[i]]
      T.pos[p * m + i] = index.get(code(sp))
      T.val[p * m + i] = index.get(code(w.map((v) => (v === i ? i + 1 : v === i + 1 ? i : v))))
      if (w[i] > w[i + 1]) T.ends[p] |= 1 << i
      if (w.indexOf(i) > w.indexOf(i + 1)) T.starts[p] |= 1 << i
    }
    T.flip[p] = index.get(code(w.map((_, j) => n - 1 - w[n - 1 - j])))
  })
  tableCache.set(n, T)
  return T
}

/** Add one crossing to a standard form (kept standard): returns a new form. */
export function addToForm(n, form, [i, s]) {
  const T = tables(n)
  let k = form.k
  let parts
  if (s > 0) parts = [...form.parts, T.pos[T.id * T.m + i]]
  else {
    // σᵢ⁻¹ = Δ⁻¹ · (Δ σᵢ⁻¹); move the Δ⁻¹ to the front, mirroring what it passes.
    parts = form.parts.map((p) => T.flip[p])
    parts.push(T.pos[T.delta * T.m + i])
    k--
  }
  // Make neighbouring pieces "left-weighted" (crossings moved as far left as they can go), from
  // the new end leftwards; once a pair doesn't change, the rest is still fine.
  for (let j = parts.length - 2; j >= 0; j--) {
    let a = parts[j]
    let b = parts[j + 1]
    let moved = false
    for (let free = T.starts[b] & ~T.ends[a]; free; free = T.starts[b] & ~T.ends[a]) {
      const c = 31 - Math.clz32(free & -free) // the lowest such place
      a = T.pos[a * T.m + c]
      b = T.val[b * T.m + c]
      moved = true
    }
    parts[j] = a
    parts[j + 1] = b
    if (!moved) break
  }
  let first = 0
  while (first < parts.length && parts[first] === T.delta) first++
  k += first
  let last = parts.length
  while (last > first && parts[last - 1] === T.id) last--
  return { k, parts: first || last < parts.length ? parts.slice(first, last) : parts }
}

/** The standard form of a crossing list on n ropes: { k, parts }. */
export function normalForm(n, word) {
  return word.reduce((f, g) => addToForm(n, f, g), { k: 0, parts: [] })
}

const formKey = (f) => `${f.k}|${f.parts.join('.')}`
export const tangleKey = (n, word) => formKey(normalForm(n, word))
export const isTrivial = (n, word) => {
  const f = normalForm(n, word)
  return f.k === 0 && f.parts.length === 0
}
const inverse = (word) => word.map(([i, s]) => [i, -s]).reverse()

// ---------- the board ----------
// state = { top: rope ids left to right at the top pegs, word, hole: { rope: hole }, holes }

/** Rope order (left to right) at the bottom. */
export function bottomOrder(top, word) {
  const o = top.slice()
  for (const [i] of word) [o[i], o[i + 1]] = [o[i + 1], o[i]]
  return o
}

/** Tidy the list a little as crossings are added (cancel opposites), so it stays short. */
export function addCrossing(word, g) {
  for (let k = word.length - 1; k >= 0; k--) {
    const [i, s] = word[k]
    if (Math.abs(i - g[0]) >= 2) continue // doesn't touch: slide past
    if (i === g[0] && s === -g[1]) return [...word.slice(0, k), ...word.slice(k + 1)]
    break
  }
  return [...word, g]
}

/** Crossings made by moving the rope at place i to place j, passing over the ropes between. */
export function passOver(i, j) {
  const out = []
  if (j > i) for (let k = i; k < j; k++) out.push([k, +1])
  else for (let k = i - 1; k >= j; k--) out.push([k, -1])
  return out
}

/** Move rope r's bottom peg into hole h. Returns the new state (the old one is untouched). */
export function move(state, r, h) {
  const n = state.top.length
  const o = state.order ?? bottomOrder(state.top, state.word)
  const i = o.indexOf(r)
  let j = 0
  for (const x of o) if (x !== r && state.hole[x] < h) j++
  let word = state.word
  let form = state.form ?? normalForm(n, word)
  const wind = (state.wind ?? windOf(state)).slice()
  const order = o.slice()
  for (const g of passOver(i, j)) {
    const [k, s] = g
    const a = order[k]
    const b = order[k + 1]
    wind[a < b ? a * n + b : b * n + a] += s
    order[k] = b
    order[k + 1] = a
    word = addCrossing(word, g)
    form = addToForm(n, form, g)
  }
  return { ...state, word, form, wind, order, hole: { ...state.hole, [r]: h } }
}

/** How much each pair of ropes winds (sum of its crossings, + or -), as an n × n table. */
function windOf(state) {
  const n = state.top.length
  const o = state.top.slice()
  const wind = new Int8Array(n * n)
  for (const [i, s] of state.word) {
    const a = o[i]
    const b = o[i + 1]
    wind[a < b ? a * n + b : b * n + a] += s
    o[i] = b
    o[i + 1] = a
  }
  return wind
}

export const solved = (state) => {
  const f = state.form ?? normalForm(state.top.length, state.word)
  return f.k === 0 && f.parts.length === 0
}
/** Same tangle and same holes = same key. */
export const stateKey = (s) => `${Object.values(s.hole).join(',')}#${formKey(s.form ?? normalForm(s.top.length, s.word))}`

/** Holes nobody is using. */
export function freeHoles(state) {
  const used = new Set(Object.values(state.hole))
  return [...Array(state.holes).keys()].filter((h) => !used.has(h))
}

/** The crossing list with rope r taken out. */
function without(top, word, r) {
  const o = top.slice()
  const out = []
  for (const [i, s] of word) {
    const p = o.indexOf(r)
    if (o[i] !== r && o[i + 1] !== r) out.push([p < i ? i - 1 : i, s])
    ;[o[i], o[i + 1]] = [o[i + 1], o[i]]
  }
  return out
}

/**
 * Rope r is free when it could be lifted straight off: the tangle is the same as the other
 * ropes' tangle with r lying across all of them, in front (or all behind).
 */
export function isFree(state, r) {
  const n = state.top.length
  if (n < 2) return true
  const pt = state.top.indexOf(r)
  const pb = bottomOrder(state.top, state.word).indexOf(r)
  const rest = without(state.top, state.word, r)
  for (const s of [1, -1]) {
    const lie = [...passOver(pt, n - 1).map(([i, x]) => [i, x * s]), ...rest, ...passOver(n - 1, pb).map(([i, x]) => [i, x * s])]
    if (isTrivial(n, [...state.word, ...inverse(lie)])) return true
  }
  return false
}

/**
 * Pairs of ropes wound around each other (looking at just those two): [a, b, turns]. One move
 * changes a pair's winding by at most one crossing, so a pair needs at least |turns| moves of
 * a or b: the solver's lower bound.
 */
export function linkedPairs(state) {
  const n = state.top.length
  const wind = state.wind ?? windOf(state)
  const out = []
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) if (wind[a * n + b]) out.push([a, b, Math.abs(wind[a * n + b])])
  return out
}

/** Seeded random numbers, so a level is the same every time. */
export function rng(seed) {
  let a = (seed * 2654435761) >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), a | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** The untangled start: rope i in hole slots[i]. */
export function untangled(ropes, holes, slots = [...Array(ropes).keys()]) {
  const hole = {}
  slots.forEach((h, i) => (hole[i] = h))
  const top = [...Array(ropes).keys()]
  return { top, word: [], form: { k: 0, parts: [] }, wind: new Int8Array(ropes * ropes), order: top.slice(), hole, holes }
}

/** Play a list of moves [[rope, hole], ...] from a state. */
export const play = (state, moves) => moves.reduce((s, [r, h]) => move(s, r, h), state)

/**
 * The Cut: rope r is taken out of the puzzle. The others keep their crossings with each other.
 * Ropes are numbered 0..n-1 in the rules, so the rest are renumbered: returns { state, ids },
 * ids[newNumber] = the rope's number before the cut.
 */
export function cut(state, r) {
  const n = state.top.length
  const ids = [...Array(n).keys()].filter((x) => x !== r)
  const hole = {}
  ids.forEach((old, i) => (hole[i] = state.hole[old]))
  const top = state.top.filter((x) => x !== r).map((x) => ids.indexOf(x))
  return { state: { top, word: without(state.top, state.word, r), hole, holes: state.holes }, ids }
}
