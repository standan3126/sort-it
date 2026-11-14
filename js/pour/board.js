// Pour: drawing the tubes on a canvas, the pour animation, sparkles, and finding the tapped tube.
// The liquid always lies flat: each layer is cut from the tube's shape by level lines, found by
// the area it must fill, so a tilted tube looks right while it pours.
import { HEIGHT, isComplete } from './rules.js'

// Bright colours on black, the most different ones first (the early levels use only a few).
// `ink` is the colour of the colour-blind mark drawn on each layer.
export const COLORS = {
  a: { fill: '#ff2d3d', ink: '#000', mark: 'circle' }, // red
  b: { fill: '#2f6bff', ink: '#fff', mark: 'star' }, // blue
  c: { fill: '#ffe100', ink: '#000', mark: 'square' }, // yellow
  d: { fill: '#00b84a', ink: '#fff', mark: 'plus' }, // green
  e: { fill: '#9b3dff', ink: '#fff', mark: 'cross' }, // purple
  f: { fill: '#ff8a00', ink: '#000', mark: 'triangle' }, // orange
  g: { fill: '#00e5ff', ink: '#000', mark: 'ring' }, // cyan
  h: { fill: '#ffa3c4', ink: '#000', mark: 'heart' }, // pink
  i: { fill: '#7dff1a', ink: '#000', mark: 'diamond' }, // lime
  j: { fill: '#ff2fd0', ink: '#000', mark: 'bars' }, // magenta
  k: { fill: '#f4f4f4', ink: '#000', mark: 'dots' }, // white
  l: { fill: '#a0582a', ink: '#fff', mark: 'moon' }, // brown
}

const OUTLINE = '#ffffff'
const MOVE = 0.2 // seconds to lift over and come back
const TILT = 1.45 // radians (about 83°): past level, so the liquid runs out of the mouth

// ---- Shapes as polygons (world coordinates, y down) -----------------------------------------
function tubeShape(w, h, steps = 14) {
  const r = w / 2
  const pts = [[-r, 0], [-r, h - r]]
  for (let k = 1; k < steps; k++) {
    const a = Math.PI - (Math.PI * k) / steps
    pts.push([r * Math.cos(a), h - r + r * Math.sin(a)])
  }
  pts.push([r, h - r], [r, 0])
  return pts
}

const place = (pts, x, y, angle) => {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return pts.map(([px, py]) => [x + px * c - py * s, y + px * s + py * c])
}

// The part of a polygon with y >= Y (below the line) or y <= Y (above it).
function clip(poly, Y, below) {
  const inside = (p) => (below ? p[1] >= Y : p[1] <= Y)
  const out = []
  for (let k = 0; k < poly.length; k++) {
    const a = poly[k]
    const b = poly[(k + 1) % poly.length]
    const ia = inside(a)
    const ib = inside(b)
    if (ia) out.push(a)
    if (ia !== ib) {
      const t = (Y - a[1]) / (b[1] - a[1])
      out.push([a[0] + t * (b[0] - a[0]), Y])
    }
  }
  return out
}

function area(poly) {
  let s = 0
  for (let k = 0; k < poly.length; k++) {
    const [x1, y1] = poly[k]
    const [x2, y2] = poly[(k + 1) % poly.length]
    s += x1 * y2 - x2 * y1
  }
  return Math.abs(s) / 2
}

// The level line (y) with exactly `want` area of the polygon below it.
function levelFor(poly, want) {
  let lo = Infinity
  let hi = -Infinity
  for (const p of poly) {
    lo = Math.min(lo, p[1])
    hi = Math.max(hi, p[1])
  }
  if (want <= 0) return hi
  let top = lo
  let bottom = hi
  for (let k = 0; k < 28; k++) {
    const mid = (top + bottom) / 2
    if (area(clip(poly, mid, true)) > want) top = mid
    else bottom = mid
  }
  return (top + bottom) / 2
}

function pathOf(ctx, poly) {
  ctx.beginPath()
  poly.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
  ctx.closePath()
}

