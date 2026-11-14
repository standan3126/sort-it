// Untangle in Sort It: one level being played. main.js owns the pages, saves, clock and the
// done card; this owns the ropes (physics + 3D view), the scenery, dragging pegs, Undo, Restart
// and the Cut.
//   run (saved by main.js): { n, actions: [[rope, hole] | [rope, 'cut']], moves, undosLeft, time, cuts }
//   Rope numbers in `actions` are the level's own (0..ropes-1), so they survive a Cut, which
//   renumbers the ropes inside the rules (see rules.js cut).
import { RopeWorld, LIFTED, RADIUS, POINTS } from './ropes.js'
import { View } from './view.js'
import { move, solved, isFree, cut } from './rules.js'
import { parseLevel } from './levels.js'
import { mountScene, placeForLevel } from '/shared/v1/scenery.js'

export const UNDOS = 3
const FINGER_LIFT = 72 // the peg floats this far above the finger (PATTERNS "Dragging you can see")
const SNAP = 40 // how near the peg must be for a hole to light up
const GRAB = 34 // how near a peg a touch must be to pick it up

export class Untangle {
  /**
   * stage: element for the 3D canvas; scenery: element behind it.
   * hooks: { sounds, onMove(), onDone(), cutsLeft(), onCutMode(on) }
   */
  constructor(stage, scenery, hooks) {
    this.stage = stage
    this.scenery = scenery
    this.hooks = hooks
    this.view = new View(stage)
    this.night = false
    this.active = false
    this.busy = false
    this.drag = null
    this.cutting = false
    this.speed = 1
    this.waiters = []
    this.loadId = 0
    const c = this.view.canvas
    c.addEventListener('pointerdown', (e) => this.down(e))
    c.addEventListener('pointermove', (e) => this.drag && this.follow(this.local(e)))
    c.addEventListener('pointerup', () => this.letGo())
    c.addEventListener('pointercancel', () => this.letGo())
    this.frame = this.frame.bind(this)
  }

  // ---------- showing ----------
  resize() {
    const W = this.stage.clientWidth
    const H = this.stage.clientHeight
    if (!W || !H) return
    this.view.resize(W, H)
  }

  setNight(night) {
    this.night = night
    this.view.setNight(night)
    if (this.run) this.paintScene()
  }

  paintScene() {
    const { place, seed } = placeForLevel(this.run.n)
    if (this.place === `${place}${seed}${this.night}`) return
    this.place = `${place}${seed}${this.night}`
    mountScene(this.scenery, { place, seed, night: this.night })
  }

  start() {
    if (this.active) return
    this.active = true
    requestAnimationFrame(this.frame)
  }

  stop() {
    this.active = false
    this.drag = null
    this.view.showHole(null)
    this.setCutting(false)
  }

  layout(st) {
    const W = this.view.W
    const H = this.view.H
    const n = st.top.length
    const sp = Math.min(58, (W - 36) / st.holes)
    const tsp = Math.min(62, (W - 70) / Math.max(1, n - 1))
    return {
      holes: st.holes,
      pegR: sp < 42 ? 11 : 13,
      holeX: (h) => W / 2 + (h - (st.holes - 1) / 2) * sp,
      topX: (o) => W / 2 + (o - (n - 1) / 2) * tsp,
      yTop: Math.max(112, Math.round(H * 0.14)),
      yHole: H - Math.max(118, Math.round(H * 0.15)),
    }
  }

  // ---------- a level ----------
  /** Show level `run.n` (text = its line in the level list), tangle it, then replay `run.actions`. */
  async load(run, text) {
    const id = ++this.loadId
    this.run = run
    this.text = text
    this.done = false
    this.setCutting(false)
    this.paintScene()
    this.resize()
    const lv = parseLevel(text)
    this.ids = lv.start.top.slice() // rule number → level rope number
    this.state = lv.start
    this.L = this.layout(lv.start)
    this.world = new RopeWorld({ elastic: true })
    lv.start.top.forEach((r, o) => this.world.addRope(r, this.L.topX(o), this.L.yTop, this.L.holeX(lv.start.hole[r]), this.L.yHole))
    this.view.build(this.L, lv.start.top)
    this.start()
    this.busy = true
    this.speed = 6
    for (let f = 0; f < 30; f++) this.world.step()
    for (const [r, h] of lv.moves) {
      await this.carry(r, h)
      if (id !== this.loadId) return
      this.state = move(this.state, r, h)
    }
    await this.settle()
    if (id !== this.loadId) return
    this.tangled = { state: this.state, snap: this.world.snapshot() }
    // A level in progress: play the player's moves again.
    this.history = []
    for (const a of run.actions) {
      if (a[1] === 'cut') this.cutRope(a[0], false)
      else {
        const r = this.ids.indexOf(a[0])
        this.history.push({ state: this.state, ids: this.ids, a })
        await this.carry(r, a[1])
        if (id !== this.loadId) return
        this.state = move(this.state, r, a[1])
      }
    }
    this.speed = 1
    this.busy = false
    this.markFree(false)
    if (solved(this.state)) this.finish()
  }

