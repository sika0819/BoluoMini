// CustomSRP EqualizerBars. Bars stay in the 108 design; the host only scales the widget.
// Side bars are white, the center bar is #A6FF00. Caps are full circles of radius 6.

const BAR_W = 12
const BASELINE = 26.5 * 3
const BARS = [
  { cx: 11.33 * 3, min: BAR_W, max: 32, speed: 5.2, phase: 0.4, color: '#ffffff' },
  { cx: 18 * 3, min: 14, max: 48, speed: 6.7, phase: 1.8, color: '#A6FF00' },
  { cx: 24.6633 * 3, min: BAR_W, max: 40, speed: 4.4, phase: 3.1, color: '#ffffff' },
]

export function drawEqualizer(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  seconds: number,
): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(size / 108, size / 108)
  for (const bar of BARS) {
    const wave = 0.5 + 0.5 * Math.sin(seconds * bar.speed + bar.phase)
    const h = Math.max(BAR_W, bar.min + (bar.max - bar.min) * wave)
    const left = bar.cx - BAR_W * 0.5
    const top = BASELINE - bar.max
    ctx.fillStyle = bar.color
    ctx.beginPath()
    ctx.arc(left + 6, top + bar.max - 6, 6, 0, Math.PI * 2)
    ctx.fill()
    const stemTop = top + (bar.max - h) + 6
    const stemBottom = top + bar.max - 6
    if (stemBottom > stemTop) ctx.fillRect(left, stemTop, BAR_W, stemBottom - stemTop)
    ctx.beginPath()
    ctx.arc(left + 6, top + (bar.max - h) + 6, 6, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}
