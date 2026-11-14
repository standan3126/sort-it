// Untangle rope physics (no Three.js here, so node tests can run it too).
//
// Each rope is a chain of points (position-based dynamics, the method many games use for cloth
// and rope): every small step the points move by their speed, then rules pull them back into
// shape. The rules:
//   - neighbouring points keep their spacing (the rope is taut between its pegs, a little give);
//   - every second point keeps a softer spacing (the rope is a bit stiff, so no sharp kinks);
//   - ropes are solid tubes: two pieces of different ropes are pushed apart to a rope's width,
//     so ropes can't pass through each other and the tangle on screen is the real tangle;
//   - the board leans back, so ropes rest against it and ropes on top rest on the ones under;
//   - lots of damping (friction on the board), so ropes settle without jiggling.
// Coordinates: x right, y up (screen y is -y), z toward the player; the board is z = 0.

export const RADIUS = 6
const GAP = RADIUS * 2 + 0.6 // centre-to-centre distance between touching ropes
const POINTS = 32
const SUBSTEPS = 2
const ITERATIONS = 7
const DAMP = 0.86 // speed kept each small step (lower = calmer)
const LEAN = 0.35 // pull toward the board each small step
const DROOP = 0.04 // a little gravity, so slack hangs downward
const SLACK = 1.025 // rope length compared with the straight line between its pegs
const REACH = GAP + 10 // how near two pieces must be to be checked this frame (with room to move)
export const LIFTED = 56 // how far a picked-up peg rises toward the player

export class RopeWorld {
  constructor() {
    this.ropes = []
    this.cand = new Int32Array(4096)
    this.nCand = 0
  }

  /** A straight rope from (x0, y0) at the top to (x1, y1) at the bottom (screen coordinates). */
  addRope(id, x0, y0, x1, y1) {
    const pos = new Float64Array(POINTS * 3)
    for (let i = 0; i < POINTS; i++) {
      const f = i / (POINTS - 1)
      pos[i * 3] = x0 + (x1 - x0) * f
      pos[i * 3 + 1] = -(y0 + (y1 - y0) * f)
      pos[i * 3 + 2] = RADIUS
    }
    const rope = { id, pos, prev: pos.slice(), top: [x0, -y0, RADIUS], end: [x1, -y1, RADIUS], rest: 0, awake: true }
    this.ropes.push(rope)
    return rope
  }

  /** Where the bottom end should be (screen x, y; z = how far it's lifted toward the player). */
  setEnd(rope, x, y, z = RADIUS) {
    rope.end = [x, -y, z]
    this.wake()
  }

  wake() {
    for (const r of this.ropes) r.awake = true
    this.quiet = 0
  }

  /** One frame (1/60 s). Returns true while anything is still moving. */
  step() {
    if (this.quiet > 30) return false
    let most = 0
    this.findPairs()
    for (let s = 0; s < SUBSTEPS; s++) most = Math.max(most, this.substep())
    this.quiet = most < 0.002 ? this.quiet + 1 : 0
    return true
  }

  substep() {
    const ropes = this.ropes
    let most = 0
    for (const r of ropes) {
      const { pos, prev } = r
      // The bottom end glides toward where it should be, never jumping (no tunnelling). Picked
      // up: it rises first, then travels. Put down: it travels first, then lowers into the hole.
      const e = (POINTS - 1) * 3
      const lifting = r.end[2] > RADIUS + 1
      const xyLeft = Math.hypot(r.end[0] - pos[e], r.end[1] - pos[e + 1])
      const canSlide = lifting ? pos[e + 2] >= Math.min(r.end[2], LIFTED) - 0.5 : true
      const canLower = lifting || xyLeft < 0.5
      for (let k = 0; k < 3; k++) {
        if (k < 2 && !canSlide) continue
        if (k === 2 && !canLower) continue
        const d = r.end[k] - pos[e + k]
        pos[e + k] += Math.max(-7, Math.min(7, d))
      }
      // Rope length: a little more than the straight line between its two ends.
      const dx = pos[e] - r.top[0]
      const dy = pos[e + 1] - r.top[1]
      const dz = pos[e + 2] - r.top[2]
      r.rest = (Math.hypot(dx, dy, dz) * SLACK) / (POINTS - 1)
      for (let i = 1; i < POINTS - 1; i++) {
        const j = i * 3
        for (let k = 0; k < 3; k++) {
          const v = (pos[j + k] - prev[j + k]) * DAMP
          prev[j + k] = pos[j + k]
          pos[j + k] += v
          most = Math.max(most, Math.abs(v))
        }
        pos[j + 1] -= DROOP
        pos[j + 2] -= LEAN
      }
      pos[0] = r.top[0]
      pos[1] = r.top[1]
      pos[2] = r.top[2]
    }
    for (let it = 0; it < ITERATIONS; it++) {
      for (const r of ropes) this.shape(r)
      this.collide()
      for (const r of ropes) {
        const { pos } = r
        for (let i = 1; i < POINTS - 1; i++) if (pos[i * 3 + 2] < RADIUS) pos[i * 3 + 2] = RADIUS // the board
      }
    }
    return most
  }