// ---- Marks for colour-blind players ----------------------------------------------------------
function drawMark(ctx, kind, x, y, s, ink) {
  ctx.save()
  ctx.translate(x, y)
  ctx.fillStyle = ink
  ctx.strokeStyle = ink
  ctx.lineWidth = Math.max(1.5, s * 0.22)
  ctx.lineCap = 'round'
  ctx.globalAlpha = 0.7
  const r = s / 2
  ctx.beginPath()
  switch (kind) {
    case 'circle':
      ctx.arc(0, 0, r * 0.75, 0, Math.PI * 2)
      ctx.fill()
      break
    case 'ring':
      ctx.arc(0, 0, r * 0.7, 0, Math.PI * 2)
      ctx.stroke()
      break
    case 'triangle':
      ctx.moveTo(0, -r)
      ctx.lineTo(r, r * 0.8)
      ctx.lineTo(-r, r * 0.8)
      ctx.closePath()
      ctx.fill()
      break
    case 'square':
      ctx.rect(-r * 0.75, -r * 0.75, r * 1.5, r * 1.5)
      ctx.fill()
      break
    case 'diamond':
      ctx.moveTo(0, -r)
      ctx.lineTo(r, 0)
      ctx.lineTo(0, r)
      ctx.lineTo(-r, 0)
      ctx.closePath()
      ctx.fill()
      break
    case 'plus':
      ctx.moveTo(-r, 0)
      ctx.lineTo(r, 0)
      ctx.moveTo(0, -r)
      ctx.lineTo(0, r)
      ctx.stroke()
      break
    case 'cross':
      ctx.moveTo(-r * 0.8, -r * 0.8)
      ctx.lineTo(r * 0.8, r * 0.8)
      ctx.moveTo(r * 0.8, -r * 0.8)
      ctx.lineTo(-r * 0.8, r * 0.8)
      ctx.stroke()
      break
    case 'star':
      for (let k = 0; k < 10; k++) {
        const a = -Math.PI / 2 + (k * Math.PI) / 5
        const rr = k % 2 ? r * 0.45 : r
        ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr)
      }
      ctx.closePath()
      ctx.fill()
      break
    case 'bars':
      ctx.moveTo(-r * 0.5, -r)
      ctx.lineTo(-r * 0.5, r)
      ctx.moveTo(r * 0.5, -r)
      ctx.lineTo(r * 0.5, r)
      ctx.stroke()
      break
    case 'heart':
      ctx.moveTo(0, r * 0.9)
      ctx.bezierCurveTo(-r * 1.3, -r * 0.1, -r * 0.5, -r * 1.1, 0, -r * 0.35)
      ctx.bezierCurveTo(r * 0.5, -r * 1.1, r * 1.3, -r * 0.1, 0, r * 0.9)
      ctx.fill()
      break
    case 'dots':
      for (const dx of [-0.55, 0.55]) {
        ctx.moveTo(dx * r + r * 0.32, 0)
        ctx.arc(dx * r, 0, r * 0.32, 0, Math.PI * 2)
      }
      ctx.fill()
      break
    case 'moon':
      ctx.arc(0, 0, r * 0.8, Math.PI * 0.35, Math.PI * 1.65)
      ctx.arc(r * 0.35, 0, r * 0.6, Math.PI * 1.5, Math.PI * 0.5, true)
      ctx.fill()
      break
  }
  ctx.restore()
}

