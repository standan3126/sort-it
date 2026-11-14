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
// A piece is an array w; adding a crossing at place i on the right swaps positions i, i+1;
// on the left swaps the values i, i+1.
const swapPos = (w, i) => {
  const c = w.slice()
  ;[c[i], c[i + 1]] = [c[i + 1], c[i]]
  return c
}
const swapVal = (w, i) => w.map((v) => (v === i ? i + 1 : v === i + 1 ? i : v))
const ident = (n) => [...Array(n).keys()]
const delta = (n) => ident(n).reverse()
const isIdent = (w) => w.every((v, i) => v === i)
const isDelta = (w) => w.every((v, i) => v === w.length - 1 - i)
// Δ x Δ⁻¹: the same piece seen in a mirror.
const flip = (w) => w.map((_, j) => w.length - 1 - w[w.length - 1 - j])
const ends = (w, i) => w[i] > w[i + 1] // could end with a crossing at place i
const starts = (w, i) => w.indexOf(i) > w.indexOf(i + 1) // could start with one

/** The standard form of a crossing list on n ropes: { k, parts }. */
export function normalForm(n, word) {
  let k = 0
  let parts = []
  for (const [i, s] of word) {
    if (s > 0) parts.push(swapPos(ident(n), i))
    else {
      // σᵢ⁻¹ = Δ⁻¹ · (Δ σᵢ⁻¹); move the Δ⁻¹ to the front, mirroring what it passes.
      parts = parts.map(flip)
      k--
      parts.push(swapPos(delta(n), i))
    }
  }
  // Make every neighbouring pair "left-weighted" (crossings moved as far left as they can go)
  // until nothing changes; then the full twists Δ sit at the front and plain pieces at the end.
  for (let changed = true; changed; ) {
    changed = false
    for (let j = 0; j + 1 < parts.length; j++) {
      let a = parts[j]
      let b = parts[j + 1]
      for (let i = 0; i < n - 1; i++) {
        if (starts(b, i) && !ends(a, i)) {
          a = swapPos(a, i)
          b = swapVal(b, i)
          changed = true
          i = -1 // look again from the start
        }
      }
      parts[j] = a
      parts[j + 1] = b
    }
  }
  while (parts.length && isDelta(parts[0])) {
    parts.shift()
    k++
  }
  parts = parts.filter((w) => !isIdent(w))
  return { k, parts }
}

const formKey = (f) => `${f.k}|${f.parts.map((w) => w.join('')).join('.')}`
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
  const o = bottomOrder(state.top, state.word)
  const i = o.indexOf(r)
  const j = o.filter((x) => x !== r && state.hole[x] < h).length
  let word = state.word
  for (const g of passOver(i, j)) word = addCrossing(word, g)
  return { ...state, word, hole: { ...state.hole, [r]: h } }
}

export const solved = (state) => isTrivial(state.top.length, state.word)

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
 * Pairs of ropes wound around each other (looking at just those two). One of each such pair
 * has to move at least once: the solver's lower bound.
 */
export function linkedPairs(state) {
  const o = state.top.slice()
  const wind = new Map()
  for (const [i, s] of state.word) {
    const a = Math.min(o[i], o[i + 1])
    const b = Math.max(o[i], o[i + 1])
    const key = a * 16 + b
    wind.set(key, (wind.get(key) ?? 0) + s)
    ;[o[i], o[i + 1]] = [o[i + 1], o[i]]
  }
  return [...wind].filter(([, w]) => w !== 0).map(([key]) => [key >> 4, key & 15])
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
  return { top: [...Array(ropes).keys()], word: [], hole, holes }
}

/** Play a list of moves [[rope, hole], ...] from a state. */
export const play = (state, moves) => moves.reduce((s, [r, h]) => move(s, r, h), state)
