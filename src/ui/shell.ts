import type { DownloadSnapshot } from '../game/download'
import { drawEqualizer } from './equalizer'
import {
  drawHudSvg,
  fogSvg,
  hudSvgRev,
  profileSvg,
  rainSvg,
  timeSvgFor,
  warmHudSvg,
  weatherSvg,
  windSvg,
} from './hudSvg'
import { Menus } from './menus'

export const STAGE_W = 1125
export const STAGE_H = 2436

const DEAD = 14
const RING = 444
const KNOB = 180
const MAX_DRAG = Math.max(DEAD + 1, RING * 0.5 * 0.878 - KNOB * 0.5 - 18)

export interface UiInput {
  now: number
  loading: boolean
  progress: number
  presetId: string
  presetLabel: string
  weather: 'clear' | 'cloud' | 'rain' | 'fog' | 'wind'
  weatherLevel: number
  music: number
  fx: number
  trackName: string
  playing: boolean
  timerLeft: number
  timerRunning: boolean
  period: number
  panelW: number
  panelH: number
  handDeg: number
  /** 实时天气开关。手动改时间或天气后为关。 */
  live: boolean
  scoreText: string
  phaseText: string
  idleAlpha: number
  iris: number
  joystick: { x: number; y: number; active: boolean }
  banks: DownloadSnapshot
  loggedIn: boolean
  capsulePad: number
}

export type UiAction =
  | { type: 'look'; dx: number; dy: number }
  | { type: 'move'; x: number; y: number }
  | { type: 'weather'; kind: UiInput['weather']; level: number }
  | { type: 'preset'; id: string }
  | { type: 'volume'; music: number; fx: number }
  | { type: 'play'; name: string }
  | { type: 'download'; names: string[]; quiet?: boolean }
  | { type: 'confirm-download'; kind: 'cellular' | 'wifi' | 'storage-retry' }
  | { type: 'cancel-download' }
  | { type: 'dismiss-download' }
  | { type: 'timer-start'; seconds: number }
  | { type: 'timer-cancel' }
  | { type: 'timer-repeat' }
  | { type: 'timer-dismiss' }
  | { type: 'logout' }
  | { type: 'save' }
  | { type: 'agree' }
  | { type: 'cancel-account' }
  | { type: 'activity' }
  | { type: 'resume' }
  | { type: 'tier' }
  | { type: 'period' }
  | { type: 'live'; on: boolean }

interface Hit {
  x: number
  y: number
  w: number
  h: number
  id: string
  on: (ui: Shell) => UiAction | null
}

interface Joy {
  id: number
  ox: number
  oy: number
  dx: number
  dy: number
  live: boolean
}

export class Shell {
  private readonly menus = new Menus()
  private hits: Hit[] = []
  private agreed = false
  private covered = false
  private needResume = false
  private downId = -1
  private downHit = ''
  private downX = 0
  private downY = 0
  private moved = 0
  private pointers = new Set<number>()
  private joyGate = false
  private joy: Joy | null = null
  private toastAt = -1
  private toastText = ''
  private captionAt = -1
  private caption = ''
  private lastPreset = ''
  private hudShown = 1
  private lastNow = 0
  private pw = STAGE_W
  private ph = STAGE_H
  private paintSig = ''
  private paintBuf = ''
  private hudWarm = false

  constructor(agreed = false, private readonly profileEntry = true) {
    this.agreed = agreed
    if (!this.agreed) {
      try { this.agreed = localStorage.getItem('boluo.agree') === '1' } catch { this.agreed = false }
    }
  }

  pointer(phase: 'down' | 'move' | 'up', x: number, y: number, id: number): UiAction | null {
    if (this.covered) return null
    this.menus.forceAgreement = !this.agreed
    const menu = this.menus.pointer(phase, x, y, id)
    const action = menu.consumed ? menu.action : this.world(phase, x, y, id)
    return this.finish(action, phase)
  }

