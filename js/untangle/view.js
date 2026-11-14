// Untangle drawing: Three.js scene for the ropes, pegs, beam and rail. The physics lives in
// ropes.js; this only reads the rope points each frame and draws smooth tubes through them.
import * as THREE from '/shared/vendor/three-0.147.0/three.module.js'
import { RADIUS, POINTS } from './ropes.js'

export const COLORS = [0xe8453c, 0x2f7de1, 0xf2b705, 0x3bb273, 0x9b5de5, 0xff7f11, 0x16b7c4, 0xf15bb5]
const SMOOTH = 3 // drawn points between two physics points
const SIDES = 10
const NIGHT_LIGHT = 0xffa046 // the warm filter colour, as light: same as multiplying the colours

export class View {
  constructor(container) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.outputEncoding = THREE.sRGBEncoding
    container.appendChild(this.renderer.domElement)
    this.canvas = this.renderer.domElement
    this.scene = new THREE.Scene()
    this.camera = new THREE.OrthographicCamera(0, 1, 0, -1, 1, 2000)
    this.camera.position.z = 800
    this.hemi = new THREE.HemisphereLight(0xfff6e6, 0x5a4a3a, 0.75)
    this.sun = new THREE.DirectionalLight(0xffffff, 0.75)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(2048, 2048)
    this.sun.shadow.radius = 4
    this.scene.add(this.hemi, this.sun, this.sun.target)
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.28 }))
    this.shadow.receiveShadow = true
    this.scene.add(this.shadow)
    this.twist = makeTwist()
    this.wood = new THREE.MeshStandardMaterial({ color: 0x6e4224, roughness: 0.8 })
    this.brass = new THREE.MeshStandardMaterial({ color: 0xd4a84a, roughness: 0.35, metalness: 0.6 })
    this.holeMat = new THREE.MeshBasicMaterial({ color: 0x1e120a })
    this.ring = new THREE.Mesh(new THREE.RingGeometry(15, 22, 40), new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true }))
    this.ring.visible = false
    this.group = null
  }

  setNight(night) {
    this.hemi.color.set(night ? NIGHT_LIGHT : 0xfff6e6)
    this.hemi.intensity = night ? 0.55 : 0.75
    this.sun.color.set(night ? NIGHT_LIGHT : 0xffffff)
    this.sun.intensity = night ? 0.6 : 0.75
    this.shadow.material.opacity = night ? 0.4 : 0.28
  }

  resize(W, H) {
    this.W = W
    this.H = H
    this.renderer.setSize(W, H)
    Object.assign(this.camera, { left: 0, right: W, top: 0, bottom: -H })
    this.camera.updateProjectionMatrix()
    this.sun.position.set(W / 2 - 160, -H / 2 + 220, 520)
    this.sun.target.position.set(W / 2, -H / 2, 0)
    Object.assign(this.sun.shadow.camera, { left: -W, right: W, top: H, bottom: -H, near: 1, far: 1600 })
    this.sun.shadow.camera.updateProjectionMatrix()
    this.shadow.scale.set(W * 2, H * 2, 1)
    this.shadow.position.set(W / 2, -H / 2, -30) // a little behind the ropes, so shadows show depth
  }

  /** Build the board: L = layout (topX, holeX, yTop, yHole, holes, pegR), ropes = ids. */
  build(L, ropeIds) {
    if (this.group) {
      this.scene.remove(this.group)
      this.group.traverse((m) => m.geometry?.dispose())
    }
    const g = new THREE.Group()
    const beam = new THREE.Mesh(new THREE.BoxGeometry(this.W - 28, 22, 24), this.wood)
    beam.position.set(this.W / 2, -(L.yTop - 6), -12)
    beam.castShadow = true
    const rail = new THREE.Mesh(new THREE.BoxGeometry(this.W - 20, 54, 24), this.wood)
    rail.position.set(this.W / 2, -L.yHole, -12)
    g.add(beam, rail)
    ropeIds.forEach((_, o) => {
      const knob = new THREE.Mesh(new THREE.SphereGeometry(8, 20, 14), this.brass)
      knob.position.set(L.topX(o), -L.yTop, RADIUS)
      knob.castShadow = true
      g.add(knob)
    })
    for (let h = 0; h < L.holes; h++) {
      const hole = new THREE.Mesh(new THREE.CircleGeometry(L.pegR + 2, 32), this.holeMat)
      hole.position.set(L.holeX(h), -L.yHole, 0.5)
      g.add(hole)
    }
    this.ring.geometry.dispose()
    this.ring.geometry = new THREE.RingGeometry(L.pegR + 3, L.pegR + 9, 40)
    this.ring.position.z = 0.8
    g.add(this.ring)
    this.ropes = new Map()
    for (const id of ropeIds) {
      const mat = new THREE.MeshStandardMaterial({ color: COLORS[id], map: this.twist, roughness: 0.62, emissive: COLORS[id], emissiveIntensity: 0 })
      const mesh = new THREE.Mesh(tubeGeometry(), mat)
      mesh.castShadow = true
      mesh.frustumCulled = false
      const peg = new THREE.Group()
      const body = new THREE.Mesh(new THREE.CylinderGeometry(L.pegR, L.pegR + 2, 16, 24), this.wood)
      body.rotation.x = Math.PI / 2
      const cap = new THREE.Mesh(new THREE.SphereGeometry(L.pegR - 2, 24, 16), new THREE.MeshStandardMaterial({ color: COLORS[id], roughness: 0.4 }))
      cap.position.z = 9
      peg.add(body, cap)
      peg.traverse((m) => (m.castShadow = true))
      g.add(mesh, peg)
      this.ropes.set(id, { mesh, peg, glow: 0 })
    }
    this.scene.add(g)
    this.group = g
  }

  /** Show which hole would take the peg (or none). */
  showHole(x, y) {
    this.ring.visible = x != null
    if (x != null) this.ring.position.set(x, -y, 0.8)
  }

  glow(id, on = 1) {
    const r = this.ropes.get(id)
    if (r) r.glow = on
  }

  /** Draw: world = RopeWorld; lifted = id of the rope being carried; done = all free. */
  draw(world, { moved, done }) {
    for (const rope of world.ropes) {
      const v = this.ropes.get(rope.id)
      if (!v) continue
      if (moved) updateTube(v.mesh.geometry, rope.pos)
      const e = (POINTS - 1) * 3
      v.peg.position.set(rope.pos[e], rope.pos[e + 1], rope.pos[e + 2] - RADIUS + 2)
      if (v.glow > 0.01) v.glow *= 0.97
      v.mesh.material.emissiveIntensity = (done ? 0.3 : 0) + v.glow * 0.55
    }
    if (this.ring.visible) this.ring.material.opacity = 0.75 + 0.25 * Math.sin(performance.now() / 140)
    this.renderer.render(this.scene, this.camera)
  }
}

