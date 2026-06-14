// Desktop-pet renderer (plain JS). A trimmed port of clawd-on-desk's
// renderer.js: it shows one <img> and swaps its src when main pushes a new
// state. clawd's mini-mode / low-power / sound / eye-tracking / scripted-SVG
// channels are intentionally dropped — every Clawd svg animates via CSS
// @keyframes, so a plain <img> renders the animation with no scripting.

const cfg = window.petConfig || { svgBaseUrl: '' }
const SVG_BASE = (cfg.svgBaseUrl || '').replace(/\/$/, '')
const api = window.pet || {}

const container = document.getElementById('pet-container')
const img = document.getElementById('clawd')

let currentFile = null
let currentState = 'idle'

function urlFor(file) {
  return `${SVG_BASE}/${file}`
}

/** Swap the displayed svg with a short opacity crossfade. */
function setSvg(file) {
  if (!file || file === currentFile) return
  currentFile = file
  img.classList.add('swapping')
  // Load into a detached image first so the fade reveals a ready frame.
  const next = new Image()
  next.onload = () => {
    img.src = next.src
    requestAnimationFrame(() => img.classList.remove('swapping'))
  }
  next.onerror = () => {
    // Show it anyway; better a broken frame than a stuck pet.
    img.src = urlFor(file)
    img.classList.remove('swapping')
  }
  next.src = urlFor(file)
}

if (typeof api.onState === 'function') {
  api.onState((state, file) => {
    currentState = state
    setSvg(file)
  })
}

// Initial frame so the window isn't blank before the first state arrives.
setSvg('clawd-idle-follow.svg')

// ── Drag (pointer capture → main recomputes window position from cursor) ──
let dragging = false
let moveScheduled = false

container.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return
  dragging = true
  container.classList.add('dragging')
  try {
    container.setPointerCapture(e.pointerId)
  } catch {
    /* ignore */
  }
  if (typeof api.dragStart === 'function') api.dragStart()
})

container.addEventListener('pointermove', () => {
  if (!dragging || moveScheduled) return
  moveScheduled = true
  requestAnimationFrame(() => {
    moveScheduled = false
    if (dragging && typeof api.dragMove === 'function') api.dragMove()
  })
})

function endDrag(e) {
  if (!dragging) return
  dragging = false
  container.classList.remove('dragging')
  try {
    if (e && e.pointerId != null) container.releasePointerCapture(e.pointerId)
  } catch {
    /* ignore */
  }
  if (typeof api.dragEnd === 'function') api.dragEnd()
}

container.addEventListener('pointerup', endDrag)
container.addEventListener('pointercancel', endDrag)

// ── Click reactions ──
document.addEventListener('dblclick', () => {
  if (dragging) return
  const restore = currentFile
  setSvg('clawd-react-double.svg')
  setTimeout(() => setSvg(restore || 'clawd-idle-follow.svg'), 1600)
})

// ── Click-through hit-test ──
// The window is created click-through (setIgnoreMouseEvents true+forward), so
// mousemove still reaches us. When the cursor is over the pet's body region we
// ask main to make the window interactive (grabbable); otherwise clicks pass
// through to whatever is underneath. Region is a centred box tuned to where the
// Clawd body sits inside the 220px window.
let interactive = false
const BODY = { x0: 0.18, x1: 0.82, y0: 0.28, y1: 0.96 }

function updateInteractive(clientX, clientY) {
  if (dragging) return
  const w = window.innerWidth
  const h = window.innerHeight
  const fx = clientX / w
  const fy = clientY / h
  const inside = fx >= BODY.x0 && fx <= BODY.x1 && fy >= BODY.y0 && fy <= BODY.y1
  if (inside !== interactive) {
    interactive = inside
    if (typeof api.setInteractive === 'function') api.setInteractive(inside)
  }
}

window.addEventListener('mousemove', (e) => updateInteractive(e.clientX, e.clientY))
window.addEventListener('mouseleave', () => {
  if (dragging) return
  if (interactive) {
    interactive = false
    if (typeof api.setInteractive === 'function') api.setInteractive(false)
  }
})
