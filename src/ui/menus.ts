import { currentUser } from '../net/account'
import { ALBUMS, BANKS, PRESETS, TRACKS } from '../game/catalog'
import type { DownloadSnapshot } from '../game/download'
import { drawEqualizer } from './equalizer'
import { drawHudSvg } from './hudSvg'
import { sliderDotSvg } from './menuSvg'
import { ProfilePane } from './profile'
import type { UiAction, UiInput } from './shell'

const W = 1125
const H = 2436
const SLIDE_MS = 320
const INK = '#181819'
const MUTED = '#878791'
const DESC = '#BAC8C3'
const GREEN = '#00A375'
const LEVEL_ML = [-403.5, -184.5, 37.5, 259.5]
const LEVEL_NAME = ['关闭', '小', '中', '大']
const WEATHER_KIND = ['wind', 'rain', 'fog'] as const
const TRAVEL = 663
const ROW_H = 144

type Kind = (typeof WEATHER_KIND)[number]
type Panel = 'weather' | 'music' | 'volume' | 'preset' | 'timer' | 'profile'
type Dialog = 'logout' | 'save' | 'timer-end' | 'cancel-account' | 'guest'
type Anim = { from: number; to: number; at: number }
type Spring = { v: number; vel: number; to: number }

const TIMER_KNOB_MIN_X = -327
const TIMER_KNOB_SPAN = 658.5
const TIMER_KNOB_DRAG_X = 2
const TIMER_KNOB_DRAG_Y = -276
const TIMER_KNOB_DRAG_SCALE = 1.66
const TIMER_SPRING_K = 400
const TIMER_SPRING_D = 0.82

interface Hit {
  x: number
  y: number
  w: number
  h: number
  id: string
  on: () => UiAction | null
}

export class Menus {
  panel: Panel | null = null
  dialog: Dialog | null = null
  forceAgreement = false
  private hits: Hit[] = []
  private now = 0
  private input: UiInput | null = null
  private panelAnim: Anim = { from: 0, to: 0, at: 0 }
  private modalAnim: Anim = { from: 0, to: 0, at: 0 }
  private panelClosing = false
  private modalClosing = false
  private downId = -1
  private downHit = ''
  private downX = 0
  private downY = 0
  private moved = 0
  private drag: '' | 'knob' | 'volume' | 'album' | 'list' | 'preset' | 'timer' | 'profile' = ''
  private dragStartX = 0
  private dragStartValue = 0
  private volumeKey: 'music' | 'fx' = 'music'
  private weatherTab = 0
  private knobMargin = LEVEL_ML[0]
  private knobLevel = 0
  private knobAnim: { from: number; to: number; at: number; level: number } | null = null
  private album = 0
  private albumX = 0
  private albumDrag = false
  private albumSnap: Anim | null = null
  private mode = 1
  private listY = 0
  private listDrag = false
  private presetX = 0
  private presetV = 0
  private presetDrag = false
  private heard = new Set<string>()
  private timerLive = false
  private timerFill = 0
  private timerPhase: 'idle' | 'drag' | 'settle' = 'idle'
  private timerHasDragged = false
  private timerSettleAt = 0
  private timerTickAt = 0
  private timerKnobReady = false
  private knobX: Spring = { v: TIMER_KNOB_MIN_X, vel: 0, to: TIMER_KNOB_MIN_X }
  private knobY: Spring = { v: 0, vel: 0, to: 0 }
  private knobS: Spring = { v: 1, vel: 0, to: 1 }
  private revealText = ''
  private revealAt = 0
  private rollText = ''
  private rollFrom = ''
  private rollAt = -1
  private knobText = ''
  private knobFrom = ''
  private knobAt = -1
  private profile = new ProfilePane()
  private toastText = ''
  private toastUntil = 0
  private barAt = 0

  get hidesBottom(): boolean {
    return this.panel != null
  }

  get animating(): boolean {
    if (this.sliding(this.panelAnim) || this.sliding(this.modalAnim)) return true
    if (this.panelClosing || this.modalClosing) return true
    if (this.knobAnim || this.albumSnap) return true
    if (this.drag || this.presetDrag || this.listDrag || this.albumDrag) return true
    if (this.presetV !== 0) return true
    if (this.toastUntil > this.now) return true
    if (this.timerPhase !== 'idle') return true
    if (this.timerMotionLive()) return true
    if (this.panel === 'profile' && this.profile.busy()) return true
    return false
  }

  paintKey(): string {
    const banks = this.input?.banks
    const open = this.panel != null || this.dialog != null || this.forceAgreement || (!!banks && banks.dialog !== 'none')
    if (!open || !banks) return ''
    let progress = ''
    if (banks.dialog === 'progress') {
      for (const name in banks.progress) progress += name + Math.round(banks.progress[name] * 20)
    }
    return [
      this.panel ?? '', this.dialog ?? '', this.forceAgreement ? 1 : 0, banks.dialog, spriteRev,
      this.profile.key(), Math.round(this.listY), this.album, Math.round(this.albumX),
      Math.round(this.presetX), this.knobLevel, this.mode, this.weatherTab,
      this.timerFill.toFixed(2), this.timerPhase, this.timerLive ? 1 : 0,
      Math.round(this.knobX.v), Math.round(this.knobY.v), this.knobS.v.toFixed(2),
      this.revealText, this.rollText, progress,
    ].join(',')
  }

  private sliding(anim: Anim): boolean {
    return anim.from !== anim.to && this.now - anim.at < SLIDE_MS
  }

  get blocksMove(): boolean {
    if (this.forceAgreement) return true
    if (this.panel) return true
    if (this.dialog) return true
    const d = this.input?.banks.dialog
    if (d && d !== 'none' && d !== 'progress' && d !== 'request') return true
    return false
  }

  sync(input: UiInput): void {
    this.input = input
    this.now = input.now
    this.tickKnob()
    this.tickCoast()
    this.tickSnap()
    if (this.panelClosing && this.offset(this.panelAnim) > 2400) {
      this.panel = null
      this.panelClosing = false
    }
    if (this.modalClosing && this.offset(this.modalAnim) > 2400) {
      this.dialog = null
      this.modalClosing = false
    }
    if (input.timerRunning && input.timerLeft > 0) this.timerLive = true
    if (this.timerLive && !input.timerRunning && input.timerLeft <= 0 && !this.dialog) {
      this.timerLive = false
      this.openDialog('timer-end')
    }
    if (this.panel === 'timer' && this.timerPhase === 'idle' && !this.timerHasDragged) this.alignTimer()
    if (this.timerPhase === 'settle' && this.now - this.timerSettleAt > 380) this.timerPhase = 'idle'
    this.tickTimer()
    this.profile.sync(input.now)
    if (this.panel !== 'profile' || this.panelClosing) this.profile.detach()
  }

  toast(text: string, ms = 1600): void {
    this.toastText = text
    this.toastUntil = this.now + ms
  }

  open(panel: Panel): void {
    if (panel === 'profile') {
      const user = currentUser()
      if (!user || user.guest) {
        this.openDialog('guest')
        return
      }
    }
    this.panelClosing = false
    this.panel = panel
    this.panelAnim = { from: H, to: 0, at: this.now }
    if (panel === 'weather') this.alignWeather()
    if (panel === 'music') {
      this.centerAlbum(false)
      primePlaying()
    }
    if (panel === 'timer') {
      this.timerHasDragged = false
      this.timerPhase = 'idle'
      this.revealText = ''
      this.rollText = ''
      this.rollFrom = ''
      this.rollAt = -1
      this.knobText = ''
      this.knobFrom = ''
      this.knobAt = -1
      this.alignTimer()
      this.placeTimerKnob()
    }
    if (panel === 'profile') this.profile.home()
  }

  showLogin(): void {
    this.dialog = null
    this.modalClosing = false
    this.panelClosing = false
    this.panel = 'profile'
    this.panelAnim = { from: this.input?.panelH || H, to: 0, at: this.now }
    this.profile.openLogin()
  }

  openDialog(dialog: Dialog): void {
    this.modalClosing = false
    this.dialog = dialog
    this.modalAnim = { from: H, to: 0, at: this.now }
  }