// A rope's twist: soft diagonal bands, multiplied by the rope's colour.
function makeTwist() {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')
  g.fillStyle = '#fff'
  g.fillRect(0, 0, 64, 64)
  g.strokeStyle = 'rgba(0,0,0,0.22)'
  g.lineWidth = 9
  for (let x = -64; x <= 128; x += 21) {
    g.beginPath()
    g.moveTo(x, 0)
    g.lineTo(x + 64, 64)
    g.stroke()
  }
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(40, 1)
  t.encoding = THREE.sRGBEncoding
  return t
}

// ---------- a tube whose shape is rewritten in place each frame (no new objects) ----------
const RINGS = (POINTS - 1) * SMOOTH + 1

function tubeGeometry() {
  const geo = new THREE.BufferGeometry()
  const verts = RINGS * (SIDES + 1)
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts * 3), 3))
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(verts * 3), 3))
  const uv = new Float32Array(verts * 2)
  for (let i = 0; i < RINGS; i++) {
    for (let s = 0; s <= SIDES; s++) {
      uv[(i * (SIDES + 1) + s) * 2] = i / (RINGS - 1)
      uv[(i * (SIDES + 1) + s) * 2 + 1] = s / SIDES
    }
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  const idx = []
  for (let i = 0; i + 1 < RINGS; i++) {
    for (let s = 0; s < SIDES; s++) {
      const a = i * (SIDES + 1) + s
      const b = a + SIDES + 1
      idx.push(a, a + 1, b, b, a + 1, b + 1)
    }
  }
  geo.setIndex(idx)
  return geo
}

const pts = new Float64Array(RINGS * 3)
function updateTube(geo, P) {
  // Smooth curve through the physics points (Catmull-Rom).
  const n = POINTS
  const at = (i, k) => P[Math.max(0, Math.min(n - 1, i)) * 3 + k]
  for (let i = 0; i < n - 1; i++) {
    for (let s = 0; s < SMOOTH; s++) {
      const t = s / SMOOTH
      const t2 = t * t
      const t3 = t2 * t
      for (let k = 0; k < 3; k++) {
        const p0 = at(i - 1, k)
        const p1 = at(i, k)
        const p2 = at(i + 1, k)
        const p3 = at(i + 2, k)
        pts[(i * SMOOTH + s) * 3 + k] = 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
      }
    }
  }
  for (let k = 0; k < 3; k++) pts[(RINGS - 1) * 3 + k] = P[(n - 1) * 3 + k]
  const pos = geo.attributes.position.array
  const nor = geo.attributes.normal.array
  // Frames carried along the rope (parallel transport), so the tube never twists suddenly.
  let nx = 0
  let ny = 0
  let nz = 1
  for (let i = 0; i < RINGS; i++) {
    const a = Math.max(0, i - 1)
    const b = Math.min(RINGS - 1, i + 1)
    let tx = pts[b * 3] - pts[a * 3]
    let ty = pts[b * 3 + 1] - pts[a * 3 + 1]
    let tz = pts[b * 3 + 2] - pts[a * 3 + 2]
    const tl = Math.hypot(tx, ty, tz) || 1
    tx /= tl
    ty /= tl
    tz /= tl
    // Keep the normal at right angles to the direction.
    const d = nx * tx + ny * ty + nz * tz
    nx -= d * tx
    ny -= d * ty
    nz -= d * tz
    let nl = Math.hypot(nx, ny, nz)
    if (nl < 1e-4) {
      ;[nx, ny, nz] = Math.abs(tx) < 0.9 ? [0, -tz, ty] : [tz, 0, -tx]
      nl = Math.hypot(nx, ny, nz)
    }
    nx /= nl
    ny /= nl
    nz /= nl
    const bx = ty * nz - tz * ny
    const by = tz * nx - tx * nz
    const bz = tx * ny - ty * nx
    for (let s = 0; s <= SIDES; s++) {
      const ang = (s / SIDES) * Math.PI * 2
      const c = Math.cos(ang)
      const sn = Math.sin(ang)
      const ox = nx * c + bx * sn
      const oy = ny * c + by * sn
      const oz = nz * c + bz * sn
      const v = (i * (SIDES + 1) + s) * 3
      pos[v] = pts[i * 3] + ox * RADIUS
      pos[v + 1] = pts[i * 3 + 1] + oy * RADIUS
      pos[v + 2] = pts[i * 3 + 2] + oz * RADIUS
      nor[v] = ox
      nor[v + 1] = oy
      nor[v + 2] = oz
    }
  }
  geo.attributes.position.needsUpdate = true
  geo.attributes.normal.needsUpdate = true
}
