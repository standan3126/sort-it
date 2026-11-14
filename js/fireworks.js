// Little fireworks over the screen when a level is done. Soft: no flash of the whole screen, the
// sparks just glow and fade. show() runs a few bursts, then stops by itself.
const PALETTE = ['#ff2d3d', '#ff8a00', '#ffe100', '#7dff1a', '#00e5ff', '#2f6bff', '#9b3dff', '#ff2fd0', '#ffffff']

export class Fireworks {
  constructor(canvas, { onBurst } = {}) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
    this.onBurst = onBurst
    this.parts = []
    this.rockets = []
    this.timers = []
    this.running = false
  }

  size() {
    const dpr = Math.min(3, window.devicePixelRatio || 1)
    const { width, height } = this.canvas.getBoundingClientRect()
    this.w = width
    this.h = height
    this.canvas.width = Math.round(width * dpr)
    this.canvas.height = Math.round(height * dpr)
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  show(count = 6) {
    this.stop()
    this.size()
    this.pending = count
    for (let k = 0; k < count; k++)
      this.timers.push(
        setTimeout(() => {
          this.pending--
          this.launch()
        }, 150 + k * 420 + Math.random() * 200),
      )
    this.run()
  }

  stop() {
    this.timers.forEach(clearTimeout)
    this.timers = []
    this.pending = 0
    this.parts = []
    this.rockets = []
    this.ctx.clearRect(0, 0, this.w || 0, this.h || 0)
  }

  launch() {
    const x = this.w * (0.2 + Math.random() * 0.6)
    const y = this.h * (0.14 + Math.random() * 0.26)
    this.rockets.push({ x, y: this.h + 10, tx: x, ty: y, vy: -(this.h - y) / 0.6 })
    this.run()
  }

  burst(x, y) {
    this.onBurst?.()
    const color = PALETTE[Math.floor(Math.random() * PALETTE.length)]
    const second = PALETTE[Math.floor(Math.random() * PALETTE.length)]
    const n = 46
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + Math.random() * 0.1
      const v = 70 + Math.random() * 90
      this.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, age: 0, life: 1.1 + Math.random() * 0.6, color: k % 4 ? color : second })
    }
  }

  run() {
    if (this.running) return
    this.running = true
    let last = performance.now()
    const step = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const ctx = this.ctx
      ctx.clearRect(0, 0, this.w, this.h)
      for (const r of this.rockets) {
        r.y += r.vy * dt
        ctx.fillStyle = 'rgba(255,240,200,0.9)'
        ctx.beginPath()
        ctx.arc(r.x, r.y, 2, 0, Math.PI * 2)
        ctx.fill()
        if (r.y <= r.ty) {
          r.done = true
          this.burst(r.x, r.ty)
        }
      }
      this.rockets = this.rockets.filter((r) => !r.done)
      for (const p of this.parts) {
        p.age += dt
        p.vx *= 1 - 1.6 * dt
        p.vy = p.vy * (1 - 1.6 * dt) + 60 * dt
        p.x += p.vx * dt
        p.y += p.vy * dt
        const k = Math.max(0, 1 - p.age / p.life)
        ctx.globalAlpha = k
        ctx.fillStyle = p.color
        ctx.beginPath()
        ctx.arc(p.x, p.y, 1.2 + 1.6 * k, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1
      this.parts = this.parts.filter((p) => p.age < p.life)
      if (this.parts.length || this.rockets.length || this.pending > 0) requestAnimationFrame(step)
      else this.running = false
    }
    requestAnimationFrame(step)
  }
}
