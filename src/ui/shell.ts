import { breathCue, breathOpen } from '../actor/skin'
import type { DownloadSnapshot } from '../game/download'
import { PERIOD_NAMES } from '../game/lines'
import { Talk, type Choice } from '../game/talk'
import { drawEqualizer } from './equalizer'
import {
  drawHudSvg,
  hudSvgRev,
  profileSvg,
  timeFaceSvg,
  timerSvg,
  volumeBaseSvg,
  warmHudSvg,
} from './hudSvg'
import { drawHealthTip, warmHealthTip, type TipButton } from './healthTip'
import { Menus, warmMenus } from './menus'

export const STAGE_W = 1125
export const STAGE_H = 2436

export type PlayMode = 'single' | 'loop' | 'shuffle'

const GREET_CHAR_MS = 100
/** Boluo time dial: label under the icon, icon1 steady, icon2 moves after the fade-in. */
const PERIOD_TOAST: { label: string; icon: string; arrow: string; motion: 'up' | 'down' | 'zzz' | 'none' }[] = [
  { label: '/ui/time/qingchent.png', icon: '/ui/time/huanghuntaiyang.png', arrow: '/ui/time/qingchenjiantou.png', motion: 'up' },
  { label: '/ui/time/zhengwut.png', icon: '/ui/time/zhengwuicon.png', arrow: '', motion: 'none' },
  { label: '/ui/time/huanghunt.png', icon: '/ui/time/huanghuntaiyang.png', arrow: '/ui/time/huanghunjiantou.png', motion: 'down' },
  { label: '/ui/time/yewant.png', icon: '/ui/time/yewanyueliang.png', arrow: '/ui/time/yewanzzz.png', motion: 'zzz' },
]

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
  /** Bank name of the track that is playing. Empty when nothing is. */
  trackId: string
  playing: boolean
  timerLeft: number
  timerRunning: boolean
  period: number
  /** 当前钟点，0–24。夜晚的 22 点才弹出晚安提醒。 */
  hour: number
  /** 与 hour 同一面钟上的日期，用来保证每晚只提醒一次。 */
  day: string
  /** 躺下时头顶的屏幕坐标。没有则不画睡眠动画。 */
  sleep: { x: number; y: number } | null
  /** 菠萝头顶的屏幕坐标。对话框坐在这上面，两个圆点接到这里。 */
  head: { x: number; y: number } | null
  panelW: number
  panelH: number
  handDeg: number
  /** 实时天气开关。手动改时间或天气后为关。 */
  live: boolean
  /** 单曲循环 / 列表循环 / 随机。 */
  playMode: PlayMode
  /** 导览开关。带路时开着，播完询问时也先开着。 */
  tour: boolean
  /** 一首带完，菠萝已经回到脚边，正在等是或否。 */
  tourAsk: boolean
  scoreText: string
  phaseText: string
  /** 踩点进行中。寻宝已经去掉。 */
  stepping: boolean
  /** Comma-separated outfit ids already paid for on this device. */
  outfitOwned: string
  /** Outfit currently saved on the body. Empty is the plain rind. */
  outfitWorn: string
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
  | { type: 'outfit-preview'; id: string }
  | { type: 'outfit-buy'; id: string }
  | { type: 'outfit-wear'; id: string }
  | { type: 'outfit-clear' }
  | { type: 'volume'; music: number; fx: number }
  | { type: 'play'; name: string }
  | { type: 'play-default' }
  | { type: 'play-mode'; mode: PlayMode }
  | { type: 'tour'; on: boolean }
  | { type: 'tour-next' }
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
  | { type: 'tap'; x: number; y: number }
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
  private toastPeriod = -1
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
  private menusWarmed = false
  private readonly talk = new Talk()
  private greetFull = ''
  private greetTypeAt = -1
  private lineGen = -1
  private lineRev = -1
  private lineChoice: Choice | null = null
  private lineAlpha = 0
  private fadeAt = 0
  private greetRect: { x: number; y: number; w: number; h: number } | null = null
  /** 对话被时间动画盖住的起点。-1 表示没有冻住。 */
  private dialogFrozenAt = -1
  /** 切时间的文案盖住对话时，揭开后不要把盖住前的那句再画出来。 */
  private lineHeld = false
  /** 语料还没回来。这时候循环不能睡过去。 */
  private lineWaiting = false
  /** Greeting characters are still appearing. */
  private speaking = false
  /** Action raised by the greeting itself, such as music after an untouched dialog closes. */
  private queued: UiAction | null = null

  constructor(agreed = false, private readonly profileEntry = true) {
    this.agreed = agreed
    if (!this.agreed) {
      try { this.agreed = localStorage.getItem('boluo.agree') === '1' } catch { this.agreed = false }
    }
    this.warmHud()
  }

  pointer(phase: 'down' | 'move' | 'up', x: number, y: number, id: number): UiAction | null {
    if (this.covered) return null
    const greet = this.greetRect
    if (greet && !this.menus.blocksMove && x >= greet.x && x < greet.x + greet.w && y >= greet.y && y < greet.y + greet.h) {
      if (this.lineChoice) {
        if (phase !== 'up') return null
        const hit = this.top(x, y)
        if (hit && (hit.id === 'tour-yes' || hit.id === 'tour-no' || hit.id === 'step-ok' || hit.id === 'step-no')) {
          return this.finish(hit.on(this), phase)
        }
        return this.finish(null, phase)
      }
      if (phase !== 'up') return null
      this.talk.skip()
      return this.finish(null, phase)
    }
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
    const greet = this.syncGreet(input.now, input.loading, input.period, input.hour, input.day, input.weather, input.weatherLevel, input.stepping, input.trackId, input.tourAsk, input.tour)
    this.speaking = greet.speaking
    const moving = !!this.joy || input.playing || input.loading || input.iris > 0.001
      || toastA > 0 || captionA > 0 || greet.busy || input.sleep != null
      || Math.abs(this.hudShown - shownTarget) > 0.01
      || this.menus.animating
    const breathStep = this.hudShown < 0.2
      ? `${Math.round(breathOpen(input.now) * 48)}${greet.guiding ? breathCue(input.now) : ''}`
      : ''
    this.warmHud()
    const sig = [
      input.loading ? input.progress.toFixed(2) : '',
      input.presetId, input.weather, input.weatherLevel,
      input.music.toFixed(2), input.fx.toFixed(2),
      input.playing ? input.trackName : '',
      input.timerRunning ? Math.ceil(input.timerLeft) : '',
      input.period, Math.round(input.handDeg),
      input.scoreText, input.phaseText,
      Math.round(input.panelW), Math.round(input.panelH),
      this.hudShown.toFixed(2), input.iris.toFixed(2),
      this.joy ? 'j' : '', this.toastText, this.caption, this.agreed ? 1 : 0,
      greet.alpha.toFixed(2), greet.text, greet.choice ?? '',
      greet.alpha > 0 && input.head ? `${Math.round(input.head.x)},${Math.round(input.head.y)}` : '',
      input.playMode, input.tour ? 1 : 0, input.tourAsk ? 1 : 0, input.trackId,
      input.sleep ? `${Math.round(input.sleep.x)},${Math.round(input.sleep.y)},${Math.floor(input.now / 80)}` : '',
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
      // The boot video covers the world. This canvas stays above it, so only the bar belongs here.
      this.loading(ctx, input.progress)
      return true
    }
    if (!this.menusWarmed) {
      this.menusWarmed = true
      warmMenus()
    }
    if (toastA > 0 || captionA > 0) this.veil(ctx, Math.max(toastA, captionA))
    ctx.save()
    ctx.globalAlpha = this.hudShown
    this.hud(ctx, input)
    ctx.restore()
    this.scoreHud(ctx, input)
    if (toastA > 0) {
      if (this.toastPeriod >= 0) this.timeToast(ctx, this.toastPeriod, toastA, input.now)
      else this.banner(ctx, this.toastText, toastA)
    }
    if (captionA > 0) this.banner(ctx, this.caption, captionA)
    if (this.hudShown < 0.2) this.breath(ctx, input.now, greet.guiding)
    if (input.sleep) this.drawSleep(ctx, input.sleep.x, input.sleep.y, input.now)
    this.stick(ctx)
    this.menus.draw(ctx)
    this.greetRect = null
    const offerReady = greet.choice === 'step' && greet.text.length > 0 && greet.text.length >= this.greetFull.length
    const askReady = greet.choice === 'ask' && greet.text.length > 0 && greet.text.length >= this.greetFull.length
    const choices: TipButton[] | null = askReady
      ? [{ id: 'tour-no', label: '否' }, { id: 'tour-yes', label: '是' }]
      : offerReady
        ? [{ id: 'step-no', label: '取消' }, { id: 'step-ok', label: '确定' }]
        : null
    drawHealthTip(ctx, this.pw, this.ph, art, greet.text, greet.alpha, choices, input.head, (id, x, y, w, h) => {
      if (id === 'card') {
        this.greetRect = { x, y, w, h }
        this.hit(x, y, w, h, 'health-tip', (ui) => {
          if (ui.lineChoice) return null
          ui.talk.skip()
          return null
        })
        return
      }
      this.hit(x, y, w, h, id, (ui) => {
        if (id === 'tour-yes') return ui.answerTour(true)
        if (id === 'tour-no') return ui.answerTour(false)
        return id === 'step-ok' ? ui.confirmStep() : ui.cancelStep()
      })
    })
    if (input.iris > 0) {
      ctx.fillStyle = `rgba(0,0,0,${input.iris})`
      ctx.fillRect(0, 0, this.pw, this.ph)
    }
    return true
  }

  /** One action the greeting queued without a pointer, then cleared. */
  takeQueued(): UiAction | null {
    const fromMenu = this.menus.takeQueued()
    if (fromMenu) return fromMenu
    const action = this.queued
    this.queued = null
    return action
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
    if (action?.type === 'play' || action?.type === 'tour' || action?.type === 'play-default' || action?.type === 'tour-next') {
      this.talk.leaveStep()
      if (action.type !== 'tour' || !action.on) this.talk.leaveAsk()
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
        const dx = x - this.joy.ox
        const dy = y - this.joy.oy
        const tap = !this.joy.live && Math.hypot(dx, dy) < 10
        const ox = this.joy.ox
        const oy = this.joy.oy
        this.joy = null
        if (tap) return { type: 'tap', x: ox, y: oy }
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
    const period = ((input.period % 4) + 4) % 4
    const hand = Number.isFinite(input.handDeg) ? input.handDeg : period * 90
    const onTime = (ui: Shell) => {
      const next = (period + 1) % 4
      ui.toastPeriod = next
      ui.toastText = PERIOD_NAMES[next]
      ui.toastAt = input.now
      ui.captionAt = -1
      return { type: 'period' as const }
    }
    this.glyph(ctx, left, top, size, 'time-face', timeFaceSvg, 'time', onTime)
    this.timeHand(ctx, left, top, size, hand)
    this.plate(ctx, left, top + gap, size)
    blitArt(ctx, weatherArt(input.weather, input.weatherLevel), left - size / 2, top + gap - size / 2, size, size)
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
    this.settingsIcon(ctx, right, top + gap * 2, size)
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
    // Figma sector and hand both point down. Morning is 0° and must point left.
    // feOffset is in the hand's own space. A canvas shadowOffset stays screen-down and leaves the tip.
    const unit = size / 36
    const drop = 1.58824 * unit
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate((degrees + 90) * Math.PI / 180)
    ctx.fillStyle = '#fff'
    ctx.beginPath()
    ctx.arc(0, 0, 16 * unit, Math.PI / 4, Math.PI * 3 / 4)
    ctx.arc(0, 0, 9.6 * unit, Math.PI * 3 / 4, Math.PI / 4, true)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = 'rgba(0,0,0,0.25)'
    this.handMark(ctx, unit, drop)
    ctx.fillStyle = '#A6FF00'
    this.handMark(ctx, unit, 0)
    ctx.restore()
  }

  private handMark(ctx: CanvasRenderingContext2D, unit: number, dy: number): void {
    ctx.beginPath()
    ctx.arc(0, dy, 4 * unit, 0, Math.PI * 2)
    ctx.fill()
    round(ctx, -2 * unit, dy, 4 * unit, 12 * unit, 2 * unit)
    ctx.fill()
  }

  private volumeIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, music: number, fx: number): void {
    const x = cx - size / 2
    const y = cy - size / 2
    drawHudSvg(ctx, 'volume-base', volumeBaseSvg, x, y, size, size)
    const unit = size / 36
    // Track 1 is music, track 2 is effects. Green covers the gray track up to the knob.
    this.volumeFill(ctx, x, y, unit, music, 13.0801, 10.353, 25.6471)
    this.volumeFill(ctx, x, y, unit, fx, 24, 9.99976, 25.9998)
    ctx.fillStyle = '#fff'
    this.volumeKnob(ctx, x, y, unit, music, 13.1012, 10.353, 25.6471)
    this.volumeKnob(ctx, x, y, unit, fx, 23.738, 9.99976, 25.9998)
    this.hit(x, y, size, size, 'volume', (ui) => {
      ui.menus.open('volume')
      return null
    })
  }

  private volumeFill(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    unit: number,
    value: number,
    cy: number,
    x0: number,
    x1: number,
  ): void {
    const amount = Math.max(0, Math.min(1, value))
    if (amount <= 0) return
    const stroke = 4.02308
    const cap = (stroke / 2) * unit
    const yLine = y + cy * unit
    const xStart = x + x0 * unit
    const span = (x1 - x0 + stroke) * unit
    ctx.save()
    ctx.beginPath()
    ctx.rect(xStart - cap, yLine - cap, span * amount, stroke * unit)
    ctx.clip()
    ctx.strokeStyle = '#A6FF00'
    ctx.lineWidth = stroke * unit
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(xStart, yLine)
    ctx.lineTo(x + x1 * unit, yLine)
    ctx.stroke()
    ctx.restore()
  }

  private volumeKnob(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    unit: number,
    value: number,
    cy: number,
    x0: number,
    x1: number,
  ): void {
    const amount = Math.max(0, Math.min(1, value))
    ctx.beginPath()
    ctx.arc(x + (x0 + (x1 - x0) * amount) * unit, y + cy * unit, 3.62077 * unit, 0, Math.PI * 2)
    ctx.fill()
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
    // 60 minutes fills the ring. A 30 minute timer starts at the halfway mark and shrinks back toward 12.
    const ratio = running && left > 0 ? Math.max(0, Math.min(1, left / 3600)) : 0
    if (ratio > 0) {
      this.plate(ctx, cx, cy, size)
      this.timerWatch(ctx, x, y, size, ratio)
      this.timerRing(ctx, cx, cy, size, ratio)
    } else {
      drawHudSvg(ctx, 'timer', timerSvg, x, y, size, size)
    }
    this.hit(x, y, size, size, 'timer', (ui) => {
      ui.menus.open('timer')
      return null
    })
  }

  /**
   * Running stopwatch. Face, hand, tick and the #A6FF00 crown share one 0.7 opacity.
   * The hand turns around the face center (18, 19.8), below the button center.
   */
  private timerWatch(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, ratio: number): void {
    const unit = size / 36
    ctx.save()
    ctx.translate(x, y)
    ctx.scale(unit, unit)
    ctx.globalAlpha = 0.7
    ctx.lineWidth = 2.7
    ctx.lineCap = 'round'
    ctx.strokeStyle = '#fff'
    ctx.beginPath()
    ctx.moveTo(27.1218, 13.6885)
    ctx.lineTo(26.2592, 12.5272)
    ctx.stroke()
    ctx.fillStyle = '#fff'
    ctx.beginPath()
    ctx.arc(18, 19.8, 9, 0, Math.PI * 2)
    this.timerHand(ctx, ratio * Math.PI * 2)
    ctx.fill('evenodd')
    ctx.fillStyle = '#A6FF00'
    round(ctx, 15.3, 8.1001 - 1.35, 5.4, 2.7, 1.35)
    ctx.fill()
    ctx.restore()
  }

  /** Up-pointing hand from the idle glyph. Positive radians rotate it clockwise around the face center. */
  private timerHand(ctx: CanvasRenderingContext2D, radians: number): void {
    ctx.save()
    ctx.translate(18, 19.8)
    ctx.rotate(radians)
    ctx.translate(-18, -19.8)
    ctx.moveTo(18, 13.8918)
    ctx.bezierCurveTo(17.4533, 13.8918, 17.0012, 14.3186, 16.9707, 14.8645)
    ctx.lineTo(16.6924, 19.8586)
    ctx.bezierCurveTo(16.6506, 20.6093, 17.2481, 21.2415, 18, 21.2415)
    ctx.bezierCurveTo(18.7519, 21.2414, 19.3494, 20.6093, 19.3076, 19.8586)
    ctx.lineTo(19.0283, 14.8645)
    ctx.bezierCurveTo(18.9978, 14.3186, 18.5467, 13.8919, 18, 13.8918)
    ctx.closePath()
    ctx.restore()
  }

  /** Countdown ring is centered on the button, not the watch face. */
  private timerRing(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, ratio: number): void {
    const line = 7 * (size / 108)
    ctx.strokeStyle = 'rgba(255,255,255,0.3)'
    ctx.lineWidth = line
    ctx.lineCap = 'butt'
    ctx.beginPath()
    const radius = size / 2 - line / 2
    if (ratio > 0.999) ctx.arc(cx, cy, radius, 0, Math.PI * 2)
    else ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ratio)
    ctx.stroke()
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

  /**
   * Top time banner. Noon keeps the full sun still. Dusk drops the arrow onto the sun.
   * Group fades 1s, holds 3s, fades 1s. The moving mark starts when the fade-in ends.
   */
  private timeToast(ctx: CanvasRenderingContext2D, period: number, alpha: number, now: number): void {
    const slot = PERIOD_TOAST[((period % 4) + 4) % 4]
    const ox = this.pw / 2 - 181.5
    const oy = this.ph / 2 - 798
    ctx.save()
    ctx.globalAlpha = alpha
    blitArt(ctx, slot.icon, ox + 120, oy + 60, 120, 120)
    blitArt(ctx, slot.label, ox + 8, oy + 397, 342, 166.5)
    const pose = icon2Pose(slot.motion, (now - this.toastAt) / 1000)
    if (pose && slot.arrow) {
      ctx.globalAlpha = alpha * pose.alpha
      blitArt(ctx, slot.arrow, ox + 120 + pose.dx, oy + 60 + pose.dy, 120, 120)
    }
    ctx.restore()
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

  private drawSleep(ctx: CanvasRenderingContext2D, x: number, y: number, now: number): void {
    const marks = ['z', 'z', 'Z']
    ctx.save()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineJoin = 'round'
    for (let i = 0; i < marks.length; i++) {
      const t = ((now / 1600) + i * 0.28) % 1
      const rise = t * 150
      const drift = (i - 1) * 28 + Math.sin(t * Math.PI) * 16
      const size = 36 + i * 14 + t * 10
      ctx.globalAlpha = Math.sin(t * Math.PI)
      ctx.font = `700 ${size}px "PingFang SC","Hiragino Sans GB",sans-serif`
      ctx.lineWidth = 8
      ctx.strokeStyle = 'rgba(40,48,80,0.35)'
      ctx.strokeText(marks[i], x + drift, y - rise)
      ctx.fillStyle = '#fff'
      ctx.fillText(marks[i], x + drift, y - rise)
    }
    ctx.restore()
  }

  private breath(ctx: CanvasRenderingContext2D, now: number, guiding: boolean): void {
    const open = breathOpen(now)
    const s = 0.82 + 0.36 * open
    ctx.save()
    ctx.translate(this.pw / 2, this.ph - 542 - 100)
    ctx.scale(s, s)
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'
    ctx.lineWidth = 8
    ctx.beginPath()
    ctx.arc(0, 0, 70, 0, Math.PI * 2)
    ctx.stroke()
    if (guiding) {
      ctx.fillStyle = 'rgba(255,255,255,0.92)'
      ctx.font = '600 32px "PingFang SC","Hiragino Sans GB",sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(breathCue(now), 0, 0)
    }
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

  /** 切换时间的文字和图标还在画面上，对话先别出来。 */
  private timeToastShowing(now: number): boolean {
    return this.toastPeriod >= 0 && this.toastAlpha(now) > 0
  }

  /** 连续移动后自己进入导览。这一首不弹带路台词，四处走走的询问也收起。 */
  muteStepLine(trackId: string): void {
    this.talk.muteSong(trackId)
  }

  /** 点了另一首歌。关上列表后弹出和这首歌名有关的一句。 */
  announceSong(trackId: string): void {
    this.talk.cutSong(trackId)
  }

  /** 点中菠萝。按它现在的动作向语料要一句。 */
  pokeGesture(name: 'stand' | 'wave' | 'sit' | 'lie'): void {
    this.talk.poke(name)
  }

  confirmStep(): UiAction {
    return this.talk.chooseStep(true)
  }

  answerTour(yes: boolean): UiAction {
    return this.talk.chooseAsk(yes)
  }

  cancelStep(): UiAction {
    return this.talk.chooseStep(false)
  }

  private settingsIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
    const x = cx - size / 2
    const y = cy - size / 2
    this.plate(ctx, cx, cy, size)
    const gear = art('/ui/ref/setting.svg')
    if (gear) {
      ctx.save()
      // 白色 30%，和个人中心图标一致。不要读 globalAlpha 再乘：小程序画布读回来常是 1。
      ctx.globalAlpha = this.hudShown * 0.3
      // viewBox 1024，齿尖约占 86%。齿轮本体保持在底盘直径的 60%。
      const draw = size * 0.6 / 0.86
      ctx.drawImage(gear, cx - draw / 2, cy - draw / 2, draw, draw)
      ctx.restore()
    }
    this.hit(x, y, size, size, 'settings', (ui) => {
      ui.menus.open('settings')
      return null
    })
  }

  private syncGreet(
    now: number,
    loading: boolean,
    period: number,
    hour: number,
    day: string,
    weather: UiInput['weather'],
    weatherLevel: number,
    stepping: boolean,
    trackId: string,
    tourAsk: boolean,
    tour: boolean,
  ): { alpha: number; text: string; busy: boolean; speaking: boolean; choice: Choice | null; guiding: boolean } {
    if (loading) {
      this.lineWaiting = false
      return { alpha: 0, text: '', busy: false, speaking: false, choice: null, guiding: false }
    }
    const toastLive = this.timeToastShowing(now)
    if (toastLive) this.holdDialog(now)
    else this.releaseDialogFreeze(now)
    // 只有切时间的文案挡住对话。天气这些面板和对话框不叠在一起，不用等它关上。
    const covered = toastLive
    if (covered) this.lineHeld = true
    const typedGen = !covered && this.greetFull.length > 0 && this.shownCount(now) >= this.greetFull.length
      ? this.lineGen
      : -1
    const revealed = this.lineGen >= 0 && this.lineGen === this.talk.face().gen && this.shownCount(now) > 0
    const action = this.talk.sync({
      now,
      loading,
      covered,
      period,
      hour,
      day,
      weather,
      weatherLevel,
      stepping,
      trackId,
      tourAsk,
      tourOn: tour,
      immersed: this.hudShown < 0.2 && !this.menus.blocksMove,
    }, typedGen, revealed)
    if (action) this.queued = action
    const face = this.talk.face()
    this.lineWaiting = face.waiting
    if (face.gen !== this.lineGen) {
      this.lineGen = face.gen
      this.lineRev = face.rev
      if (face.text) {
        this.greetFull = face.text
        this.greetTypeAt = now
      } else if (face.waiting || this.lineHeld || this.lineAlpha <= 0) {
        this.greetFull = ''
        this.greetTypeAt = -1
        this.lineAlpha = 0
      }
    } else if (face.rev !== this.lineRev) {
      this.lineRev = face.rev
      if (face.text && face.text !== this.greetFull) {
        const shown = this.shownCount(now)
        if (!this.greetFull || shown < this.greetFull.length) {
          this.greetFull = face.text
          this.greetTypeAt = now
        }
      }
    }
    this.lineChoice = face.choice
    if (!covered) this.lineHeld = false
    if (toastLive) return { alpha: 0, text: '', busy: face.waiting, speaking: false, choice: null, guiding: face.guiding }
    const dt = this.fadeAt ? Math.min(50, now - this.fadeAt) : 16
    this.fadeAt = now
    const step = dt / 400
    if (face.visible) this.lineAlpha = Math.min(1, this.lineAlpha + step)
    else this.lineAlpha = Math.max(0, this.lineAlpha - step)
    if (!face.visible && this.lineAlpha <= 0) {
      this.greetFull = ''
      this.greetTypeAt = -1
      return { alpha: 0, text: '', busy: face.waiting, speaking: false, choice: null, guiding: false }
    }
    const shown = this.shownCount(now)
    const speaking = face.visible && shown < this.greetFull.length
    return {
      alpha: this.lineAlpha,
      text: this.greetFull.slice(0, shown),
      busy: this.lineAlpha < 1 || speaking,
      speaking,
      choice: face.visible ? face.choice : null,
      guiding: face.guiding,
    }
  }

  /** True while a greeting line is still typing characters. */
  isSpeaking(): boolean {
    return this.speaking
  }

  /** HUD is down and no panel, toast, or line is moving. */
  coasting(): boolean {
    return this.hudShown <= 0.02 && !this.speaking && !this.lineWaiting && !this.menus.animating && !this.menus.blocksMove
  }

  /**
   * 0..1 through one mouth open-close. Two typed characters share a cycle.
   * 0 when the line is idle or the last character has already landed.
   */
  speakPhase(): number {
    if (!this.speaking || this.greetTypeAt < 0) return 0
    const span = GREET_CHAR_MS * 2
    const elapsed = Math.max(0, this.lastNow - this.greetTypeAt)
    return (elapsed % span) / span
  }

  /** 时间动画盖住对话时，打字先停住。揭开后从盖住的那一帧接着说。 */
  private holdDialog(now: number): void {
    if (this.dialogFrozenAt < 0) this.dialogFrozenAt = now
  }

  private releaseDialogFreeze(now: number): void {
    if (this.dialogFrozenAt < 0) return
    const paused = now - this.dialogFrozenAt
    this.dialogFrozenAt = -1
    if (paused <= 0) return
    if (this.greetTypeAt >= 0) this.greetTypeAt += paused
  }

  private shownCount(now: number): number {
    if (this.greetTypeAt < 0) return 0
    return Math.max(0, Math.min(this.greetFull.length, Math.floor((now - this.greetTypeAt) / GREET_CHAR_MS)))
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
    for (const slot of PERIOD_TOAST) {
      art(slot.label)
      art(slot.icon)
      if (slot.arrow) art(slot.arrow)
    }
    warmHealthTip(art)
    warmHudSvg('profile', profileSvg)
    warmHudSvg('time-face', timeFaceSvg)
    warmHudSvg('volume-base', volumeBaseSvg)
    warmHudSvg('timer', timerSvg)
  }

  private loading(ctx: CanvasRenderingContext2D, progress: number): void {
    // LoadingForm.uss sliderprogressSlider: 885×12, centered, top at 100% − 154.
    // Live panel size supplies the center and the bottom edge; match-height scales it on screen.
    const w = 885
    const h = 12
    const x = (this.pw - w) / 2
    const y = this.ph - 154
    ctx.fillStyle = 'rgba(255,255,255,0.35)'
    round(ctx, x, y, w, h, h / 2)
    ctx.fill()
    let ratio = Math.max(0, Math.min(1, progress))
    if (ratio > 0.001 && ratio < 0.02) ratio = 0.02
    const fw = w * ratio
    if (fw <= 0) return
    const g = ctx.createLinearGradient(x, y, x + w, y)
    g.addColorStop(0, '#d6ff4a')
    g.addColorStop(1, '#3dffe0')
    ctx.fillStyle = g
    round(ctx, x, y, fw, h, h / 2)
    ctx.fill()
  }
}