  pointer(phase: 'down' | 'move' | 'up', x: number, y: number, id: number): { consumed: boolean; action: UiAction | null } {
    if (this.forceAgreement) return { consumed: true, action: this.agreementPointer(phase, x, y, id) }
    const modal = this.modalOpen
    const sheet = this.panel != null
    if (!modal && !sheet) return { consumed: false, action: null }
    if (phase === 'down') {
      this.downId = id
      this.downX = x
      this.downY = y
      this.moved = 0
      const hit = this.top(x, y)
      this.downHit = hit?.id ?? 'backdrop'
      this.drag = ''
      if (this.downHit === 'backdrop') {
        return { consumed: true, action: this.dismissTop() }
      }
      if (this.downHit === 'knob') this.beginKnob(x)
      else if (this.downHit === 'vm' || this.downHit === 'vf') this.beginVolume(this.downHit === 'vm' ? 'music' : 'fx', x)
      else if (this.downHit.startsWith('album')) this.beginAlbum(x)
      else if (this.downHit === 'mlist' || this.downHit.startsWith('tr')) this.beginList(y)
      else if (this.downHit === 'plist' || this.downHit.startsWith('ps')) this.beginPreset(x)
      else if (this.downHit === 'twheel') this.beginTimer(x)
      else if (this.panel === 'profile' && this.downHit.startsWith('p')) {
        this.drag = 'profile'
        this.profile.note(this.downHit)
        this.profile.arm(y)
      }
      return { consumed: true, action: null }
    }
    if (id !== this.downId) return { consumed: true, action: null }
    if (phase === 'move') {
      this.moved += Math.hypot(x - this.downX, y - this.downY)
      this.downX = x
      this.downY = y
      if (this.drag === 'knob') this.moveKnob(x)
      if (this.drag === 'volume') return { consumed: true, action: this.moveVolume(x) }
      if (this.drag === 'album') this.moveAlbum(x)
      if (this.drag === 'list') this.moveList(y)
      if (this.drag === 'preset') this.movePreset(x)
      if (this.drag === 'timer') this.moveTimer(x)
      if (this.drag === 'profile') this.profile.drag(y)
      return { consumed: true, action: null }
    }
    const hit = this.top(x, y)
    const same = hit && hit.id === this.downHit && this.moved < 12
    const drag = this.drag
    this.drag = ''
    this.downId = -1
    if (drag === 'knob') return { consumed: true, action: this.endKnob() }
    if (drag === 'album') return { consumed: true, action: this.endAlbum(same ? hit : undefined) }
    if (drag === 'preset') return { consumed: true, action: this.endPreset(same ? hit : undefined) }
    if (drag === 'timer') return { consumed: true, action: this.endTimer() }
    if (drag === 'profile' && this.profile.end()) return { consumed: true, action: null }
    if (drag === 'list' && this.listDrag) return { consumed: true, action: null }
    if (same && hit) return { consumed: true, action: hit.on() }
    return { consumed: true, action: null }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    this.hits = []
    const input = this.input
    if (!input) return
    if (this.panel) this.drawPanel(ctx, input, this.offset(this.panelAnim))
    if (this.modalOpen) this.drawModal(ctx, input, this.dialogSlides ? this.offset(this.modalAnim) : 0)
    if (this.forceAgreement) this.drawAgreement(ctx)
    this.drawToast(ctx)
  }

  private get modalOpen(): boolean {
    const d = this.input?.banks.dialog
    return this.dialog != null || (!!d && d !== 'none')
  }

  private get dialogSlides(): boolean {
    return true
  }

  private offset(anim: Anim): number {
    const t = Math.max(0, Math.min(1, (this.now - anim.at) / SLIDE_MS))
    const ease = anim.to > anim.from ? t * t * t : 1 - (1 - t) ** 3
    return anim.from + (anim.to - anim.from) * ease
  }

  private dismissTop(): UiAction | null {
    const d = this.input?.banks.dialog
    if (d && d !== 'none') {
      if (d === 'progress') return { type: 'dismiss-download' }
      return { type: 'cancel-download' }
    }
    if (this.dialog && !this.modalClosing) {
      this.modalClosing = true
      this.modalAnim = { from: this.offset(this.modalAnim), to: H, at: this.now }
      if (this.dialog === 'timer-end') return { type: 'timer-dismiss' }
      return null
    }
    if (this.panel && !this.panelClosing) {
      this.panelClosing = true
      this.panelAnim = { from: this.offset(this.panelAnim), to: H, at: this.now }
    }
    return null
  }

  private alignWeather(): void {
    const input = this.input
    if (!input) return
    const kind = input.weather
    if (kind === 'rain' || kind === 'fog' || kind === 'wind') {
      this.weatherTab = WEATHER_KIND.indexOf(kind)
      this.knobLevel = Math.max(0, Math.min(3, input.weatherLevel))
    } else {
      this.weatherTab = 0
      this.knobLevel = 0
    }
    this.knobAnim = null
    this.knobMargin = LEVEL_ML[this.knobLevel]
  }

  private weatherBusy(): boolean {
    return this.knobAnim != null || (this.input?.iris ?? 0) > 0.05
  }

  private beginKnob(x: number): void {
    if (this.weatherBusy()) {
      this.toast('天气正在改变,稍后再操作')
      return
    }
    this.drag = 'knob'
    this.dragStartX = x
    this.dragStartValue = this.knobMargin
  }

  private moveKnob(x: number): void {
    if (this.drag !== 'knob') return
    const next = this.dragStartValue + (x - this.dragStartX)
    this.knobMargin = Math.max(LEVEL_ML[0], Math.min(LEVEL_ML[3], next))
  }

  private endKnob(): UiAction | null {
    const level = nearest(this.knobMargin)
    return this.commitLevel(level)
  }

  private commitLevel(level: number): UiAction | null {
    if (this.weatherBusy()) {
      this.toast('天气正在改变,稍后再操作')
      return null
    }
    this.knobLevel = level
    this.knobAnim = { from: this.knobMargin, to: LEVEL_ML[level], at: this.now, level }
    const kind = WEATHER_KIND[this.weatherTab]
    return { type: 'weather', kind, level }
  }

  private tickKnob(): void {
    const anim = this.knobAnim
    if (!anim) return
    const t = Math.max(0, Math.min(1, (this.now - anim.at) / 500))
    const u = t * t * (3 - 2 * t)
    this.knobMargin = anim.from + (anim.to - anim.from) * u
    if (t >= 1) {
      this.knobMargin = anim.to
      this.knobAnim = null
    }
  }

  private beginVolume(key: 'music' | 'fx', x: number): void {
    this.drag = 'volume'
    this.volumeKey = key
    this.dragStartX = x
    this.dragStartValue = key === 'music' ? (this.input?.music ?? 0.8) : (this.input?.fx ?? 0.8)
  }

  private moveVolume(x: number): UiAction | null {
    const input = this.input
    if (!input) return null
    const value = Math.max(0, Math.min(1, this.dragStartValue + (x - this.dragStartX) / TRAVEL))
    return {
      type: 'volume',
      music: this.volumeKey === 'music' ? value : input.music,
      fx: this.volumeKey === 'fx' ? value : input.fx,
    }
  }

  private beginAlbum(x: number): void {
    this.drag = 'album'
    this.albumDrag = false
    this.albumSnap = null
    this.dragStartX = x
    this.dragStartValue = this.albumX
  }

  private moveAlbum(x: number): void {
    if (Math.abs(x - this.dragStartX) > 6) this.albumDrag = true
    if (!this.albumDrag) return
    this.albumX = this.dragStartValue + (x - this.dragStartX)
  }

  private endAlbum(hit?: Hit): UiAction | null {
    if (!this.albumDrag && hit && /^album\d+$/.test(hit.id)) {
      this.album = Number(hit.id.slice(5))
      this.listY = 0
      this.centerAlbum(true)
      return null
    }
    const count = ALBUMS.length || 1
    let best = 0
    let bestDist = Infinity
    for (let i = 0; i < count; i++) {
      const dist = Math.abs(this.albumX - this.albumTarget(i))
      if (dist < bestDist) {
        bestDist = dist
        best = i
      }
    }
    this.album = best
    this.listY = 0
    this.centerAlbum(true)
    return null
  }

  private centerAlbum(animate: boolean): void {
    const to = this.albumTarget(this.album)
    if (!animate) {
      this.albumX = to
      this.albumSnap = null
      return
    }
    this.albumSnap = { from: this.albumX, to, at: this.now }
  }

  private albumTarget(index: number): number {
    const widths = this.albumWidths()
    let cursor = 0
    for (let i = 0; i < index; i++) cursor += widths[i] + 40
    const center = cursor + widths[index] / 2
    return 394 - center
  }

  private albumWidths(): number[] {
    return ALBUMS.map((album, i) => Math.max(48, textWidth(album.name, i === this.album ? 72 : 48)))
  }

  private tickSnap(): void {
    const snap = this.albumSnap
    if (!snap) return
    const t = Math.max(0, Math.min(1, (this.now - snap.at) / 220))
    const u = t * t * (3 - 2 * t)
    this.albumX = snap.from + (snap.to - snap.from) * u
    if (t >= 1) this.albumSnap = null
  }

  private beginList(y: number): void {
    this.drag = 'list'
    this.listDrag = false
    this.dragStartX = y
    this.dragStartValue = this.listY
  }

  private moveList(y: number): void {
    if (Math.abs(y - this.dragStartX) > 28) this.listDrag = true
    if (!this.listDrag) return
    const max = Math.max(0, (ALBUMS[this.album]?.banks.length ?? 0) * ROW_H - 996)
    this.listY = Math.max(0, Math.min(max, this.dragStartValue - (y - this.dragStartX)))
    this.barAt = this.now
  }

  private beginPreset(x: number): void {
    this.drag = 'preset'
    this.presetDrag = false
    this.presetV = 0
    this.dragStartX = x
    this.dragStartValue = this.presetX
  }