  shape(r) {
    const { pos, rest } = r
    const pull = (a, b, len, stiff) => {
      const ia = a * 3
      const ib = b * 3
      const dx = pos[ib] - pos[ia]
      const dy = pos[ib + 1] - pos[ia + 1]
      const dz = pos[ib + 2] - pos[ia + 2]
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9
      const wa = a === 0 || a === POINTS - 1 ? 0 : 1
      const wb = b === 0 || b === POINTS - 1 ? 0 : 1
      if (!wa && !wb) return
      const c = ((d - len) / d / (wa + wb)) * stiff
      pos[ia] += dx * c * wa
      pos[ia + 1] += dy * c * wa
      pos[ia + 2] += dz * c * wa
      pos[ib] -= dx * c * wb
      pos[ib + 1] -= dy * c * wb
      pos[ib + 2] -= dz * c * wb
    }
    for (let i = 0; i + 1 < POINTS; i++) pull(i, i + 1, rest, 0.9)
    for (let i = 0; i + 2 < POINTS; i++) pull(i, i + 2, rest * 2, 0.08)
  }

  // Pieces of different ropes near each other, found once a frame: every piece's box (with room
  // to move during the frame), sorted top to bottom, then neighbours in that list compared.
  findPairs() {
    const ropes = this.ropes
    const segs = (this.segs ??= [])
    segs.length = 0
    ropes.forEach((r, ri) => {
      const p = r.pos
      for (let i = 0; i + 1 < POINTS; i++) {
        const a = i * 3
        const b = a + 3
        segs.push({
          id: ri * 64 + i,
          x0: Math.min(p[a], p[b]) - REACH, x1: Math.max(p[a], p[b]) + REACH,
          y0: Math.min(p[a + 1], p[b + 1]) - REACH, y1: Math.max(p[a + 1], p[b + 1]) + REACH,
        })
      }
    })
    segs.sort((u, v) => u.y0 - v.y0)
    let n = 0
    for (let i = 0; i < segs.length; i++) {
      const u = segs[i]
      for (let j = i + 1; j < segs.length; j++) {
        const v = segs[j]
        if (v.y0 > u.y1) break
        if (v.x0 > u.x1 || v.x1 < u.x0 || u.id >> 6 === v.id >> 6) continue
        if (n + 2 > this.cand.length) {
          const bigger = new Int32Array(this.cand.length * 2)
          bigger.set(this.cand)
          this.cand = bigger
        }
        this.cand[n++] = u.id
        this.cand[n++] = v.id
      }
    }
    this.nCand = n
  }

  collide() {
    const c = this.cand
    const ropes = this.ropes
    for (let n = 0; n < this.nCand; n += 2) pushApart(ropes[c[n] >> 6].pos, c[n] & 63, ropes[c[n + 1] >> 6].pos, c[n + 1] & 63)
  }

  /** Where each rope's points are now (for drawing): [{ id, pos }]. */
  snapshot() {
    return this.ropes.map((r) => ({ id: r.id, pos: r.pos.slice(), prev: r.prev.slice(), end: r.end.slice() }))
  }

  restore(snap) {
    for (const s of snap) {
      const r = this.ropes.find((x) => x.id === s.id)
      r.pos.set(s.pos)
      r.prev.set(s.prev)
      r.end = s.end.slice()
    }
    this.wake()
  }
}