function icon2Pose(motion: 'up' | 'down' | 'zzz' | 'none', t: number): { dx: number; dy: number; alpha: number } | null {
  if (motion === 'none' || t < 0) return null
  if (t < 1) return motion === 'zzz' ? { dx: 0, dy: 0, alpha: 1 } : null
  const elapsed = t - 1
  if (elapsed >= 2) return null
  const u = (elapsed % 1) / 0.5
  if (motion === 'up') {
    if (u < 1) return { dx: 0, dy: 0, alpha: u }
    const k = u - 1
    return { dx: 0, dy: -20 * k, alpha: 1 - k }
  }
  if (motion === 'down') {
    if (u < 1) return { dx: 0, dy: -20, alpha: u }
    const k = u - 1
    return { dx: 0, dy: -20 * (1 - k), alpha: 1 - k }
  }
  if (u < 1) return { dx: 0, dy: 0, alpha: 1 }
  const k = u - 1
  return { dx: 20 * k, dy: -20 * k, alpha: 1 - k }
}

function blitArt(ctx: CanvasRenderingContext2D, src: string, x: number, y: number, w: number, h: number): void {
  const image = art(src)
  if (image) ctx.drawImage(image, x, y, w, h)
}

function weatherArt(kind: UiInput['weather'], level: number): string {
  if (level <= 0 || kind === 'clear' || kind === 'cloud') return '/ui/weather/qingtian.png'
  const tier = level >= 3 ? 'da' : level === 2 ? 'zhong' : 'xiao'
  if (kind === 'wind') return `/ui/weather/${tier}feng.png`
  if (kind === 'rain') return `/ui/weather/${tier}yu.png`
  return `/ui/weather/${tier}wu.png`
}

const HUD_ART = [
  '/ui/ref/setting.svg',
  '/ui/ref/music-icon.png',
  '/ui/weather/qingtian.png',
  '/ui/weather/xiaofeng.png',
  '/ui/weather/zhongfeng.png',
  '/ui/weather/dafeng.png',
  '/ui/weather/xiaoyu.png',
  '/ui/weather/zhongyu.png',
  '/ui/weather/dayu.png',
  '/ui/weather/xiaowu.png',
  '/ui/weather/zhongwu.png',
  '/ui/weather/dawu.png',
]

const artCache = new Map<string, HTMLImageElement>()
let artRev = 0

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