  draw(ctx: CanvasRenderingContext2D, input: UiInput): boolean {
    const dt = this.lastNow ? Math.min(0.05, (input.now - this.lastNow) / 1000) : 0
    this.lastNow = input.now
    this.menus.sync(input)
    this.menus.forceAgreement = !this.agreed
    if (!this.lastPreset) this.lastPreset = input.presetId
    else if (input.presetId !== this.lastPreset) {
      this.lastPreset = input.presetId
      this.caption = input.presetLabel
      this.captionAt = input.now
      this.toastAt = -1
    }
    const shownTarget = 1 - input.idleAlpha
    if (shownTarget > this.hudShown) this.hudShown = Math.min(shownTarget, this.hudShown + dt / 0.35)
    else this.hudShown = shownTarget

    const toastA = this.toastAlpha(input.now)
    const captionA = toastA > 0 ? 0 : this.captionAlpha(input.now)
    const moving = !!this.joy || input.playing || input.loading || input.iris > 0.001
      || toastA > 0 || captionA > 0
      || Math.abs(this.hudShown - shownTarget) > 0.01
      || this.menus.animating
    const breathStep = this.hudShown < 0.2 ? Math.floor(input.now / 120) : ''
    this.warmHud()
    const sig = [
      input.loading ? `${input.progress.toFixed(2)}:${art('/ui/ref/loading-track.png') ? 1 : 0}${art('/ui/ref/loading-fill.png') ? 1 : 0}` : '',
      input.presetId, input.weather, input.weatherLevel,
      input.music.toFixed(2), input.fx.toFixed(2),
      input.playing ? input.trackName : '',
      input.timerRunning ? Math.ceil(input.timerLeft) : '',
      input.period, Math.round(input.handDeg),
      input.scoreText, input.phaseText,
      Math.round(input.panelW), Math.round(input.panelH),
      this.hudShown.toFixed(2), input.iris.toFixed(2),
      this.joy ? 'j' : '', this.toastText, this.caption, this.agreed ? 1 : 0,
      breathStep, this.menus.paintKey(), artRev, hudSvgRev(),
    ].join('|')
    const buf = `${ctx.canvas.width}x${ctx.canvas.height}`
    if (!moving && sig === this.paintSig && buf === this.paintBuf) return false
    this.paintSig = sig
    this.paintBuf = buf

    this.hits = []
    this.covered = input.loading
    this.pw = input.panelW || STAGE_W
    this.ph = input.panelH || STAGE_H
    ctx.clearRect(0, 0, this.pw, this.ph)
    if (input.loading) {
      this.loading(ctx, input.progress)
      return true
    }
    if (toastA > 0 || captionA > 0) this.veil(ctx, Math.max(toastA, captionA))
    ctx.save()
    ctx.globalAlpha = this.hudShown
    this.hud(ctx, input)
    ctx.restore()
    this.scoreHud(ctx, input)
    if (toastA > 0) this.banner(ctx, this.toastText, toastA)
    if (captionA > 0) this.banner(ctx, this.caption, captionA)
    if (this.hudShown < 0.2) this.breath(ctx, input.now)
    this.stick(ctx)
    this.menus.draw(ctx)
    if (input.iris > 0) {
      ctx.fillStyle = `rgba(0,0,0,${input.iris})`
      ctx.fillRect(0, 0, this.pw, this.ph)
    }
    return true
  }

  toast(text: string): void { this.menus.toast(text) }
  openSave(): void { this.menus.openDialog('save') }
  openCancelAccount(): void { this.menus.openDialog('cancel-account') }
  openPauseTip(): void {
    this.needResume = true
    this.menus.toast('波萝被暂停，滑动屏幕恢复', 5000)
  }

  private finish(action: UiAction | null, phase: 'down' | 'move' | 'up'): UiAction | null {
    if (action?.type === 'agree') {
      this.agreed = true
      try { localStorage.setItem('boluo.agree', '1') } catch { /* host storage mirrors this */ }
    }
    if (this.needResume && phase === 'down') {
      this.needResume = false
      return action ?? { type: 'resume' }
    }
    if (!action && phase === 'down') return { type: 'activity' }
    return action
  }