// Closest points between segment (p0, p1) and (q0, q1) (from "Real-Time Collision Detection",
// Ericson), then push both apart to GAP, sharing the push by how near each end the touch is.
const end = (i) => i === 0 || i === POINTS - 1
function pushApart(P, i, Q, j) {
  const a = i * 3
  const b = j * 3
  const d1x = P[a + 3] - P[a]
  const d1y = P[a + 4] - P[a + 1]
  const d1z = P[a + 5] - P[a + 2]
  const d2x = Q[b + 3] - Q[b]
  const d2y = Q[b + 4] - Q[b + 1]
  const d2z = Q[b + 5] - Q[b + 2]
  const rx = P[a] - Q[b]
  const ry = P[a + 1] - Q[b + 1]
  const rz = P[a + 2] - Q[b + 2]
  const aa = d1x * d1x + d1y * d1y + d1z * d1z
  const ee = d2x * d2x + d2y * d2y + d2z * d2z
  const ff = d2x * rx + d2y * ry + d2z * rz
  const cc = d1x * rx + d1y * ry + d1z * rz
  const bb = d1x * d2x + d1y * d2y + d1z * d2z
  const den = aa * ee - bb * bb
  let s = den > 1e-9 ? clamp((bb * ff - cc * ee) / den) : 0
  let t = (bb * s + ff) / ee
  if (t < 0) {
    t = 0
    s = clamp(-cc / aa)
  } else if (t > 1) {
    t = 1
    s = clamp((bb - cc) / aa)
  }
  const px = P[a] + d1x * s
  const py = P[a + 1] + d1y * s
  const pz = P[a + 2] + d1z * s
  const qx = Q[b] + d2x * t
  const qy = Q[b + 1] + d2y * t
  const qz = Q[b + 2] + d2z * t
  let nx = px - qx
  let ny = py - qy
  let nz = pz - qz
  const d2 = nx * nx + ny * ny + nz * nz
  if (d2 >= GAP * GAP) return
  let d = Math.sqrt(d2)
  if (d < 1e-6) {
    // Exactly on top of each other: the one already nearer the player goes in front.
    nx = 0
    ny = 0
    nz = pz >= qz ? 1 : -1
    d = 1e-6
  } else {
    nx /= d
    ny /= d
    nz /= d
  }
  const wa0 = end(i) ? 0 : 1 - s
  const wa1 = end(i + 1) ? 0 : s
  const wb0 = end(j) ? 0 : 1 - t
  const wb1 = end(j + 1) ? 0 : t
  const sum = wa0 * wa0 + wa1 * wa1 + wb0 * wb0 + wb1 * wb1
  if (sum < 1e-9) return
  const lam = (GAP - d) / sum
  const move = (arr, k, w, sign) => {
    arr[k] += nx * lam * w * sign
    arr[k + 1] += ny * lam * w * sign
    arr[k + 2] += nz * lam * w * sign
  }
  move(P, a, wa0, 1)
  move(P, a + 3, wa1, 1)
  move(Q, b, wb0, -1)
  move(Q, b + 3, wb1, -1)
}
const clamp = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)

/**
 * How many times each pair of ropes winds around the other, read off the picture: for every
 * place two ropes cross on screen, +1 or -1 by which is in front. Matches rules.js linkedPairs
 * when the physics is right (tests use it to catch ropes slipping through each other).
 */
export function windings(world) {
  const out = new Map()
  const R = world.ropes
  for (let a = 0; a < R.length; a++) {
    for (let b = a + 1; b < R.length; b++) {
      let sum = 0
      const P = R[a].pos
      const Q = R[b].pos
      for (let i = 0; i + 1 < POINTS; i++) {
        for (let j = 0; j + 1 < POINTS; j++) {
          const hit = cross2d(P, i, Q, j)
          if (!hit) continue
          const [s, t] = hit
          const zp = P[i * 3 + 2] + (P[i * 3 + 5] - P[i * 3 + 2]) * s
          const zq = Q[j * 3 + 2] + (Q[j * 3 + 5] - Q[j * 3 + 2]) * t
          // Directions going down each rope; which one is in front decides the sign.
          const ux = P[i * 3 + 3] - P[i * 3]
          const uy = P[i * 3 + 4] - P[i * 3 + 1]
          const vx = Q[j * 3 + 3] - Q[j * 3]
          const vy = Q[j * 3 + 4] - Q[j * 3 + 1]
          const crossUV = ux * vy - uy * vx
          const overIsP = zp > zq
          const sign = -Math.sign(overIsP ? crossUV : -crossUV)
          // Rope a may be on either side: report it as (lower id, higher id) like rules.js.
          sum += sign
        }
      }
      if (sum) {
        const ida = R[a].id
        const idb = R[b].id
        out.set(`${Math.min(ida, idb)}-${Math.max(ida, idb)}`, ida < idb ? sum : sum)
      }
    }
  }
  return out
}

function cross2d(P, i, Q, j) {
  const ax = P[i * 3]
  const ay = P[i * 3 + 1]
  const bx = P[i * 3 + 3]
  const by = P[i * 3 + 4]
  const cx = Q[j * 3]
  const cy = Q[j * 3 + 1]
  const dx = Q[j * 3 + 3]
  const dy = Q[j * 3 + 4]
  const den = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx)
  if (Math.abs(den) < 1e-12) return null
  const s = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / den
  const t = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / den
  return s >= 0 && s < 1 && t >= 0 && t < 1 ? [s, t] : null
}

export { POINTS }