  private movePreset(x: number): void {
    if (Math.abs(x - this.dragStartX) > 8) this.presetDrag = true
    const dt = 0.016
    const next = this.clampPreset(this.dragStartValue - (x - this.dragStartX))
    this.presetV = (next - this.presetX) / dt
    this.presetX = next
    this.barAt = this.now
  }

  private endPreset(hit?: Hit): UiAction | null {
    const speed = Math.abs(this.presetV) < 140 ? 0 : Math.max(-2000, Math.min(2000, this.presetV * 0.85))
    this.presetV = this.presetDrag ? speed : 0
    if (this.presetDrag || !hit || !hit.id.startsWith('ps')) return null
    return hit.on()
  }

  private tickCoast(): void {
    if (!this.presetV) return
    const dt = 0.016
    this.presetX = this.clampPreset(this.presetX + this.presetV * dt)
    const sign = Math.sign(this.presetV)
    this.presetV -= sign * 3200 * dt
    if (sign * this.presetV <= 35) this.presetV = 0
  }

  private clampPreset(x: number): number {
    const n = PRESETS.length
    const content = 60 + n * 264 + Math.max(0, n - 1) * 36 + 60
    const max = Math.max(0, content - (1035 - 96))
    return Math.max(0, Math.min(max, x))
  }

  private alignTimer(): void {
    const input = this.input
    if (!input) return
    const left = input.timerRunning ? Math.max(0, Math.ceil(input.timerLeft)) : 0
    this.timerFill = left > 0 ? Math.min(1, left / 3600) : 0
  }

  private timerPose(): { x: number; y: number; scale: number } {
    const dragging = this.timerPhase === 'drag'
    return {
      x: dragging ? TIMER_KNOB_DRAG_X : TIMER_KNOB_MIN_X + this.timerFill * TIMER_KNOB_SPAN,
      y: dragging ? TIMER_KNOB_DRAG_Y : 0,
      scale: dragging ? TIMER_KNOB_DRAG_SCALE : 1,
    }
  }

  private placeTimerKnob(): void {
    const pose = this.timerPose()
    this.knobX = { v: pose.x, vel: 0, to: pose.x }
    this.knobY = { v: pose.y, vel: 0, to: pose.y }
    this.knobS = { v: pose.scale, vel: 0, to: pose.scale }
    this.timerKnobReady = true
    this.timerTickAt = this.now
  }

  private tickTimer(): void {
    const dt = this.timerTickAt ? Math.min(0.05, (this.now - this.timerTickAt) / 1000) : 0
    this.timerTickAt = this.now
    if (this.panel !== 'timer') {
      this.timerKnobReady = false
      return
    }
    if (this.panelClosing) return
    const pose = this.timerPose()
    if (!this.timerKnobReady) {
      this.placeTimerKnob()
    } else if (dt > 0) {
      this.knobX.to = pose.x
      this.knobY.to = pose.y
      this.knobS.to = pose.scale
      stepSpring(this.knobX, dt, TIMER_SPRING_K, TIMER_SPRING_D)
      stepSpring(this.knobY, dt, TIMER_SPRING_K, TIMER_SPRING_D)
      stepSpring(this.knobS, dt, TIMER_SPRING_K, TIMER_SPRING_D)
    } else {
      this.knobX.to = pose.x
      this.knobY.to = pose.y
      this.knobS.to = pose.scale
    }
    this.syncTimerCopy()
  }

  private syncTimerCopy(): void {
    const input = this.input
    if (!input) return
    const minutes = this.timerMinutes()
    const active = input.timerRunning && input.timerLeft > 0
    const dragging = this.timerPhase === 'drag'
    const showTime = !dragging && (this.timerPhase === 'settle' || (this.timerHasDragged ? minutes > 0 : active))
    const left = Math.max(0, Math.ceil(input.timerLeft))
    const clock = this.timerHasDragged || !active
      ? `${String(minutes).padStart(2, '0')}:00`
      : `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`
    if (showTime && this.timerHasDragged) {
      if (this.revealText !== clock) {
        this.revealText = clock
        this.revealAt = this.now
      }
      this.rollText = ''
    } else if (showTime) {
      if (this.rollText !== clock) {
        this.rollFrom = this.rollText
        this.rollText = clock
        this.rollAt = this.rollFrom ? this.now : -1
      }
      this.revealText = ''
    } else {
      this.revealText = ''
      this.rollText = ''
      this.rollFrom = ''
    }
    const knobLabel = String(minutes)
    if (this.timerPhase !== 'idle') {
      if (this.knobText !== knobLabel) {
        this.knobFrom = this.knobText
        this.knobText = knobLabel
        this.knobAt = this.knobFrom ? this.now : -1
      }
    } else {
      this.knobText = ''
      this.knobFrom = ''
      this.knobAt = -1
    }
  }

  private timerMotionLive(): boolean {
    if (this.panel !== 'timer') return false
    if (!springRest(this.knobX) || !springRest(this.knobY) || !springRest(this.knobS)) return true
    if (this.revealText && !revealSettled(this.revealText, (this.now - this.revealAt) / 1000)) return true
    if (this.rollAt >= 0 && !rollSettled(this.rollFrom, this.rollText, (this.now - this.rollAt) / 1000)) return true
    if (this.knobAt >= 0 && !rollSettled(this.knobFrom, this.knobText, (this.now - this.knobAt) / 1000)) return true
    return false
  }

  private timerMinutes(): number {
    const m = Math.floor(this.timerFill * 3600 / 60)
    return m - (m % 5)
  }

  private beginTimer(x: number): void {
    if (this.timerPhase === 'settle') return
    this.drag = 'timer'
    this.timerPhase = 'drag'
    this.timerHasDragged = true
    this.dragStartX = x
    this.dragStartValue = this.timerFill
  }

  private moveTimer(x: number): void {
    if (this.timerPhase !== 'drag') return
    const delta = (x - this.dragStartX) / 658.5
    this.timerFill = Math.max(0, Math.min(1, this.dragStartValue + delta))
  }

  private endTimer(): UiAction | null {
    if (this.timerPhase !== 'drag') return null
    const minutes = this.timerMinutes()
    this.timerFill = minutes / 60
    this.timerPhase = 'settle'
    this.timerSettleAt = this.now
    return null
  }

  private frame(): { pw: number; ph: number; ox: number; oy: number } {
    const pw = this.input?.panelW || W
    const ph = this.input?.panelH || H
    return { pw, ph, ox: (pw - W) / 2, oy: ph - H }
  }