  private world(phase: 'down' | 'move' | 'up', x: number, y: number, id: number): UiAction | null {
    if (phase === 'down') {
      this.pointers.add(id)
      if (this.pointers.size >= 2) {
        this.joyGate = true
        this.joy = null
        return { type: 'move', x: 0, y: 0 }
      }
      this.downId = id
      this.downX = x
      this.downY = y
      this.moved = 0
      const hit = this.top(x, y)
      this.downHit = hit?.id ?? ''
      if (!hit && !this.joyGate && !this.menus.blocksMove) {
        this.joy = { id, ox: x, oy: y, dx: 0, dy: 0, live: false }
      }
      return null
    }
    if (phase === 'move' && this.joy && id === this.joy.id && !this.joyGate) {
      const dx = x - this.joy.ox
      const dy = y - this.joy.oy
      const mag = Math.hypot(dx, dy)
      if (mag < DEAD) {
        this.joy.live = false
        this.joy.dx = 0
        this.joy.dy = 0
        return { type: 'move', x: 0, y: 0 }
      }
      this.joy.live = true
      const clamped = Math.min(mag, MAX_DRAG)
      const ux = dx / (mag || 1)
      const uy = dy / (mag || 1)
      this.joy.dx = ux * clamped
      this.joy.dy = uy * clamped
      const speed = Math.max(0, Math.min(1, (clamped - DEAD) / (MAX_DRAG - DEAD)))
      return { type: 'move', x: ux * speed, y: -uy * speed }
    }
    if (phase === 'move' && id === this.downId) {
      this.moved += Math.hypot(x - this.downX, y - this.downY)
      this.downX = x
      this.downY = y
      return null
    }
    if (phase === 'up') {
      this.pointers.delete(id)
      if (this.pointers.size === 0) this.joyGate = false
      if (this.joy && id === this.joy.id) {
        this.joy = null
        return { type: 'move', x: 0, y: 0 }
      }
      if (id === this.downId) {
        const hit = this.top(x, y)
        const click = this.moved < 10 && hit && hit.id === this.downHit
        this.downId = -1
        if (click && hit) return hit.on(this)
      }
    }
    return null
  }

