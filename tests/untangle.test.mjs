// Untangle rules: the exact "is it untangled?" check, freeing ropes, moves.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalForm, isTrivial, tangleKey, move, solved, isFree, untangled, play, rng, linkedPairs } from '../js/untangle/rules.js'

// A slow but obviously right check (the braid group acting on a free group): a tangle is
// undone exactly when it sends every letter back to itself. Fine for short lists.
function freeImage(n, word) {
  const red = (w) => { const out = []; for (const x of w) out.length && out.at(-1) === -x ? out.pop() : out.push(x); return out }
  const inv = (w) => w.map((x) => -x).reverse()
  let img = [...Array(n).keys()].map((i) => [i + 1])
  for (const [i, s] of word) {
    const a = i + 1, b = i + 2
    const sub = (map) => img.map((w) => red(w.flatMap((x) => { const g = Math.abs(x); const m = map[g] ?? [g]; return x > 0 ? m : inv(m) })))
    img = s > 0 ? sub({ [a]: [a, b, -a], [b]: [a] }) : sub({ [a]: [b], [b]: [-b, a, b] })
  }
  return img
}
const freeTrivial = (n, word) => freeImage(n, word).every((w, i) => w.length === 1 && w[0] === i + 1)

test('standard form agrees with the free-group check on random tangles', () => {
  const r = rng(5)
  let trivial = 0
  for (let t = 0; t < 4000; t++) {
    const n = 2 + Math.floor(r() * 4)
    const len = Math.floor(r() * 9)
    let word = [...Array(len)].map(() => [Math.floor(r() * (n - 1)), r() < 0.5 ? 1 : -1])
    // Half the time, glue on a disguised copy of its own inverse so plenty of cases are undone.
    if (r() < 0.5) {
      const w2 = word.map(([i, s]) => [i, -s]).reverse()
      word = [...word, ...w2]
      // ...then apply a braid relation somewhere so it isn't a plain cancel.
      for (let k = 0; k + 2 < word.length; k++) {
        const [a, b, c] = word.slice(k, k + 3)
        if (a[1] === 1 && b[1] === 1 && c[1] === 1 && a[0] === c[0] && Math.abs(a[0] - b[0]) === 1) { word.splice(k, 3, [b[0], 1], [a[0], 1], [b[0], 1]); break }
      }
    }
    const f = freeTrivial(n, word)
    if (f) trivial++
    assert.equal(isTrivial(n, word), f, JSON.stringify({ n, word }))
  }
  assert.ok(trivial > 1000)
})

test('the braid relation gives the same form', () => {
  assert.equal(tangleKey(3, [[0, 1], [1, 1], [0, 1]]), tangleKey(3, [[1, 1], [0, 1], [1, 1]]))
  assert.equal(tangleKey(3, [[0, -1], [1, -1], [0, -1]]), tangleKey(3, [[1, -1], [0, -1], [1, -1]]))
  assert.notEqual(tangleKey(3, [[0, 1], [0, 1]]), tangleKey(3, []))
})

test('moving back the same way undoes; moving the other rope over twists', () => {
  const s = untangled(3, 4)
  const a = move(s, 0, 3)
  assert.ok(!solved(a))
  assert.ok(solved(move(a, 0, 0)))
  const c = move(a, 1, 0)
  assert.ok(!solved(c))
})

test('a rope lying over everything is free', () => {
  const s = untangled(4, 6)
  const a = move(s, 0, 4) // rope 0 lies across all the others, in front
  assert.ok(isFree(a, 0))
  assert.ok(!solved(a))
  const b = move(a, 1, 5) // rope 1 passes over 2, 3 and rope 0: 0 and 1 are wound together
  assert.ok(!isFree(b, 0) && !isFree(b, 1))
  assert.ok(isFree(b, 3))
})

test('one rope moved over two, untangled by moving the two over it', () => {
  // Rope 0 passes over 1 and 2 to the right. Moving 1 and then 2 back over 0 doesn't free it
  // (each wraps around), but moving 0 back does.
  let s = play(untangled(3, 4), [[0, 3]])
  assert.deepEqual(linkedPairs(s).length, 2)
  assert.ok(solved(play(s, [[0, 0]])))
  assert.ok(!solved(play(s, [[1, 0]])))
})