  /** Restart: back to the tangle the level started with (ropes cut in this try come back). */
  restart() {
    if (!this.tangled) return
    const lv = parseLevel(this.text)
    this.world = new RopeWorld({ elastic: true })
    lv.start.top.forEach((r, o) => this.world.addRope(r, this.L.topX(o), this.L.yTop, this.L.holeX(lv.start.hole[r]), this.L.yHole))
    this.world.restore(this.tangled.snap)
    this.view.build(this.L, lv.start.top)
    this.ids = lv.start.top.slice()
    this.state = this.tangled.state
    this.history = []
    this.done = false
    this.drag = null
    this.setCutting(false)
    this.markFree(false)
  }

  // ---------- the physics, one screen frame at a time ----------
  frame() {
    if (!this.active) return
    let moved = false
    if (this.world) {
      // Tangling at the start runs fast, but only as many steps as fit in ~12 ms, so a slower
      // phone just tangles a little slower instead of stuttering.
      const t0 = performance.now()
      for (let s = 0; s < this.speed; s++) {
        moved = this.world.step() || moved
        if (this.speed > 1 && performance.now() - t0 > 12) break
      }
      this.view.draw(this.world, { moved: moved || !!this.drag, done: this.done })
    }
    const due = this.waiters
    this.waiters = []
    for (const w of due) (--w.n <= 0 ? w.res() : this.waiters.push(w))
    requestAnimationFrame(this.frame)
  }

  frames(n) {
    return new Promise((res) => this.waiters.push({ n, res }))
  }

  endOf(r) {
    const rope = this.world.ropes.find((x) => x.id === this.ids[r])
    const e = (POINTS - 1) * 3
    return { rope, x: rope.pos[e], y: -rope.pos[e + 1], z: rope.pos[e + 2] }
  }

  /** Carry rope r's peg to hole h: up, across, down (for tangling, replays and Undo). */
  async carry(r, h) {
    const { rope, x } = this.endOf(r)
    const L = this.L
    this.world.setEnd(rope, x, L.yHole, LIFTED)
    for (let f = 0; f < 400 && this.endOf(r).z < LIFTED - 1; f++) await this.frames(1)
    this.world.setEnd(rope, L.holeX(h), L.yHole, LIFTED)
    for (let f = 0; f < 400 && Math.abs(this.endOf(r).x - L.holeX(h)) > 1; f++) await this.frames(1)
    this.world.setEnd(rope, L.holeX(h), L.yHole)
    for (let f = 0; f < 400 && this.endOf(r).z > RADIUS + 0.5; f++) await this.frames(1)
    await this.frames(4)
  }

  async settle() {
    for (let f = 0; f < 240 && this.world.quiet <= 30; f++) await this.frames(1)
  }

  // ---------- dragging a peg ----------
  local(e) {
    const b = this.view.canvas.getBoundingClientRect()
    return { x: e.clientX - b.left, y: e.clientY - b.top }
  }

  pegAt(p) {
    let pick = null
    let best = GRAB
    for (const r of this.state.top) {
      const d = Math.hypot(this.L.holeX(this.state.hole[r]) - p.x, this.L.yHole - p.y)
      if (d < best) [pick, best] = [r, d]
    }
    return pick
  }

  down(e) {
    if (!this.run || this.busy || this.done || this.drag) return
    const p = this.local(e)
    const r = this.pegAt(p)
    if (r === null) return
    if (this.cutting) return this.cutRope(r, true)
    this.view.canvas.setPointerCapture(e.pointerId)
    this.drag = { r, hole: null }
    this.follow(p)
  }