  private top(x: number, y: number): Hit | undefined {
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i]
      if (x >= h.x && y >= h.y && x <= h.x + h.w && y <= h.y + h.h) return h
    }
    return undefined
  }

  private hit(x: number, y: number, w: number, h: number, id: string, on: Hit['on']): void {
    this.hits.push({ x, y, w, h, id, on })
  }

  private glyph(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    size: number,
    key: string,
    svg: string,
    id: string,
    on: Hit['on'],
  ): void {
    const x = cx - size / 2
    const y = cy - size / 2
    drawHudSvg(ctx, key, svg, x, y, size, size)
    this.hit(x, y, size, size, id, on)
  }

  private hud(ctx: CanvasRenderingContext2D, input: UiInput): void {
    const left = 102
    const top = 228
    const gap = 156
    const size = 108
    const right = this.pw - 102 - input.capsulePad
    const names = ['清晨', '正午', '黄昏', '夜晚']
    const period = ((input.period % 4) + 4) % 4
    const hand = Number.isFinite(input.handDeg) ? input.handDeg : period * 90
    const onTime = (ui: Shell) => {
      const next = (period + 1) % 4
      ui.toastText = names[next]
      ui.toastAt = input.now
      ui.captionAt = -1
      return { type: 'period' as const }
    }
    if (art('/ui/time/color-swatch.png') && art('/ui/time/hand.png')) {
      this.plate(ctx, left, top, size)
      this.timeHand(ctx, left, top, size, hand)
      this.hit(left - size / 2, top - size / 2, size, size, 'time', onTime)
    } else {
      this.glyph(ctx, left, top, size, 'time-' + Math.round(hand), timeSvgFor(hand), 'time', onTime)
    }
    const weather = weatherArt(input.weather, input.weatherLevel)
    const icon = art(weather)
    const glyph = weatherGlyph(input.weather, input.weatherLevel)
    if (icon) {
      this.plate(ctx, left, top + gap, size)
      ctx.drawImage(icon, left - size / 2, top + gap - size / 2, size, size)
    } else {
      drawHudSvg(ctx, glyph.key, glyph.svg, left - size / 2, top + gap - size / 2, size, size)
    }
    this.hit(left - size / 2, top + gap - size / 2, size, size, 'weather', (ui) => {
      ui.menus.open('weather')
      return null
    })
    this.musicIcon(ctx, left, top + gap * 2, size, input.playing, input.now)
    this.volumeIcon(ctx, left, top + gap * 3, size, input.music, input.fx)
    if (this.profileEntry) {
      this.glyph(ctx, right, top, size, 'profile', profileSvg, 'profile', (ui) => {
        ui.menus.open('profile')
        return null
      })
    }
    this.timerIcon(ctx, right, top + gap, size, input.timerRunning, input.timerLeft)
  }

  private scoreHud(ctx: CanvasRenderingContext2D, input: UiInput): void {
    if (!input.scoreText && !input.phaseText) return
    const x = this.pw * 0.5
    ctx.save()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = 'rgba(0,0,0,0.45)'
    ctx.fillStyle = '#fff'
    ctx.lineWidth = 14
    ctx.font = '700 84px "PingFang SC","PingFangSC-Semibold","Hiragino Sans GB",sans-serif'
    ctx.strokeText(input.scoreText, x, 300)
    ctx.fillText(input.scoreText, x, 300)
    ctx.lineWidth = 10
    ctx.font = '600 46px "PingFang SC","PingFangSC-Semibold","Hiragino Sans GB",sans-serif'
    ctx.strokeText(input.phaseText, x, 390)
    ctx.fillText(input.phaseText, x, 390)
    ctx.restore()
  }

  private plate(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
    ctx.beginPath()
    ctx.arc(cx, cy, size / 2, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(0,0,0,0.1)'
    ctx.fill()
  }

  private timeHand(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, degrees: number): void {
    const swatch = art('/ui/time/color-swatch.png')
    const hand = art('/ui/time/hand.png')
    if (!swatch || !hand) return
    const s = size / 108
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(degrees * Math.PI / 180)
    ctx.scale(s, s)
    ctx.translate(-54, -54)
    ctx.drawImage(swatch, 6.35, 23.4, 25.22, 61.1)
    ctx.drawImage(hand, 15.88, 41.29, 50.82, 25.41)
    ctx.restore()
  }

  private volumeIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, music: number, fx: number): void {
    const x = cx - size / 2
    const y = cy - size / 2
    this.plate(ctx, cx, cy, size)
    const track = art('/ui/ref/volume-track.png')
    if (track) ctx.drawImage(track, x, y, size, size)
    const unit = size / 108
    // Track 1 is music, track 2 is effects. Dots travel 24→62 across the 60px bar.
    this.volumeMark(ctx, x, y, unit, music, 33, 28)
    this.volumeMark(ctx, x, y, unit, fx, 63, 58)
    this.hit(x, y, size, size, 'volume', (ui) => {
      ui.menus.open('volume')
      return null
    })
  }

  private volumeMark(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    unit: number,
    value: number,
    trackTop: number,
    dotTop: number,
  ): void {
    const amount = Math.max(0, Math.min(1, value))
    const full = 60 * unit
    if (amount > 0.001) {
      sliceBar(ctx, '/ui/ref/volume-fill.png', x + 24 * unit, y + trackTop * unit, full * amount, 12 * unit)
    }
    const dot = art('/ui/ref/volume-dot.png')
    if (dot) ctx.drawImage(dot, x + 24 * unit + full * (38 / 60) * amount, y + dotTop * unit, 22 * unit, 22 * unit)
  }

  private musicIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, playing: boolean, now: number): void {
    const x = cx - size / 2
    const y = cy - size / 2
    this.plate(ctx, cx, cy, size)
    if (playing) drawEqualizer(ctx, x, y, size, now / 1000)
    else {
      const note = art('/ui/ref/music-icon.png')
      if (note) ctx.drawImage(note, x, y, size, size)
    }
    this.hit(x, y, size, size, 'music', (ui) => {
      ui.menus.open('music')
      return null
    })
  }

  private timerIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, running: boolean, left: number): void {
    const x = cx - size / 2
    const y = cy - size / 2
    this.plate(ctx, cx, cy, size)
    const ratio = running && left > 0 ? Math.max(0, Math.min(1, left / 3600)) : 0
    if (ratio > 0) {
      const unit = size / 108
      const line = 7 * unit
      ctx.strokeStyle = 'rgba(255,255,255,0.3)'
      ctx.lineWidth = line
      ctx.lineCap = 'butt'
      ctx.beginPath()
      const radius = size / 2 - line / 2
      if (ratio > 0.999) ctx.arc(cx, cy, radius, 0, Math.PI * 2)
      else ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ratio)
      ctx.stroke()
      const rule = art('/ui/ref/top-rule.png')
      const decor = art('/ui/ref/top-right-decor.png')
      const dial = art('/ui/ref/dial-spin.png')
      if (rule) ctx.drawImage(rule, x + 41.85 * unit, y + 20.25 * unit, 24.3 * unit, 8.1 * unit)
      if (decor) ctx.drawImage(decor, x + 74 * unit, y + 33 * unit, 12 * unit, 13 * unit)
      if (dial) {
        ctx.save()
        ctx.translate(x + 54 * unit, y + 59.4 * unit)
        ctx.rotate(-(1 - ratio) * Math.PI * 2)
        ctx.drawImage(dial, -27 * unit, -27 * unit, 54 * unit, 54 * unit)
        ctx.restore()
      }
    } else {
      const idle = art('/ui/ref/timer-idle.png')
      if (idle) {
        ctx.save()
        // 30% 相对 HUD。不要读 globalAlpha 再乘：小程序画布读回来常是 1，沉浸时图标会停在 0.3。
        ctx.globalAlpha = this.hudShown * 0.3
        ctx.drawImage(idle, x, y, size, size)
        ctx.restore()
      }
    }
    this.hit(x, y, size, size, 'timer', (ui) => {
      ui.menus.open('timer')
      return null
    })
  }

  private stick(ctx: CanvasRenderingContext2D): void {
    const joy = this.joy
    if (!joy) return
    const knob = art('/ui/joystick/knob.png')
    if (joy.live) {
      const ring = art('/ui/joystick/ring.png')
      ctx.save()
      ctx.translate(joy.ox, joy.oy)
      ctx.rotate(Math.atan2(joy.dy, joy.dx) - Math.PI)
      if (ring) ctx.drawImage(ring, -222, -222, 444, 444)
      ctx.restore()
    }
    if (knob) ctx.drawImage(knob, joy.ox + joy.dx - 90, joy.oy + joy.dy - 90, 180, 180)
  }

  private veil(ctx: CanvasRenderingContext2D, alpha: number): void {
    const g = ctx.createLinearGradient(0, 0, 0, 1074)
    g.addColorStop(0, `rgba(0,0,0,${0.45 * alpha})`)
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, this.pw, 1074)
  }

  private banner(ctx: CanvasRenderingContext2D, text: string, alpha: number): void {
    ctx.save()
    ctx.globalAlpha = alpha
    ctx.fillStyle = '#fff'
    ctx.font = '600 72px "PingFang SC","PingFangSC-Semibold","Hiragino Sans GB",sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, this.pw / 2, 480 + 102)
    ctx.restore()
  }

  private breath(ctx: CanvasRenderingContext2D, now: number): void {
    const s = 1 + 0.06 * Math.sin(now / 400)
    ctx.save()
    ctx.translate(this.pw / 2, this.ph - 542 - 100)
    ctx.scale(s, s)
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'
    ctx.lineWidth = 8
    ctx.beginPath()
    ctx.arc(0, 0, 70, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }

  private toastAlpha(now: number): number {
    if (this.toastAt < 0) return 0
    const t = (now - this.toastAt) / 1000
    if (t < 0) return 0
    if (t < 1) return t
    if (t < 4) return 1
    if (t < 5) return 1 - (t - 4)
    return 0
  }

  private captionAlpha(now: number): number {
    if (this.captionAt < 0) return 0
    const t = (now - this.captionAt) / 1000
    if (t < 2) return 0
    if (t < 2.6) return (t - 2) / 0.6
    if (t < 5) return 1
    if (t < 5.6) return 1 - (t - 5) / 0.6
    return 0
  }

  private warmHud(): void {
    if (this.hudWarm) return
    this.hudWarm = true
    for (const src of HUD_ART) art(src)
    warmHudSvg('profile', profileSvg)
  }

  private loading(ctx: CanvasRenderingContext2D, progress: number): void {
    // LoadingForm.uss sliderprogressSlider: 885×12, centered, top at 100% − 154.
    // Live panel size supplies the center and the bottom edge; match-height scales it on screen.
    const w = 885
    const h = 12
    const x = (this.pw - w) / 2
    const y = this.ph - 154
    const track = art('/ui/ref/loading-track.png')
    if (track) ctx.drawImage(track, x, y, w, h)
    else {
      ctx.fillStyle = 'rgba(255,255,255,0.35)'
      round(ctx, x, y, w, h, h / 2)
      ctx.fill()
    }
    let ratio = Math.max(0, Math.min(1, progress))
    if (ratio > 0.001 && ratio < 0.02) ratio = 0.02
    const fw = w * ratio
    if (fw <= 0) return
    const fill = art('/ui/ref/loading-fill.png')
    if (fill) sliceEnds(ctx, fill, x, y, fw, h, 7 * (h / 12), 10 * (h / 12))
    else {
      const g = ctx.createLinearGradient(x, y, x + w, y)
      g.addColorStop(0, '#d6ff4a')
      g.addColorStop(1, '#3dffe0')
      ctx.fillStyle = g
      round(ctx, x, y, fw, h, h / 2)
      ctx.fill()
    }
  }
}