  private drawPanel(ctx: CanvasRenderingContext2D, input: UiInput, dy: number): void {
    const { pw, ph, ox, oy } = this.frame()
    this.hit(0, 0, pw, ph, 'backdrop', () => null)
    if (this.panel === 'profile' && this.profile.logging()) {
      const start = this.hits.length
      ctx.save()
      ctx.translate(0, dy)
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, pw, ph)
      this.hit(0, 0, pw, ph, 'pcard', () => null)
      this.profile.draw(ctx, {
        now: this.now,
        modal: this.dialog != null,
        hit: (x, yy, w, hh, id, on) => this.hit(x, yy, w, hh, id, on),
        toast: (text) => this.toast(text),
        askLogout: () => this.openDialog('logout'),
        close: () => { this.dismissTop() },
      }, { ox: 0, oy: dy, pw, ph })
      ctx.restore()
      this.shiftFrom(start, 0, dy)
      return
    }
    if (this.panel === 'profile') {
      ctx.fillStyle = 'rgba(0,0,0,0.35)'
      ctx.fillRect(0, 0, pw, ph)
    }
    const start = this.hits.length
    ctx.save()
    ctx.translate(ox, oy + dy)
    if (this.panel === 'weather') this.drawWeather(ctx, input)
    if (this.panel === 'music') this.drawMusic(ctx, input)
    if (this.panel === 'volume') this.drawVolume(ctx, input)
    if (this.panel === 'preset') this.drawPreset(ctx, input)
    if (this.panel === 'timer') this.drawTimer(ctx, input)
    if (this.panel === 'profile') this.drawProfile(ctx, ox, oy + dy, pw, ph)
    ctx.restore()
    this.shiftFrom(start, ox, oy + dy)
  }

  private shiftFrom(start: number, dx: number, dy: number): void {
    for (let i = start; i < this.hits.length; i++) {
      if (this.hits[i].id === 'backdrop') continue
      this.hits[i].x += dx
      this.hits[i].y += dy
    }
  }

  private drawWeather(ctx: CanvasRenderingContext2D, _input: UiInput): void {
    const x = 45
    const y = 1581
    sheet(ctx, x, y, 1035, 735, 147)
    this.hit(x, y, 1035, 735, 'card', () => null)
    const tabs = ['风', '雨', '雾']
    const origins = [364.5, 520.5, 676.5]
    tabs.forEach((label, i) => {
      ctx.globalAlpha = i === this.weatherTab ? 1 : 0.3
      ctx.fillStyle = INK
      ctx.font = font(60)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(label, origins[i] + 42, 1673 + 42)
      ctx.globalAlpha = 1
      this.hit(origins[i], 1673, 84, 84, 'tab' + i, () => {
        if (this.weatherBusy()) {
          this.toast('天气正在改变,稍后再操作')
          return null
        }
        this.weatherTab = i
        const kind = WEATHER_KIND[i]
        const live = this.input
        this.knobLevel = live && live.weather === kind ? Math.max(0, Math.min(3, live.weatherLevel)) : 0
        this.knobMargin = LEVEL_ML[this.knobLevel]
        return null
      })
    })
    const tabX = origins[this.weatherTab] + 42 - 21
    ctx.fillStyle = GREEN
    round(ctx, tabX, 1770, 42, 9, 4)
    ctx.fill()
    ctx.fillStyle = DESC
    ctx.font = font(39)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    wrap(ctx, '天气档位调节\n点击以下区域可进行档位调节哦～', 84, 1876, 957, 52, 'center')
    round(ctx, 129, 2028, 867, 204, 102)
    ctx.fillStyle = '#E6E7EB'
    ctx.fill()
    this.hit(129, 2028, 867, 204, 'track', () => null)
    const trackHit = this.hits[this.hits.length - 1]
    trackHit.on = () => this.commitLevel(this.levelFromTrack(this.downX))
    LEVEL_ML.forEach((margin, level) => {
      const cx = 562.5 + margin + 72
      drawHudSvg(ctx, 'dot', sliderDotSvg, cx - 18, 2028 + 102 - 18, 36, 36)
      this.hit(562.5 + margin, 2058, 144, 144, 'lv' + level, () => this.commitLevel(level))
    })
    const kx = 562.5 + this.knobMargin
    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.12)'
    ctx.shadowBlur = 24
    ctx.fillStyle = '#fff'
    ctx.beginPath()
    ctx.arc(kx + 72, 2058 + 72, 72, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
    if (!this.knobAnim && this.drag !== 'knob') {
      ctx.fillStyle = '#3D3D3D'
      ctx.font = font(42)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(LEVEL_NAME[this.knobLevel], kx + 72, 2058 + 72)
    }
    this.hit(kx, 2058, 144, 144, 'knob', () => null)
  }

  private levelFromTrack(x: number): number {
    let best = 0
    let dist = Infinity
    LEVEL_ML.forEach((margin, i) => {
      const cx = 562.5 + margin + 72
      const d = Math.abs(x - cx)
      if (d < dist) {
        dist = d
        best = i
      }
    })
    return best
  }

  private drawMusic(ctx: CanvasRenderingContext2D, input: UiInput): void {
    const x = 45
    const y = 879
    paint(ctx, '/ui/ref/music-card.png', x, y, 1035, 1437, 140)
    const widths = this.albumWidths()
    this.hit(168.5, 963, 788, 101, 'album', () => null)
    ctx.save()
    ctx.beginPath()
    ctx.rect(168.5, 963, 788, 101)
    ctx.clip()
    let cursor = this.albumX
    ALBUMS.forEach((album, i) => {
      const selected = i === this.album
      ctx.globalAlpha = selected ? 1 : 0.3
      ctx.fillStyle = INK
      ctx.font = font(selected ? 72 : 48)
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillText(album.name, 168.5 + cursor, 963 + 50)
      this.hit(168.5 + cursor, 963, widths[i], 101, 'album' + i, () => null)
      cursor += widths[i] + 40
      ctx.globalAlpha = 1
    })
    ctx.restore()
    ctx.fillStyle = GREEN
    round(ctx, 168.5 + 394 - 30, 963 + 122, 60, 12, 6)
    ctx.fill()
    const tracks = (ALBUMS[this.album]?.banks ?? [])
      .map((name) => TRACKS.find((track) => track.name === name))
      .filter((track): track is (typeof TRACKS)[number] => !!track)
    ctx.fillStyle = MUTED
    ctx.font = font(42)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(`全部歌曲${tracks.length}首`, 131, 1146 + 29)
    this.drawMode(ctx)
    const listTop = 1260
    const listH = 996
    this.hit(x, listTop, 1035, listH, 'mlist', () => null)
    ctx.save()
    ctx.beginPath()
    ctx.rect(x, listTop, 1035, listH)
    ctx.clip()
    tracks.forEach((track, i) => {
      const row = listTop + i * ROW_H - this.listY
      if (row > listTop + listH || row + ROW_H < listTop) return
      const ready = input.banks.states[track.name] === 'ready'
      const loading = input.banks.states[track.name] === 'downloading'
      const failed = input.banks.states[track.name] === 'failed'
      const playing = input.playing && input.trackName === track.label
      ctx.fillStyle = playing ? GREEN : INK
      ctx.font = font(45)
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      const title = track.label
      const maskW = 700
      ctx.save()
      ctx.beginPath()
      ctx.rect(131, row, maskW, ROW_H)
      ctx.clip()
      let tx = 131
      const tw = ctx.measureText(title).width
      if (tw > maskW) {
        const span = tw + 160
        const travel = ((this.now / 1000) * 80) % (span + 240)
        tx = 131 - Math.max(0, travel - 240)
      }
      ctx.fillText(title, tx, row + ROW_H / 2)
      ctx.restore()
      if (ready && !this.heard.has(track.name) && !playing) {
        ctx.fillStyle = '#F32C2C'
        ctx.beginPath()
        ctx.arc(131 + Math.min(tw, maskW) + 12, row + 45 + 9, 9, 0, Math.PI * 2)
        ctx.fill()
      }
      const iconX = x + 1035 - 84 - 60
      const iconY = row + 42
      if (playing) {
        const frame = playingFrame(this.now)
        if (frame) ctx.drawImage(frame, iconX, iconY, 60, 60)
      } else if (loading) ring(ctx, iconX + 30, iconY + 30, 22, input.banks.progress[track.name] ?? 0)
      else if (!ready) blit(ctx, failed ? '/ui/ref/MusicError.png' : '/ui/ref/MusicNotDownload.png', iconX, iconY, 60, 60)
      this.hit(x, row, 1035, ROW_H, 'tr' + track.name, () => {
        if (loading || playing) return null
        if (ready) {
          this.heard.add(track.name)
          return { type: 'play', name: track.name }
        }
        return { type: 'download', names: [track.name], quiet: true }
      })
    })
    ctx.restore()
    this.drawBar(ctx, 1035 - 28, listTop, listH, this.listY, Math.max(0, tracks.length * ROW_H - listH))
  }

  private drawMode(ctx: CanvasRenderingContext2D): void {
    const x = 818
    const y = 1133
    const file = this.mode === 1 ? 'yy_danqu' : this.mode === 2 ? 'yy_list' : 'yy_suiji'
    blit(ctx, `/ui/ref/${file}.png`, x, y, 180, 84)
    this.hit(x, y, 180, 84, 'mode', () => {
      this.mode = this.mode === 1 ? 2 : this.mode === 2 ? 3 : 1
      this.toast(this.mode === 1 ? '单曲循环' : this.mode === 2 ? '列表循环' : '随机播放')
      return null
    })
  }

  private drawVolume(ctx: CanvasRenderingContext2D, input: UiInput): void {
    blit(ctx, '/ui/ref/panel.png', 45, 1218, 1035, 1098)
    ctx.fillStyle = INK
    ctx.font = font(72)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('音量调节', 562.5, 1302 + 57)
    ctx.fillStyle = DESC
    ctx.font = font(39)
    ctx.fillText('调节音量，左滑关闭，右滑增加哦～', 562.5, 1402 + 45)
    this.volumeRow(ctx, 126, 1590, '音乐调节', input.music, 'vm')
    this.volumeRow(ctx, 126, 1940, '音效调节', input.fx, 'vf')
  }

  private volumeRow(ctx: CanvasRenderingContext2D, x: number, y: number, caption: string, value: number, id: string): void {
    const line = y + 18
    ctx.fillStyle = MUTED
    ctx.textBaseline = 'middle'
    ctx.font = '400 36px "PingFang SC","PingFangSC-Regular","Hiragino Sans GB",sans-serif'
    ctx.textAlign = 'left'
    ctx.fillText(caption, x, line)
    ctx.font = '600 36px "PingFang SC","PingFangSC-Semibold","Hiragino Sans GB",sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(String(Math.round(value * 100)), x + 180.5, line)
    this.hit(x, y, 870, 290, id + '-row', () => null)
    const trackX = x + 3
    const trackY = y + 86
    blit(ctx, '/ui/ref/track.png', trackX, trackY, 867, 204)
    const fillW = value <= 0.001 ? 0 : Math.min(867, 204 + TRAVEL * value)
    if (fillW > 0) nine(ctx, '/ui/ref/fill.png', trackX, trackY, fillW, 204, 101, 101, 0, 0)
    const knobLeft = trackX + 433.5 - 331 - 72 + TRAVEL * value
    blit(ctx, '/ui/ref/dian.png', knobLeft - 90, y + 116 - 90, 324, 324)
    this.hit(knobLeft, y + 116, 144, 144, id, () => null)
  }

  private drawPreset(ctx: CanvasRenderingContext2D, input: UiInput): void {
    const x = 45
    const y = 1356
    paint(ctx, '/ui/ref/panel.png', x, y, 1035, 960, 140)
    this.hit(x, y, 1035, 960, 'card', () => null)
    ctx.fillStyle = '#19191A'
    ctx.font = font(72)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('预设', 562.5, y + 84 + 51)
    ctx.fillStyle = DESC
    ctx.font = font(39)
    ctx.textBaseline = 'top'
    wrap(ctx, '设置场景预设\n点击以下预设可快速切换场景哦～', x + 84, y + 234, 867, 52, 'center')
    const listX = x + 48
    const listY = y + 426
    this.hit(listX, listY, 1035 - 96, 342, 'plist', () => null)
    ctx.save()
    ctx.beginPath()
    ctx.rect(listX, listY, 1035 - 96, 342)
    ctx.clip()
    PRESETS.forEach((preset, i) => {
      const cx = listX + 60 + i * (264 + 36) - this.presetX
      blit(ctx, `/ui/ref/zhanweitu${i + 1}.png`, cx, listY, 264, 264)
      const ready = input.banks.states[preset.bank] === 'ready'
      const loading = input.banks.states[preset.bank] === 'downloading'
      const playing = input.presetId === preset.id && ready
      const failed = input.banks.states[preset.bank] === 'failed'
      blit(ctx, '/ui/ref/bofangzhuangtai.png', cx + 24, listY + 162, 78, 78)
      if (playing) drawEqualizer(ctx, cx + 24, listY + 162, 78, this.now / 1000)
      else if (loading) ring(ctx, cx + 63, listY + 201, 18, input.banks.progress[preset.bank] ?? 0)
      else if (!ready) blit(ctx, failed ? '/ui/ref/stateerror.png' : '/ui/ref/statewaitdownload.png', cx + 33, listY + 171, 60, 60)
      else blit(ctx, '/ui/ref/stateready.png', cx + 33, listY + 171, 60, 60)
      if (ready && !playing && !this.heard.has(preset.id)) {
        ctx.fillStyle = '#F32C2C'
        ctx.beginPath()
        ctx.arc(cx + 70, listY + 190, 8, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.fillStyle = '#19191A'
      ctx.font = font(39)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillText(preset.label, cx + 132, listY + 288)
      this.hit(cx, listY, 264, 342, 'ps' + preset.id, () => {
        if ((this.input?.iris ?? 0) > 0.05) {
          this.toast('天气正在改变,稍后再操作')
          return null
        }
        if (!ready) return { type: 'download', names: [preset.bank], quiet: true }
        this.heard.add(preset.id)
        this.panel = null
        this.panelClosing = false
        return { type: 'preset', id: preset.id }
      })
    })
    ctx.restore()
    const max = this.clampPreset(1e9)
    blit(ctx, '/ui/ref/scroll-track.png', 562.5 - 120, y + 858, 240, 18)
    const thumbX = max <= 0 ? 562.5 - 31.5 : 562.5 - 120 + (240 - 63) * (this.presetX / max)
    ctx.globalAlpha = this.now - this.barAt < 3000 ? 1 : 0.5
    blit(ctx, '/ui/ref/scroll-track-active.png', thumbX, y + 858, 63, 18)
    ctx.globalAlpha = 1
  }

  private drawBar(ctx: CanvasRenderingContext2D, x: number, y: number, h: number, scroll: number, max: number): void {
    if (max <= 0 || this.now - this.barAt > 3000) return
    const thumb = Math.max(48, h * (h / (h + max)))
    const ty = y + (h - thumb) * (scroll / max)
    blit(ctx, '/ui/ref/yy_huadongtiao.png', x, ty, 15, thumb)
  }

  private drawTimer(ctx: CanvasRenderingContext2D, input: UiInput): void {
    const x = 45
    const y = 1350
    const w = 1035
    const h = 966
    blit(ctx, '/ui/ref/bgkuang.png', x, y, w, h)
    this.hit(x, y, w, h, 'card', () => null)
    const minutes = this.timerMinutes()
    const active = input.timerRunning && input.timerLeft > 0
    const dragging = this.timerPhase === 'drag'
    const settled = this.timerPhase === 'idle'
    const showTitle = settled && (this.timerHasDragged ? minutes === 0 : !active)
    const showTime = !dragging && (this.timerPhase === 'settle' || (this.timerHasDragged ? minutes > 0 : active))
    const left = Math.max(0, Math.ceil(input.timerLeft))
    const clock = this.timerHasDragged || !active
      ? `${String(minutes).padStart(2, '0')}:00`
      : `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    if (showTitle) {
      ctx.fillStyle = '#19191A'
      ctx.font = font(72)
      ctx.fillText('定时', x + w / 2, y + (h - 831.5))
    }
    if (showTime) {
      ctx.fillStyle = '#19191A'
      const clockX = x + w / 2 + 2
      const clockY = y + (h - 810)
      if (this.timerHasDragged) {
        drawTimerDigits(ctx, clock, clockX, clockY, 120, 'reveal', '', (this.now - this.revealAt) / 1000)
      } else if (this.rollAt >= 0) {
        drawTimerDigits(ctx, clock, clockX, clockY, 120, 'roll', this.rollFrom, (this.now - this.rollAt) / 1000)
      } else {
        drawTimerDigits(ctx, clock, clockX, clockY, 120, 'still', '', 0)
      }
      const numberW = [...clock].reduce((sum, ch) => sum + timerSlot(ch, 120), 0)
      ctx.font = font(42)
      ctx.fillStyle = '#878891'
      ctx.textAlign = 'left'
      ctx.fillText('分钟', clockX + numberW / 2 + 30, y + (h - 789.5))
      ctx.textAlign = 'center'
    }
    if (!dragging) {
      ctx.fillStyle = DESC
      ctx.font = font(39)
      wrap(ctx, '设置定时时间\n点击以下区域可调整定时时长哦～', x + (w - 867) / 2, y + (h - 669), 867, 45, 'center')
    }
    const trackW = 867
    const trackH = 204
    const trackX = x + (w - trackW) / 2
    const trackY = y + (h - 438) - trackH / 2
    this.hit(trackX, trackY, trackW, trackH, 'twheel', () => null)
    const waveW = 690
    const waveH = 120
    const waveX = x + (w - waveW) / 2
    const waveY = trackY + (trackH - waveH) / 2
    blit(ctx, '/ui/ref/wave-base.svg', waveX, waveY, waveW, waveH)
    ctx.save()
    ctx.beginPath()
    ctx.rect(waveX, waveY, waveW * this.timerFill, waveH)
    ctx.clip()
    blit(ctx, '/ui/ref/wave-active.svg', waveX, waveY, waveW, waveH)
    ctx.restore()
    const pose = this.timerKnobReady
      ? { x: this.knobX.v, y: this.knobY.v, scale: this.knobS.v }
      : this.timerPose()
    const knobCx = x + w / 2 + pose.x
    const knobCy = trackY + trackH / 2 + pose.y
    const showClose = settled && minutes === 0 && !(active && !this.timerHasDragged)
    ctx.save()
    ctx.translate(knobCx, knobCy)
    ctx.scale(pose.scale, pose.scale)
    blit(ctx, showClose ? '/ui/ref/guanbi.png' : '/ui/ref/morendian.png', -162, -162, 324, 324)
    if (!settled) {
      ctx.fillStyle = '#19191A'
      const label = this.knobText || String(minutes)
      if (this.knobAt >= 0) drawTimerDigits(ctx, label, 0, 0, 58, 'roll', this.knobFrom, (this.now - this.knobAt) / 1000)
      else drawTimerDigits(ctx, label, 0, 0, 58, 'still', '', 0)
    }
    ctx.restore()
    const lit = !settled || (this.timerHasDragged && (minutes > 0 || active))
    const buttonW = 462
    const buttonH = 156
    const buttonX = x + (w - buttonW) / 2
    const buttonY = y + (h - 162) - buttonH / 2
    blit(ctx, lit ? '/ui/ref/shezhidingshib.png' : '/ui/ref/shezhidingshiweidianliang.png', buttonX, buttonY, buttonW, buttonH)
    this.hit(buttonX, buttonY, buttonW, buttonH, 'tconfirm', () => {
      if (!lit || this.timerPhase !== 'idle') return null
      this.panel = null
      this.panelClosing = false
      if (minutes <= 0) return { type: 'timer-cancel' }
      return { type: 'timer-start', seconds: minutes * 60 }
    })
  }

  private drawProfile(ctx: CanvasRenderingContext2D, ox: number, oy: number, pw: number, ph: number): void {
    const y = H * 0.08
    const h = H - y
    round(ctx, 0, y, W, h + 4, 96)
    ctx.fillStyle = '#F5F5FC'
    ctx.fill()
    this.hit(0, y, W, h, 'pcard', () => null)
    round(ctx, (W - 120) / 2, y + 24, 120, 12, 6)
    ctx.fillStyle = 'rgba(0,0,0,0.15)'
    ctx.fill()
    this.profile.draw(ctx, {
      now: this.now,
      modal: this.dialog != null,
      hit: (x, yy, w, hh, id, on) => this.hit(x, yy, w, hh, id, on),
      toast: (text) => this.toast(text),
      askLogout: () => this.openDialog('logout'),
      close: () => { this.dismissTop() },
    }, { ox, oy, pw, ph })
  }

  private drawModal(ctx: CanvasRenderingContext2D, input: UiInput, dy: number): void {
    const { pw, ph, ox, oy } = this.frame()
    ctx.fillStyle = this.dialog === 'guest' ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.8)'
    ctx.fillRect(0, 0, pw, ph)
    this.hit(0, 0, pw, ph, 'backdrop', () => null)
    const banks = input.banks
    if (banks.dialog !== 'none') {
      this.drawNotice(ctx, input, dy)
      return
    }
    if (!this.dialog) return
    if (this.dialog === 'guest') {
      const start = this.hits.length
      ctx.save()
      ctx.translate(ox, oy + dy)
      this.drawGuest(ctx)
      ctx.restore()
      this.shiftFrom(start, ox, oy + dy)
      return
    }
    const start = this.hits.length
    ctx.save()
    ctx.translate(ox, oy + dy)
    const card = this.dialogCopy()
    this.paintDialog(ctx, 70.5, 1018, card.title, card.body, card.primary, card.secondary, card.onPrimary, card.onSecondary, false)
    ctx.restore()
    this.shiftFrom(start, ox, oy + dy)
  }

  private drawGuest(ctx: CanvasRenderingContext2D): void {
    const body = '游客模式不留痕迹。登录后，你的每一次停留都会被温柔保存，并在设备间跟随你。让波萝记住你，而不是让你每次重新认识波萝。'
    const width = W - 240
    const x = 120
    ctx.font = font(39)
    const lines = wrapText(ctx, body, width - 168)
    const height = 90 + 228 + 66 + 60 + 42 + lines.length * 51 + 72 + 156 + 18 + 42 + 42
    const y = H - 120 - height
    round(ctx, x, y, width, height, 114)
    ctx.fillStyle = '#fff'
    ctx.fill()
    this.hit(x, y, width, height, 'gcard', () => null)
    blit(ctx, '/ui/mine/guest-heart.png', x + (width - 228) / 2, y + 90, 228, 228)
    ctx.fillStyle = INK
    ctx.font = font(60)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('你值得被记住', x + width / 2, y + 90 + 228 + 66 + 30)
    ctx.font = font(39)
    ctx.fillStyle = '#1F1F1F'
    ctx.textAlign = 'left'
    let lineY = y + 90 + 228 + 66 + 60 + 42 + 25
    for (const line of lines) {
      ctx.fillText(line, x + 84, lineY)
      lineY += 51
    }
    const buttonY = lineY + 72 - 25
    round(ctx, x + 84, buttonY, width - 168, 156, 78)
    ctx.fillStyle = INK
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.font = font(48)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('切换账号', x + width / 2, buttonY + 78)
    this.hit(x + 84, buttonY, width - 168, 156, 'glogin', () => {
      this.showLogin()
      return null
    })
    ctx.fillStyle = 'rgba(44,44,46,0.4)'
    ctx.font = font(42)
    ctx.fillText('下次再说', x + width / 2, buttonY + 156 + 18 + 21)
    this.hit(x + 84, buttonY + 156, width - 168, 80, 'glater', () => {
      this.dialog = null
      this.modalClosing = false
      return null
    })
  }

  private dialogCopy(): {
    title: string
    body: string
    primary: string
    secondary: string
    onPrimary: () => UiAction | null
    onSecondary: () => UiAction | null
  } {
    const close = () => {
      this.dialog = null
      this.modalClosing = false
      return null
    }
    if (this.dialog === 'logout') {
      return {
        title: '确定退出登录？',
        body: '',
        primary: '确定',
        secondary: '取消',
        onPrimary: () => {
          close()
          this.profile.logout()
          this.showLogin()
          return { type: 'logout' }
        },
        onSecondary: () => close(),
      }
    }
    if (this.dialog === 'save') {
      return {
        title: '是否保存修改？',
        body: '',
        primary: '保存退出',
        secondary: '放弃',
        onPrimary: () => { close(); return { type: 'save' } },
        onSecondary: () => close(),
      }
    }
    if (this.dialog === 'timer-end') {
      return {
        title: '定时时间到了~',
        body: '',
        primary: '重复定时',
        secondary: '取消',
        onPrimary: () => { close(); return { type: 'timer-repeat' } },
        onSecondary: () => { close(); return { type: 'timer-dismiss' } },
      }
    }
    return {
      title: '确定注销账号？',
      body: '',
      primary: '确定',
      secondary: '取消',
      onPrimary: () => { close(); this.profile.wipe(); return { type: 'cancel-account' } },
      onSecondary: () => close(),
    }
  }

  private drawNotice(ctx: CanvasRenderingContext2D, input: UiInput, dy: number): void {
    const d = input.banks.dialog
    const bytes = input.banks.pending.reduce((sum, name) => sum + (BANKS.find((b) => b.name === name)?.bytes ?? 0), 0)
    const size = sizeText(bytes)
    const progress = d === 'progress'
    const h = progress ? 957 : 1083
    const y = H - 120 - h
    const { ox, oy } = this.frame()
    const start = this.hits.length
    ctx.save()
    ctx.translate(ox, oy + dy)
    sheet(ctx, 96, y, 933, h, 123)
    this.hit(96, y, 933, h, 'card', () => null)
    ctx.fillStyle = INK
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = font(66)
    if (d === 'offline') {
      this.noticeText(ctx, y, '无网络连接', '当前设备无网络，无法下载资源包，请开启网络后继续')
      this.noticeButtons(ctx, y, '我知道了', '', () => ({ type: 'cancel-download' }), () => null)
    } else if (d === 'storage') {
      this.noticeText(ctx, y, '温馨提示', `设备存储空间不足，需至少预留${size}MB空间才能下载，建议清理存储空间后重试`)
      this.noticeButtons(ctx, y, '我知道了', '', () => ({ type: 'cancel-download' }), () => null)
    } else if (d === 'cellular') {
      this.noticeText(ctx, y, '正在使用蜂窝数据', `需要下载约 ${size}MB 音频资源，当前使用移动数据，下载可能产生流量费用。`)
      this.noticeButtons(ctx, y, '继续下载', '切换Wi-Fi后下载', () => ({ type: 'confirm-download', kind: 'cellular' }), () => ({ type: 'cancel-download' }))
    } else if (d === 'wifi') {
      this.noticeText(ctx, y, '温馨提示', `需要下载约 ${size} MB音频资源，当前已连接Wi-Fi，可放心下载`)
      this.noticeButtons(ctx, y, '立即下载', '稍后', () => ({ type: 'confirm-download', kind: 'wifi' }), () => ({ type: 'cancel-download' }))
    } else if (d === 'request') {
      this.noticeText(ctx, y, '前方区域未下载', `此区域需要额外下载资源包（约${size}MB），下载后即可进入并体验完整内容。`)
      this.noticeButtons(ctx, y, '立即下载', '返回', () => ({ type: 'confirm-download', kind: 'wifi' }), () => ({ type: 'cancel-download' }))
    } else if (progress) {
      ctx.fillText('场景资源加载中...', 562.5, y + 436)
      const active = Object.keys(input.banks.progress).find((name) => input.banks.states[name] === 'downloading')
      const ratio = active ? input.banks.progress[active] ?? 0 : 0
      const total = active ? (BANKS.find((b) => b.name === active)?.bytes ?? 0) / 1_000_000 : 0
      const done = total * ratio
      round(ctx, 180, y + 569, 609, 24, 12)
      ctx.fillStyle = '#E6E7EB'
      ctx.fill()
      round(ctx, 180, y + 569, Math.max(24, 609 * ratio), 24, 12)
      ctx.fillStyle = GREEN
      ctx.fill()
      ctx.fillStyle = INK
      ctx.font = font(36)
      ctx.textAlign = 'right'
      ctx.fillText(eta(done, total), 180 + 765, y + 581)
      ctx.textAlign = 'left'
      ctx.font = font(30)
      ctx.fillStyle = MUTED
      const lead = '正在为你下载资源：'
      ctx.fillText(lead, 180, y + 632)
      const leadW = ctx.measureText(lead).width
      ctx.fillStyle = GREEN
      const num = String(Math.round(done))
      ctx.fillText(num, 180 + leadW, y + 632)
      ctx.fillStyle = MUTED
      ctx.fillText(`MB/${Math.round(total)}MB  速度--MB/秒`, 180 + leadW + ctx.measureText(num).width + 4, y + 632)
      this.noticeButtons(ctx, y, '我知道了', '', () => ({ type: 'dismiss-download' }), () => null, true)
    }
    ctx.restore()
    this.shiftFrom(start, ox, oy + dy)
  }

  private noticeText(ctx: CanvasRenderingContext2D, y: number, title: string, body: string): void {
    ctx.fillStyle = INK
    ctx.font = font(66)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(title, 562.5, y + 436 + 38)
    ctx.font = font(39)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    wrap(ctx, body, 169, y + 573, 765, 52, 'left')
  }

  private noticeButtons(
    ctx: CanvasRenderingContext2D,
    y: number,
    primary: string,
    secondary: string,
    onPrimary: () => UiAction | null,
    onSecondary: () => UiAction | null,
    compact = false,
  ): void {
    const py = compact ? y + 745 : y + 745.5
    pill(ctx, 169, py, 765, 156, primary)
    this.hit(169, py, 765, 156, 'primary', onPrimary)
    if (!secondary) return
    ctx.fillStyle = 'rgba(0,0,0,0.588)'
    ctx.font = font(45)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(secondary, 562.5, y + 916 + 45)
    this.hit(169, y + 916, 765, 91, 'secondary', onSecondary)
  }

  private paintDialog(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    title: string,
    body: string,
    primary: string,
    secondary: string,
    onPrimary: () => UiAction | null,
    onSecondary: () => UiAction | null,
    centerBody: boolean,
  ): void {
    sheet(ctx, x, y, 984, 980, 123)
    this.hit(x, y, 984, 980, 'card', () => null)
    ctx.fillStyle = INK
    ctx.font = font(66)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(title, x + 492, y + 360 + 40)
    if (body) {
      ctx.font = font(centerBody ? 42 : 39)
      ctx.textAlign = centerBody ? 'center' : 'left'
      ctx.textBaseline = 'top'
      wrap(ctx, body, centerBody ? x + 54 : x + 54, y + 480, 876, 56, centerBody ? 'center' : 'left')
    }
    pill(ctx, x + 54, y + 680, 876, 156, primary)
    this.hit(x + 54, y + 680, 876, 156, 'primary', onPrimary)
    if (!secondary) return
    ctx.fillStyle = 'rgba(0,0,0,0.588)'
    ctx.font = font(45)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(secondary, x + 492, y + 860 + 45)
    this.hit(x + 54, y + 860, 876, 90, 'secondary', onSecondary)
  }

  private drawAgreement(ctx: CanvasRenderingContext2D): void {
    const { pw, ph, ox, oy } = this.frame()
    ctx.fillStyle = 'rgba(0,0,0,0.8)'
    ctx.fillRect(0, 0, pw, ph)
    this.hit(0, 0, pw, ph, 'backdrop', () => null)
    const start = this.hits.length
    ctx.save()
    ctx.translate(ox, oy)
    this.paintDialog(
      ctx,
      70.5,
      1018,
      '用户协议及隐私保护',
      '登录即表示您已阅读并同意《用户协议》和《隐私政策》',
      '我已阅读并同意',
      '不同意',
      () => ({ type: 'agree' }),
      () => null,
      true,
    )
    ctx.restore()
    this.shiftFrom(start, ox, oy)
  }

  private agreementPointer(phase: 'down' | 'move' | 'up', x: number, y: number, id: number): UiAction | null {
    if (phase === 'down') {
      this.downId = id
      const hit = this.top(x, y)
      this.downHit = hit?.id ?? ''
      return null
    }
    if (phase === 'up' && id === this.downId) {
      const hit = this.top(x, y)
      this.downId = -1
      if (hit && hit.id === this.downHit && hit.id !== 'backdrop' && hit.id !== 'card') return hit.on()
    }
    return null
  }

  private drawToast(ctx: CanvasRenderingContext2D): void {
    const text = this.input?.banks.toast || (this.now < this.toastUntil ? this.toastText : '')
    if (!text) return
    ctx.font = font(36)
    const { pw, ph } = this.frame()
    const w = Math.max(288, Math.min(666, ctx.measureText(text).width + 120))
    const x = (pw - w) / 2
    const y = ph / 2 - 69
    round(ctx, x, y, w, 138, 36)
    ctx.fillStyle = 'rgba(24,24,25,0.9)'
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, pw / 2, y + 69)
  }

  private hit(x: number, y: number, w: number, h: number, id: string, on: () => UiAction | null): void {
    this.hits.push({ x, y, w, h, id, on })
  }

  private top(x: number, y: number): Hit | undefined {
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i]
      if (x >= h.x && y >= h.y && x <= h.x + h.w && y <= h.y + h.h) return h
    }
    return undefined
  }
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const lines: string[] = []
  let line = ''
  const stick = '。，、；：！？,. '
  for (const char of text) {
    const next = line + char
    if (line && ctx.measureText(next).width > max && !stick.includes(char)) {
      lines.push(line)
      line = char
    } else {
      line = next
    }
  }
  if (line) lines.push(line)
  return lines
}

function stepSpring(s: Spring, dt: number, stiffness: number, damping: number): void {
  const omega = Math.sqrt(stiffness)
  const zeta = damping
  const x0 = s.v - s.to
  const wd = omega * Math.sqrt(Math.max(0, 1 - zeta * zeta))
  const decay = Math.exp(-zeta * omega * dt)
  const cos = Math.cos(wd * dt)
  const sin = Math.sin(wd * dt)
  const sinC = (zeta * omega * x0 + s.vel) / wd
  const disp = decay * (x0 * cos + sinC * sin)
  const vel = -zeta * omega * disp + decay * (-wd * x0 * sin + wd * sinC * cos)
  if (Math.abs(disp) < 0.01 && Math.abs(vel) < 0.625) {
    s.v = s.to
    s.vel = 0
    return
  }
  s.v = s.to + disp
  s.vel = vel
}

function springRest(s: Spring): boolean {
  return s.vel === 0 && s.v === s.to
}

function springUnit(elapsed: number, stiffness: number, damping: number): { value: number; done: boolean } {
  if (elapsed <= 0) return { value: 0, done: false }
  const omega = Math.sqrt(stiffness)
  const zeta = damping
  const wd = omega * Math.sqrt(Math.max(0, 1 - zeta * zeta))
  const decay = Math.exp(-zeta * omega * elapsed)
  const cos = Math.cos(wd * elapsed)
  const sin = Math.sin(wd * elapsed)
  const sinC = (-zeta * omega) / wd
  const disp = decay * (-cos + sinC * sin)
  const vel = -zeta * omega * disp + decay * (wd * sin + wd * sinC * cos)
  if (Math.abs(disp) < 0.001 && Math.abs(vel) < 0.0625) return { value: 1, done: true }
  return { value: 1 + disp, done: false }
}

function revealSettled(text: string, elapsed: number): boolean {
  for (let i = 0; i < text.length; i++) {
    if (!springUnit(elapsed - i * 0.07, 200, 0.7).done) return false
  }
  return true
}

function rollSettled(from: string, to: string, elapsed: number): boolean {
  let changed = false
  for (let i = 0; i < to.length; i++) {
    if (from[i] && from[i] !== to[i]) changed = true
  }
  if (!changed) return true
  if (elapsed < 0.11) return false
  return springUnit(elapsed, 230, 0.5).done && springUnit(elapsed, 260, 0.62).done
}

function fastOutSlowIn(t: number): number {
  if (t <= 0) return 0
  if (t >= 1) return 1
  let u = t
  const x1 = 0.4
  const x2 = 0.2
  for (let i = 0; i < 6; i++) {
    const inv = 1 - u
    const x = 3 * inv * inv * u * x1 + 3 * inv * u * u * x2 + u * u * u
    const dx = 3 * inv * inv * x1 + 6 * inv * u * (x2 - x1) + 3 * u * u * (1 - x2)
    if (Math.abs(dx) < 1e-6) break
    u = Math.max(0, Math.min(1, u - (x - t) / dx))
  }
  const inv = 1 - u
  return 3 * inv * u * u + u * u * u
}

function timerSlot(ch: string, size: number): number {
  if (ch === ':' || ch === '.') return size * 0.4
  if (ch === ' ') return size * 0.31
  return size * 0.72
}

function drawTimerDigits(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  size: number,
  kind: 'still' | 'reveal' | 'roll',
  from: string,
  elapsed: number,
): void {
  const chars = [...text]
  const widths = chars.map((ch) => timerSlot(ch, size))
  let x = cx - widths.reduce((sum, w) => sum + w, 0) / 2
  ctx.save()
  ctx.font = timerFont(size)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const slotH = size * 1.3
  const rise = size * (kind === 'reveal' ? 0.85 : 0.9)
  chars.forEach((ch, i) => {
    const w = widths[i]
    const mid = x + w / 2
    const prev = from[i]
    if (kind === 'reveal') {
      const p = springUnit(elapsed - i * 0.07, 200, 0.7).value
      ctx.save()
      ctx.globalAlpha = Math.max(0, Math.min(1, p))
      ctx.fillText(ch, mid, cy - (1 - p) * rise)
      ctx.restore()
    } else if (kind === 'roll' && prev && prev !== ch) {
      const fade = fastOutSlowIn(Math.max(0, Math.min(1, elapsed / 0.11)))
      const incoming = springUnit(elapsed, 230, 0.5).value
      const outgoing = springUnit(elapsed, 260, 0.62).value
      ctx.save()
      ctx.beginPath()
      ctx.rect(x, cy - slotH / 2, w, slotH)
      ctx.clip()
      ctx.globalAlpha = 1 - fade
      ctx.fillText(prev, mid, cy + outgoing * rise)
      ctx.globalAlpha = fade
      ctx.fillText(ch, mid, cy - (1 - incoming) * rise)
      ctx.restore()
    } else {
      ctx.fillText(ch, mid, cy)
    }
    x += w
  })
  ctx.restore()
}

function font(px: number): string {
  return `500 ${px}px "PingFang SC","PingFangSC-Medium","Hiragino Sans GB",sans-serif`
}

function timerFont(px: number): string {
  ensureTimerFont()
  return `800 ${px}px BoluoTimer,"PingFang SC",sans-serif`
}

let timerFontRequested = false
function ensureTimerFont(): void {
  if (timerFontRequested || typeof FontFace === 'undefined' || typeof document === 'undefined') return
  timerFontRequested = true
  const face = new FontFace('BoluoTimer', 'url(/ui/ref/sf-pro-rounded-heavy.ttf)')
  void face.load().then((loaded) => document.fonts.add(loaded)).catch(() => { timerFontRequested = false })
}

const sprites = new Map<string, HTMLImageElement>()
let spriteRev = 0

function sprite(src: string): HTMLImageElement | null {
  if (typeof Image === 'undefined') return null
  let image = sprites.get(src)
  if (!image) {
    image = new Image()
    image.onload = () => { spriteRev += 1 }
    image.src = src
    sprites.set(src, image)
  }
  return image.complete && image.naturalWidth > 0 ? image : null
}

function blit(ctx: CanvasRenderingContext2D, src: string, x: number, y: number, w: number, h: number): void {
  const image = sprite(src)
  if (image) ctx.drawImage(image, x, y, w, h)
}

function paint(ctx: CanvasRenderingContext2D, src: string, x: number, y: number, w: number, h: number, slice: number): void {
  if (!nine(ctx, src, x, y, w, h, slice, slice, slice, slice)) blit(ctx, src, x, y, w, h)
}

function nine(
  ctx: CanvasRenderingContext2D,
  src: string,
  x: number,
  y: number,
  w: number,
  h: number,
  left: number,
  right: number,
  top: number,
  bottom: number,
): boolean {
  const image = sprite(src)
  if (!image) return false
  const sw = image.naturalWidth
  const sh = image.naturalHeight
  const sr = sw - right
  const sb = sh - bottom
  const dw = Math.max(0, w - left - right)
  const dh = Math.max(0, h - top - bottom)
  // The UI canvas is scaled by a non-integer ratio, so abutting drawImage
  // calls leave a device-pixel crack. Overlap each interior edge by one
  // device pixel; outer edges stay put so the card doesn't grow.
  let scaleX = 1
  let scaleY = 1
  if (typeof ctx.getTransform === 'function') {
    const t = ctx.getTransform()
    scaleX = Math.abs(t.a) || 1
    scaleY = Math.abs(t.d) || 1
  }
  const ox = 1 / scaleX
  const oy = 1 / scaleY
  const cols = [
    { sx: 0, swid: left, dx: x, dwid: left },
    { sx: left, swid: Math.max(0, sr - left), dx: x + left, dwid: dw },
    { sx: sr, swid: right, dx: x + w - right, dwid: right },
  ]
  const rows = [
    { sy: 0, shei: top, dy: y, dhei: top },
    { sy: top, shei: Math.max(0, sb - top), dy: y + top, dhei: dh },
    { sy: sb, shei: bottom, dy: y + h - bottom, dhei: bottom },
  ]
  const liveCol = cols.map((col) => col.swid > 0 && col.dwid > 0)
  const liveRow = rows.map((row) => row.shei > 0 && row.dhei > 0)
  for (let r = 0; r < 3; r++) {
    if (!liveRow[r]) continue
    for (let c = 0; c < 3; c++) {
      if (!liveCol[c]) continue
      const col = cols[c]
      const row = rows[r]
      let dx = col.dx
      let dy = row.dy
      let dwid = col.dwid
      let dhei = row.dhei
      if (c > 0 && liveCol[c - 1]) { dx -= ox; dwid += ox }
      if (c < 2 && liveCol[c + 1]) dwid += ox
      if (r > 0 && liveRow[r - 1]) { dy -= oy; dhei += oy }
      if (r < 2 && liveRow[r + 1]) dhei += oy
      ctx.drawImage(image, col.sx, row.sy, col.swid, row.shei, dx, dy, dwid, dhei)
    }
  }
  return true
}

const PLAYING_FRAMES = 59
const playingImgs: HTMLImageElement[] = []
let playingPrimed = false
let playingSettled = 0
let playingEpoch: number | null = null
let lastPlaying: HTMLImageElement | null = null

function primePlaying(): void {
  if (playingPrimed || typeof Image === 'undefined') return
  playingPrimed = true
  const settle = () => { playingSettled += 1; spriteRev += 1 }
  for (let i = 1; i <= PLAYING_FRAMES; i++) {
    const src = `/ui/ref/playing/${String(i).padStart(5, '0')}.png`
    let image = sprites.get(src)
    if (!image) {
      image = new Image()
      image.onload = settle
      image.onerror = settle
      image.src = src
      sprites.set(src, image)
    } else if (image.complete) {
      playingSettled += 1
    } else {
      image.addEventListener('load', settle)
      image.addEventListener('error', settle)
    }
    playingImgs.push(image)
  }
}

function playingReady(image: HTMLImageElement | undefined): image is HTMLImageElement {
  return !!image && image.complete && image.naturalWidth > 0
}

function playingFrame(now: number): HTMLImageElement | null {
  primePlaying()
  // Keep the first decoded pose until the whole strip is in. Stepping through
  // holes in the cache is what flashes the icon on open.
  if (playingSettled < PLAYING_FRAMES) return playingImgs.find(playingReady) ?? null
  if (playingEpoch === null) playingEpoch = now
  const current = playingImgs[Math.floor((now - playingEpoch) / 40) % PLAYING_FRAMES]
  if (playingReady(current)) lastPlaying = current
  return lastPlaying
}

primePlaying()

let measureCanvas: CanvasRenderingContext2D | null | undefined
function textWidth(text: string, size: number): number {
  if (measureCanvas === undefined) {
    measureCanvas = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d')
  }
  if (!measureCanvas) return text.length * size
  measureCanvas.font = size >= 100 ? timerFont(size) : font(size)
  return measureCanvas.measureText(text).width
}

function nearest(margin: number): number {
  let best = 0
  let dist = Infinity
  LEVEL_ML.forEach((value, i) => {
    const d = Math.abs(margin - value)
    if (d < dist) {
      dist = d
      best = i
    }
  })
  return best
}

function sheet(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.08)'
  ctx.shadowBlur = 30
  ctx.fillStyle = '#fff'
  round(ctx, x, y, w, h, r)
  ctx.fill()
  ctx.restore()
}

function round(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

function pill(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, label: string): void {
  round(ctx, x, y, w, h, h / 2)
  ctx.fillStyle = '#19191A'
  ctx.fill()
  ctx.fillStyle = '#fff'
  ctx.font = font(50)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, x + w / 2, y + h / 2)
}

function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lineH: number, align: 'left' | 'center'): void {
  const cx = align === 'center' ? x + maxW / 2 : x
  ctx.textAlign = align
  let line = ''
  let yy = y
  for (const ch of text) {
    if (ch === '\n') {
      ctx.fillText(line, cx, yy)
      line = ''
      yy += lineH
      continue
    }
    const next = line + ch
    if (line && ctx.measureText(next).width > maxW) {
      ctx.fillText(line, cx, yy)
      line = ch
      yy += lineH
    } else line = next
  }
  if (line) ctx.fillText(line, cx, yy)
}

function ring(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, p: number): void {
  ctx.strokeStyle = 'rgba(24,24,25,0.28)'
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.stroke()
  ctx.strokeStyle = GREEN
  ctx.beginPath()
  ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0, Math.min(1, p)))
  ctx.stroke()
}

function downMark(ctx: CanvasRenderingContext2D, x: number, y: number, failed: boolean): void {
  ctx.strokeStyle = failed ? '#F32C2C' : INK
  ctx.lineWidth = 3
  ctx.strokeRect(x, y, 48, 48)
  ctx.beginPath()
  ctx.moveTo(x + 24, y + 10)
  ctx.lineTo(x + 24, y + 32)
  ctx.lineTo(x + 14, y + 22)
  ctx.moveTo(x + 24, y + 32)
  ctx.lineTo(x + 34, y + 22)
  ctx.stroke()
}

function eta(done: number, total: number): string {
  if (total <= 0.01) return ''
  if (done >= total - 0.05) return '完成'
  return ''
}

function sizeText(bytes: number): string {
  const mb = bytes / 1_000_000
  if (mb >= 10) return String(Math.round(mb))
  const text = mb.toFixed(1)
  return text.endsWith('.0') ? text.slice(0, -2) : text
}