  holeNear(px, py, r) {
    const used = new Set(Object.values(this.state.hole))
    let best = null
    let bestD = SNAP
    for (let h = 0; h < this.L.holes; h++) {
      if (used.has(h)) continue
      const d = Math.hypot(this.L.holeX(h) - px, this.L.yHole - py)
      if (d < bestD) [best, bestD] = [h, d]
    }
    return best
  }

  follow(p) {
    const x = Math.max(12, Math.min(this.view.W - 12, p.x))
    const y = Math.min(this.L.yHole, p.y - FINGER_LIFT)
    this.world.setEnd(this.endOf(this.drag.r).rope, x, y, LIFTED)
    this.drag.hole = this.holeNear(x, y, this.drag.r)
    this.view.showHole(this.drag.hole == null ? null : this.L.holeX(this.drag.hole), this.L.yHole)
  }

  letGo() {
    if (!this.drag) return
    const { r, hole } = this.drag
    this.drag = null
    this.view.showHole(null)
    const rope = this.endOf(r).rope
    if (hole == null) {
      this.world.setEnd(rope, this.L.holeX(this.state.hole[r]), this.L.yHole) // back, no move
      this.hooks.sounds.nope()
      return
    }
    const a = [this.ids[r], hole]
    this.history.push({ state: this.state, ids: this.ids, a })
    this.state = move(this.state, r, hole)
    this.world.setEnd(rope, this.L.holeX(hole), this.L.yHole)
    this.run.actions.push(a)
    this.run.moves++
    this.afterMove()
  }

  /** Glow the ropes that just came free, then check for the end. Sounds (user, 2026-11-14): one
   * chime for every move, a double chime instead when a rope comes free. */
  afterMove() {
    const freed = this.markFree(true)
    if (freed) this.hooks.sounds.freed()
    else this.hooks.sounds.drop()
    this.hooks.onMove()
    if (solved(this.state)) this.finish()
  }

  markFree(chime) {
    let count = 0
    for (const r of this.state.top) {
      const v = this.view.ropes.get(this.ids[r])
      const free = isFree(this.state, r)
      if (free && !v.free && chime) {
        this.view.glow(this.ids[r])
        count++
      }
      v.free = free
    }
    return count
  }

  finish() {
    this.done = true
    for (const r of this.state.top) this.view.glow(this.ids[r])
    this.hooks.onDone()
  }

  // ---------- Undo ----------
  canUndo() {
    return !!this.history?.length && this.run.undosLeft > 0 && !this.busy && !this.done
  }

  /** The last move played backwards: the rope goes back the way it came. */
  async undo() {
    if (!this.canUndo()) return
    const last = this.history.pop()
    const r = last.ids.indexOf(last.a[0])
    this.run.undosLeft--
    this.run.moves = Math.max(0, this.run.moves - 1) // user: Undo takes the move off the count
    this.run.actions.pop()
    this.busy = true
    this.hooks.onMove()
    await this.carry(r, last.state.hole[r])
    this.state = last.state
    this.busy = false
    this.markFree(false)
    this.hooks.onMove()
  }

  // ---------- the Cut ----------
  setCutting(on) {
    this.cutting = !!on
    this.hooks.onCutMode?.(this.cutting)
  }

  /** Take rope r (rules number) out. `fresh` = the player just did it (not a replay). */
  cutRope(r, fresh) {
    const level = this.ids[r]
    const c = cut(this.state, r)
    this.state = c.state
    this.ids = c.ids.map((old) => this.ids[old])
    const i = this.world.ropes.findIndex((x) => x.id === level)
    this.world.ropes.splice(i, 1)
    this.world.wake()
    const v = this.view.ropes.get(level)
    v.mesh.visible = false
    v.peg.visible = false
    this.view.ropes.delete(level)
    // An Undo can't bring a cut rope back: undos start again from here.
    this.history = []
    if (!fresh) return
    this.setCutting(false)
    this.run.actions.push([level, 'cut'])
    this.run.cuts = (this.run.cuts || 0) + 1
    this.run.moves++ // a Cut counts as a move
    this.afterMove()
  }
}