function weatherGlyph(kind: UiInput['weather'], level: number): { key: string; svg: string } {
  if (kind === 'rain' && level > 0) return { key: 'weather-rain', svg: rainSvg }
  if (kind === 'fog' && level > 0) return { key: 'weather-fog', svg: fogSvg }
  if (kind === 'wind' && level > 0) return { key: 'weather-wind', svg: windSvg }
  return { key: kind === 'clear' ? 'weather-clear' : 'weather-cloud', svg: weatherSvg }
}

function weatherArt(kind: UiInput['weather'], level: number): string {
  if (level <= 0 || kind === 'clear' || kind === 'cloud') return '/ui/weather/qingtian.png'
  const tier = level >= 3 ? 'da' : level === 2 ? 'zhong' : 'xiao'
  if (kind === 'wind') return `/ui/weather/${tier}feng.png`
  if (kind === 'rain') return `/ui/weather/${tier}yu.png`
  return `/ui/weather/${tier}wu.png`
}

const HUD_ART = [
  '/ui/time/color-swatch.png',
  '/ui/time/hand.png',
  '/ui/weather/qingtian.png',
  '/ui/ref/music-icon.png',
  '/ui/ref/volume-track.png',
  '/ui/ref/volume-fill.png',
  '/ui/ref/volume-dot.png',
  '/ui/ref/timer-idle.png',
  '/ui/ref/top-rule.png',
  '/ui/ref/top-right-decor.png',
  '/ui/ref/dial-spin.png',
  '/ui/ref/loading-track.png',
  '/ui/ref/loading-fill.png',
]