// ---- The board --------------------------------------------------------------------------------
export class BoardView {
  constructor(canvas, { onTap, height = HEIGHT } = {}) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
    this.height = height
    this.board = []
    this.picked = null
    this.marks = false
    this.anim = null // the pour in progress
    this.sparks = []
    this.glow = new Map() // tube index -> time it was finished (for the flash of light)
    this.running = false
    canvas.addEventListener('pointerdown', (e) => {
      const r = canvas.getBoundingClientRect()
      const i = this.hit(e.clientX - r.left, e.clientY - r.top)
      if (i != null) onTap?.(i)
    })
    new ResizeObserver(() => this.resize()).observe(canvas)
  }

  resize() {
    const dpr = Math.min(3, window.devicePixelRatio || 1)
    const { width, height } = this.canvas.getBoundingClientRect()
    if (!width || !height) return
    this.w = width
    this.h = height
    this.canvas.width = Math.round(width * dpr)
    this.canvas.height = Math.round(height * dpr)
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    this.layout()
    this.draw()
  }

  // Where each tube stands: one row up to 6 tubes, then two rows. Room is kept at the top for
  // the ? button and the level name, and at the bottom for the tool bar.
  layout() {
    const n = this.board.length
    if (!n || !this.w) return
    const rows = n <= 6 ? 1 : 2
    const perRow = Math.ceil(n / rows)
    const side = 14
    const topPad = 50
    const bottomPad = 10
    const cell = (this.w - side * 2) / perRow
    let tw = Math.min(52, cell * 0.66)
    const room = this.h - topPad - bottomPad
    // Each row: the lift above a picked tube (0.75 layer), the tube (4.55 layers + a bit), and a gap.
    const perLayer = rows * (this.height + 1.3) + (rows - 1) * 0.9
    const layer = Math.min(tw * 0.9, (room - rows * 0.15 * tw) / perLayer)
    tw = Math.min(tw, layer / 0.7)
    this.tw = tw
    this.layerH = layer
    this.th = layer * (this.height + 0.55) + tw * 0.15
    this.lift = layer * 0.75
    const inset = Math.max(2.5, tw * 0.08)
    this.outer = tubeShape(tw, this.th)
    this.inner = tubeShape(tw - inset * 2, this.th - inset)
    // Room for HEIGHT layers inside, below the headroom.
    this.capacity = area(clip(this.inner, layer * 0.55, true))
    this.layerArea = this.capacity / this.height
    const gap = layer * 0.9
    const blockH = rows * (this.th + this.lift) + (rows - 1) * gap
    const top0 = topPad + Math.max(0, (room - blockH) / 2) + this.lift
    this.spots = []
    for (let i = 0; i < n; i++) {
      const row = rows === 1 ? 0 : i < perRow ? 0 : 1
      const inRow = row === 0 ? Math.min(perRow, n) : n - perRow
      const col = row === 0 ? i : i - perRow
      const x = (this.w - inRow * cell) / 2 + cell * (col + 0.5)
      const y = top0 + row * (this.th + this.lift + gap)
      this.spots.push({ x, y })
    }
  }

  set(board, { picked = null } = {}) {
    const relayout = board.length !== this.board.length
    this.board = board.slice()
    this.picked = picked
    if (relayout) this.layout()
    this.draw()
  }

  hit(x, y) {
    if (!this.spots) return null
    let best = null
    let bestD = Infinity
    this.spots.forEach((s, i) => {
      const dx = Math.abs(x - s.x)
      if (dx > Math.max(this.tw * 0.5 + 10, 26)) return
      if (y < s.y - this.lift - 26 || y > s.y + this.th + 18) return
      if (dx < bestD) {
        bestD = dx
        best = i
      }
    })
    return best
  }

  // Units of liquid from the bottom: [{ c, u }] (u may be fractional while pouring).
  static units(tube) {
    const out = []
    for (const c of tube) {
      if (out.length && out[out.length - 1].c === c) out[out.length - 1].u++
      else out.push({ c, u: 1 })
    }
    return out
  }

  // ---- Animation ----
  // Pours `amount` layers of colour c from tube a to b. Resolves when it's done.
  pour(a, b, amount, c, seconds) {
    return new Promise((resolve) => {
      const from = this.spots[a]
      const to = this.spots[b]
      const dir = to.x >= from.x ? 1 : -1 // tilt toward the target
      this.anim = {
        a,
        b,
        amount,
        c,
        dir,
        start: performance.now(),
        pourLen: seconds,
        resolve,
        fromBoard: this.board.slice(),
      }
      this.loop()
    })
  }

  finished(i) {
    this.glow.set(i, performance.now())
    const s = this.spots[i]
    const color = COLORS[this.board[i][0]]?.fill ?? '#fff'
    for (let k = 0; k < 26; k++) {
      const a = Math.random() * Math.PI * 2
      const v = 40 + Math.random() * 110
      this.sparks.push({
        x: s.x + (Math.random() - 0.5) * this.tw,
        y: s.y + Math.random() * this.th * 0.4,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - 80,
        life: 0.7 + Math.random() * 0.5,
        age: 0,
        color: k % 3 ? color : '#ffffff',
      })
    }
    this.loop()
  }

  loop() {
    if (this.running) return
    this.running = true
    let last = performance.now()
    const step = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      for (const p of this.sparks) {
        p.age += dt
        p.x += p.vx * dt
        p.y += p.vy * dt
        p.vy += 220 * dt
      }
      this.sparks = this.sparks.filter((p) => p.age < p.life)
      const glowing = [...this.glow.values()].some((t) => now - t < 900)
      this.draw(now)
      if (this.anim || this.sparks.length || glowing) requestAnimationFrame(step)
      else {
        this.running = false
        this.draw()
      }
    }
    requestAnimationFrame(step)
  }

  // ---- Drawing ----
  draw(now = performance.now()) {
    const ctx = this.ctx
    if (!this.w) return
    ctx.clearRect(0, 0, this.w, this.h)
    if (!this.spots) return
    const anim = this.anim
    let pose = null
    if (anim) pose = this.animPose(anim, now)
    this.board.forEach((tube, i) => {
      if (anim && i === anim.a) return // drawn last, on top
      let units = BoardView.units(tube)
      if (anim && i === anim.b) {
        units = BoardView.units(anim.fromBoard[i])
        if (pose.poured > 0) {
          const last = units[units.length - 1]
          if (last && last.c === anim.c) last.u += pose.poured
          else units.push({ c: anim.c, u: pose.poured })
        }
      }
      const s = this.spots[i]
      const lifted = i === this.picked && !anim
      this.drawTube(s.x, s.y - (lifted ? this.lift : 0), 0, units, {
        done: isComplete(tube, this.height) && !(anim && i === anim.b),
        glowAt: this.glow.get(i),
        now,
        marks: this.marks,
      })
    })
    if (anim) {
      const units = BoardView.units(anim.fromBoard[anim.a])
      const last = units[units.length - 1]
      last.u -= pose.poured
      if (last.u <= 0.001) units.pop()
      if (pose.stream) this.drawStream(pose, anim)
      this.drawTube(pose.x, pose.y, pose.angle, units, { marks: this.marks && pose.angle === 0 })
    }
    for (const p of this.sparks) {
      const k = 1 - p.age / p.life
      ctx.globalAlpha = k
      ctx.fillStyle = p.color
      ctx.beginPath()
      ctx.arc(p.x, p.y, 1.5 + 2 * k, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }

  // Where the pouring tube is at this moment.
  animPose(anim, now) {
    const t = (now - anim.start) / 1000
    const from = this.spots[anim.a]
    const to = this.spots[anim.b]
    const restY = from.y - this.lift
    // Over the target: the mouth just above and to the side of the target's mouth.
    const overX = to.x - anim.dir * (this.tw * 0.5)
    const overY = to.y - this.lift - this.tw * 0.35
    const ease = (k) => k * k * (3 - 2 * k)
    const pourEnd = MOVE + anim.pourLen
    let x
    let y
    let angle
    let poured = 0
    let stream = false
    if (t < MOVE) {
      const k = ease(t / MOVE)
      x = from.x + (overX - from.x) * k
      y = restY + (overY - restY) * k
      angle = anim.dir * TILT * k
    } else if (t < pourEnd) {
      x = overX
      y = overY
      angle = anim.dir * TILT
      poured = anim.amount * Math.min(1, (t - MOVE) / anim.pourLen)
      stream = true
    } else if (t < pourEnd + MOVE) {
      const k = ease((t - pourEnd) / MOVE)
      x = overX + (from.x - overX) * k
      y = overY + (from.y - overY) * k
      angle = anim.dir * TILT * (1 - k)
      poured = anim.amount
    } else {
      x = from.x
      y = from.y
      angle = 0
      poured = anim.amount
      this.anim = null
      queueMicrotask(anim.resolve)
    }
    return { x, y, angle, poured, stream }
  }

  drawStream(pose, anim) {
    const ctx = this.ctx
    // The lip the liquid leaves from: the mouth corner nearest the target.
    const lip = place([[anim.dir * (this.tw / 2), 0]], pose.x, pose.y, pose.angle)[0]
    const to = this.spots[anim.b]
    const units = BoardView.units(anim.fromBoard[anim.b])
    const filled = units.reduce((s, u) => s + u.u, 0) + pose.poured
    const surface = levelFor(place(this.inner, to.x, to.y, 0), filled * this.layerArea)
    ctx.strokeStyle = COLORS[anim.c].fill
    ctx.lineWidth = Math.max(3, this.tw * 0.14)
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(lip[0], lip[1])
    ctx.quadraticCurveTo(to.x, lip[1], to.x, surface)
    ctx.stroke()
  }

  drawTube(x, y, angle, units, { done = false, glowAt, now = 0, marks = false } = {}) {
    const ctx = this.ctx
    const inner = place(this.inner, x, y, angle)
    const outer = place(this.outer, x, y, angle)
    // Liquid: top layer first, each painted from its top down to the bottom, lower ones over it.
    const bounds = []
    let sum = 0
    for (const u of units) {
      const bottom = levelFor(inner, sum * this.layerArea)
      sum += u.u
      const top = levelFor(inner, sum * this.layerArea)
      bounds.push({ ...u, top, bottom })
    }
    for (let k = bounds.length - 1; k >= 0; k--) {
      const poly = clip(inner, bounds[k].top, true)
      if (poly.length < 3) continue
      pathOf(ctx, poly)
      ctx.fillStyle = COLORS[bounds[k].c].fill
      ctx.fill()
    }
    // A thin shine on the top of the liquid.
    if (bounds.length) {
      const topY = bounds[bounds.length - 1].top
      const band = clip(clip(inner, topY, true), topY + 2, false)
      if (band.length > 2) {
        pathOf(ctx, band)
        ctx.fillStyle = 'rgba(255,255,255,0.35)'
        ctx.fill()
      }
    }
    // Marks: one on every layer (upright tubes only).
    if (marks && angle === 0) {
      let level = 0
      for (const b of bounds) {
        for (let k = 0; k < Math.floor(b.u + 0.001); k++) {
          const y1 = levelFor(inner, level * this.layerArea)
          const y2 = levelFor(inner, (level + 1) * this.layerArea)
          drawMark(ctx, COLORS[b.c].mark, x, (y1 + y2) / 2 + (level === 0 ? -this.layerH * 0.08 : 0), Math.min(this.tw * 0.42, this.layerH * 0.5), COLORS[b.c].ink)
          level++
        }
      }
    }
    // The glass: a white outline (glowing in its colour when finished).
    pathOf(ctx, outer)
    ctx.lineJoin = 'round'
    ctx.lineWidth = Math.max(2, this.tw * 0.06)
    ctx.strokeStyle = OUTLINE
    if (done) {
      const c = COLORS[units[0]?.c]?.fill ?? '#fff'
      const flash = glowAt ? Math.max(0, 1 - (now - glowAt) / 900) : 0
      ctx.shadowColor = c
      ctx.shadowBlur = 10 + flash * 22
      ctx.strokeStyle = c
      ctx.stroke()
      ctx.shadowBlur = 0
      ctx.lineWidth = Math.max(1, this.tw * 0.025)
      ctx.strokeStyle = 'rgba(255,255,255,0.85)'
    }
    ctx.stroke()
    // The lip of the mouth.
    const lip = place(
      [
        [-this.tw / 2 - 3, 0],
        [this.tw / 2 + 3, 0],
      ],
      x,
      y,
      angle,
    )
    ctx.beginPath()
    ctx.moveTo(...lip[0])
    ctx.lineTo(...lip[1])
    ctx.lineCap = 'round'
    ctx.stroke()
  }
}

// A small picture of a board, for the Levels page.
export function drawMini(canvas, board, height = HEIGHT) {
  const dpr = Math.min(3, window.devicePixelRatio || 1)
  const { width, height: h } = canvas.getBoundingClientRect()
  canvas.width = Math.round(width * dpr)
  canvas.height = Math.round(h * dpr)
  const ctx = canvas.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, h)
  const n = board.length
  const rows = n <= 6 ? 1 : 2
  const perRow = Math.ceil(n / rows)
  const cell = width / perRow
  const tw = Math.min(cell * 0.62, 12)
  const lh = Math.min((h / rows - 6) / (height + 0.6), tw * 1.1)
  board.forEach((tube, i) => {
    const row = i < perRow ? 0 : 1
    const inRow = row === 0 ? Math.min(perRow, n) : n - perRow
    const col = row === 0 ? i : i - perRow
    const x = (width - inRow * cell) / 2 + cell * (col + 0.5)
    const y0 = (h - rows * (lh * (height + 0.6) + 4)) / 2 + row * (lh * (height + 0.6) + 4)
    const bottom = y0 + lh * (height + 0.6)
    for (let k = 0; k < tube.length; k++) {
      ctx.fillStyle = COLORS[tube[k]].fill
      ctx.fillRect(x - tw / 2 + 1, bottom - (k + 1) * lh, tw - 2, lh)
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'
    ctx.lineWidth = 1
    ctx.strokeRect(x - tw / 2 + 0.5, y0 + 0.5, tw - 1, lh * (height + 0.6) - 1)
  })
}