const artCache = new Map<string, HTMLImageElement>()
let artRev = 0

function sliceEnds(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
  capL: number,
  capR: number,
): void {
  const sw = image.naturalWidth
  const sh = image.naturalHeight
  if (w <= capL + capR || sw <= 17) {
    ctx.drawImage(image, x, y, w, h)
    return
  }
  const left = 7
  const right = 10
  ctx.drawImage(image, 0, 0, left, sh, x, y, capL, h)
  ctx.drawImage(image, left, 0, sw - left - right, sh, x + capL, y, w - capL - capR, h)
  ctx.drawImage(image, sw - right, 0, right, sh, x + w - capR, y, capR, h)
}

function sliceBar(ctx: CanvasRenderingContext2D, src: string, x: number, y: number, w: number, h: number): void {
  const image = art(src)
  if (!image || w <= 0 || h <= 0) return
  const cap = 6 * (h / image.naturalHeight)
  if (w <= cap * 2) {
    ctx.drawImage(image, 0, 0, image.naturalWidth, image.naturalHeight, x, y, w, h)
    return
  }
  const sw = image.naturalWidth
  const sh = image.naturalHeight
  ctx.drawImage(image, 0, 0, 6, sh, x, y, cap, h)
  ctx.drawImage(image, 6, 0, sw - 12, sh, x + cap, y, w - cap * 2, h)
  ctx.drawImage(image, sw - 6, 0, 6, sh, x + w - cap, y, cap, h)
}

function art(src: string): HTMLImageElement | null {
  if (typeof Image === 'undefined') return null
  let image = artCache.get(src)
  if (!image) {
    image = new Image()
    image.onload = () => { artRev += 1 }
    image.onerror = () => { artRev += 1 }
    image.src = src
    artCache.set(src, image)
  }
  return image.complete && image.naturalWidth > 0 ? image : null
}

function round(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}
