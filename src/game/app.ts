import { createHost } from '../host'
import { Renderer, type Tier } from '../gl/renderer'
import { skyCover, skyLook } from '../gl/sky'
import { identity } from '../gl/math'
import { Ambience } from './audio'
import { BOOT_VIDEO, PRESETS, TRACKS } from './catalog'
import { BankDownload } from './download'
import { setActivePreset } from '../scene/island'
import { WINDOW_R } from '../scene/data/layout.gen'
import { buildSolids, canOccupy, EYE_HEIGHT, footY, MOVE_SPEED, STICK_YAW_SPEED, tryMove, type Solid } from '../scene/collide'
import { buildWorld, SCENE_SPAWN, type MeshData, type WorldMeshes } from '../scene/world'
import { screenToStage, stageFit } from '../ui/fit'
import { bindNet, bootSession, currentUser, enterGuest, logoutSession } from '../net/account'
import { Shell, STAGE_H, STAGE_W, type UiAction, type UiInput } from '../ui/shell'

const UNCOVER_MS = 5000
const IDLE_MS = 15000
const TIMER_SEC = 25 * 60
const PERIOD_NAME = ['清晨', '正午', '黄昏', '夜晚']
const PERIOD_LOOK = [
  { sun: [0.45, 0.4, 0.25], color: [1, 0.78, 0.52] },
  { sun: [0.15, 0.95, 0.2], color: [1, 0.97, 0.88] },
  { sun: [-0.35, 0.28, 0.25], color: [1, 0.55, 0.35] },
  { sun: [-0.2, 0.15, 0.4], color: [0.45, 0.5, 0.75] },
]

function periodOf(hours: number): number {
  if (hours < 10) return 0
  if (hours < 16) return 1
  if (hours < 20) return 2
  return 3
}

export function start(): void {
  const host = createHost()
  let renderer: Renderer | null = null
  let world: WorldMeshes | null = null
  const shell = new Shell(true)
  const banks = new BankDownload(host)
  const ambience = new Ambience(host)
  const uiCanvas = host.uiCanvas(STAGE_W, STAGE_H)
  const uiCtx = uiCanvas.getContext('2d')
  if (!uiCtx) throw new Error('2d')
  let uiTex: WebGLTexture | null = null
  let bootLandscape = host.system().width >= host.system().height
  host.openBootVideo(bootLandscape ? BOOT_VIDEO.landscape : BOOT_VIDEO.portrait)

  let presetIndex = 0
  setActivePreset(PRESETS[0].scene)
  let solids: Solid[] = buildSolids(PRESETS[0].scene)
  const bootSpawn = SCENE_SPAWN[PRESETS[0].scene]
  const savedPos = readPos(host)
  const savedOnLand = savedPos != null
    && Math.hypot(savedPos.x, savedPos.z) < WINDOW_R
    && canOccupy(savedPos.x, savedPos.z, savedPos.x, savedPos.z, solids)
  const cam = {
    x: savedOnLand && savedPos ? savedPos.x : bootSpawn.x,
    z: savedOnLand && savedPos ? savedPos.z : bootSpawn.z,
    yaw: savedOnLand && savedPos ? savedPos.yaw : bootSpawn.yaw,
    pitch: savedOnLand && savedPos ? savedPos.pitch ?? -0.28 : -0.28,
  }
  let weather: 'clear' | 'cloud' | 'rain' | 'fog' | 'wind' = PRESETS[0].weather
  let weatherLevel = PRESETS[0].weatherLevel
  let period = periodOf(PRESETS[0].hours)
  let periodTouched = false
  let music = num(host.storageGet('boluo.music'), 0.8)
  let fx = num(host.storageGet('boluo.fx'), 0.8)
  let tier = (host.storageGet('boluo.tier') as Tier | null) || 'low'
  if (tier !== 'low' && tier !== 'mid' && tier !== 'high') tier = 'low'
  bindNet(host)
  let token = currentUser()?.token ?? null
  let playing = initialTrack(host.storageGet('boluo.track'))
  ambience.setMusic(playing)
  let timerLeft = num(host.storageGet('boluo.timer'), TIMER_SEC)
  let timerArmed = TIMER_SEC
  let timerRunning = false
  let moveX = 0
  let moveY = 0
  let smoothX = 0
  let smoothY = 0
  let joy = { x: 0, y: 0, active: false }
  let lastInput = host.now()
  let uncovered = false
  const boot = host.now()
  let irisUntil = 0
  let irisFrom = 0
  let hidden = false
  const model = new Float32Array(16)
  identity(model)

  void bootSession().then((user) => {
    if (!user) {
      shell.toast('游客登录失败，可在个人中心切换登录')
      return
    }
    token = user.token
    host.storageSet('boluo.guest', user.token)
  })

  host.onHide(() => { hidden = true; ambience.pause(); shell.openPauseTip() })
  host.onShow(() => { hidden = false })

  const dropWorld = (prev: WorldMeshes | null) => {
    if (!prev || !renderer) return
    for (const mesh of [
      prev.terrain, prev.water, prev.grass, prev.trees, prev.rocks, prev.cabin,
      prev.clouds, prev.river, prev.lake, prev.falls, prev.props, prev.rain, prev.fire,
    ]) renderer.drop(mesh)
  }

  const applyPreset = (idx: number, iris: boolean) => {
    const next = PRESETS[idx]
    const prevScene = PRESETS[presetIndex].scene
    presetIndex = idx
    weather = next.weather
    weatherLevel = next.weatherLevel
    period = periodOf(next.hours)
    periodTouched = false
    if (iris) {
      irisFrom = host.now()
      irisUntil = irisFrom + (2 + 0.5 + 1 + 2 + 0.16) * 1000
    }
    solids = buildSolids(next.scene)
    if (world && renderer && next.scene !== prevScene) {
      dropWorld(world)
      world = buildWorld(next.scene)
      ambience.setScene(next.scene)
    }
    const spawn = SCENE_SPAWN[next.scene]
    cam.x = spawn.x
    cam.z = spawn.z
    cam.yaw = spawn.yaw
    cam.pitch = -0.28
  }

  const mapToStage = (px: number, py: number) => screenToStage(px, py, host.stageBox())

  const apply = (action: UiAction | null) => {
    if (!action) return
    lastInput = host.now()
    ambience.resume()
    if (action.type === 'move') {
      // 摇杆 x 转向、y 前进。死区外的长度已经是 0..1。
      moveX = action.x
      moveY = action.y
      joy = { x: action.x, y: action.y, active: action.x !== 0 || action.y !== 0 }
    } else if (action.type === 'weather') {
      weather = action.kind
      weatherLevel = action.level
    } else if (action.type === 'period') {
      period = (period + 1) % PERIOD_NAME.length
      periodTouched = true
    } else if (action.type === 'preset') {
      const idx = PRESETS.findIndex((p) => p.id === action.id)
      if (idx >= 0 && idx !== presetIndex) applyPreset(idx, true)
    } else if (action.type === 'volume') {
      music = action.music
      fx = action.fx
      host.storageSet('boluo.music', String(music))
      host.storageSet('boluo.fx', String(fx))
      ambience.setVolumes(music, fx)
    } else if (action.type === 'play') {
      if (banks.isReady(action.name)) {
        playing = action.name
        host.storageSet('boluo.track', playing)
        ambience.setMusic(playing)
      } else banks.request([action.name], host.now())
    } else if (action.type === 'download') {
      banks.request(action.names, host.now(), !!action.quiet)
    } else if (action.type === 'confirm-download') {
      banks.confirm(action.kind)
    } else if (action.type === 'cancel-download') {
      banks.cancel()
    } else if (action.type === 'dismiss-download') {
      banks.hideDialog()
    } else if (action.type === 'resume') {
      ambience.resume()
    } else if (action.type === 'timer-start') {
      timerArmed = action.seconds
      timerLeft = action.seconds
      timerRunning = true
    } else if (action.type === 'timer-cancel') {
      timerRunning = false
    } else if (action.type === 'timer-repeat') {
      timerLeft = timerArmed
      timerRunning = true
    } else if (action.type === 'timer-dismiss') {
      timerRunning = false
    } else if (action.type === 'logout') {
      ambience.stopAll()
      void logoutSession().then((user) => {
        token = user?.token ?? null
        if (user) host.storageSet('boluo.guest', user.token)
        else {
          host.storageRemove('boluo.guest')
          shell.toast('游客登录失败，可在个人中心切换登录')
        }
      })
    } else if (action.type === 'save') {
      host.storageSet('boluo.pos', JSON.stringify(cam))
    } else if (action.type === 'agree') {
      host.storageSet('boluo.agree', '1')
    } else if (action.type === 'tier') {
      tier = tier === 'low' ? 'mid' : tier === 'mid' ? 'high' : 'low'
      host.storageSet('boluo.tier', tier)
      try { renderer?.compileTier(tier) } catch { tier = 'low' }
    } else if (action.type === 'cancel-account') {
      host.storageRemove('boluo.pos')
      void enterGuest().then((user) => {
        token = user?.token ?? null
        if (user) host.storageSet('boluo.guest', user.token)
        else host.storageRemove('boluo.guest')
      })
    }
  }

  host.onTouch(
    (p) => { const s = mapToStage(p.x, p.y); apply(shell.pointer('down', s.x, s.y, p.id)) },
    (p) => { const s = mapToStage(p.x, p.y); apply(shell.pointer('move', s.x, s.y, p.id)) },
    (p) => { const s = mapToStage(p.x, p.y); apply(shell.pointer('up', s.x, s.y, p.id)) },
  )

  let last = host.now()
  let fpsFrames = 0
  let fpsWindow = last
  const fpsEl = typeof document !== 'undefined' ? document.getElementById('fps') : null
  const frame = (now: number) => {
    try {
    if (fpsEl) {
      fpsFrames += 1
      const span = now - fpsWindow
      if (span >= 500) {
        fpsEl.textContent = `${Math.round(fpsFrames * 1000 / span)} fps`
        fpsFrames = 0
        fpsWindow = now
      }
    }
    const sys = host.system()
    if (!uncovered) {
      const landscape = sys.width >= sys.height
      if (landscape !== bootLandscape) {
        bootLandscape = landscape
        host.openBootVideo(landscape ? BOOT_VIDEO.landscape : BOOT_VIDEO.portrait)
      }
    }
    const fit = stageFit(sys.width, sys.height)
    const panelW = Math.max(2, Math.round(fit.panelW))
    const panelH = Math.max(2, Math.round(fit.panelH))
    const uiDpr = Math.min(Math.max(sys.dpr, 1), 1.5)
    const bufW = Math.max(2, Math.round(Math.min(panelW, sys.width * uiDpr)))
    const bufH = Math.max(2, Math.round(Math.min(panelH, sys.height * uiDpr)))
    if (uiCanvas.width !== bufW) uiCanvas.width = bufW
    if (uiCanvas.height !== bufH) uiCanvas.height = bufH
    uiCtx.setTransform(bufW / panelW, 0, 0, bufH / panelH, 0, 0)
    if (!hidden) {
      const dt = Math.min(0.05, (now - last) / 1000)
      const prev = last
      last = now
      const preset = PRESETS[presetIndex]
      const sceneWeather = weather === 'wind' ? 'cloud' : weather
      const rain = sceneWeather === 'rain' && weatherLevel > 0
      const step = 10 * dt
      smoothX += Math.max(-step, Math.min(step, moveX - smoothX))
      smoothY += Math.max(-step, Math.min(step, moveY - smoothY))
      // Unity 正 yaw 朝玩家右侧。这边 lookAt 是右手系，同样的正 yaw 会把画面转向左边。
      cam.yaw -= smoothX * (STICK_YAW_SPEED * Math.PI / 180) * dt
      const speed = smoothY * MOVE_SPEED * dt
      if (world) {
        const next = tryMove(
          cam.x, cam.z,
          cam.x + Math.sin(cam.yaw) * speed,
          cam.z + Math.cos(cam.yaw) * speed,
          solids,
        )
        cam.x = next.x
        cam.z = next.z
      }
      const eyeY = footY(cam.x, cam.z) + EYE_HEIGHT
      const eye = [cam.x, eyeY, cam.z]
      const target = [
        cam.x + Math.sin(cam.yaw) * Math.cos(cam.pitch),
        eyeY + Math.sin(cam.pitch),
        cam.z + Math.cos(cam.yaw) * Math.cos(cam.pitch),
      ]
      if (timerRunning) {
        timerLeft -= dt
        if (timerLeft <= 0) {
          timerLeft = 0
          timerRunning = false
        }
      }
      const sinceBoot = now - boot
      const progress = Math.min(1, sinceBoot / 1200)
      if (!uncovered && (progress >= 1 || sinceBoot >= UNCOVER_MS)) {
        host.closeBootVideo()
        renderer = new Renderer(host)
        renderer.loadLeaf('oil/brush.png')
        world = buildWorld(PRESETS[presetIndex].scene)
        ambience.setScene(PRESETS[presetIndex].scene)
        if (!host.uiOnScreen) uiTex = renderer.uploadUi(uiCanvas)
        uncovered = true
        host.launchSuccess()
        ambience.uncover()
        ambience.setVolumes(music, fx)
        try { renderer.compileTier(tier) } catch { tier = 'low' }
      }
      if (!world || !renderer) {
        ambience.pump()
        const input = makeInput(now, host, {
          uncovered, progress, preset, weather, weatherLevel, music, fx, playing, timerLeft, timerRunning,
          idle: 0, iris: 0, joy, banks: banks.snapshot(), loggedIn: !!token, tier,
          period, panelW, panelH,
        })
        shell.draw(uiCtx, input)
        host.raf(frame)
        return
      }
      banks.tick(now)
      ambience.setMusic(playing)
      ambience.update(
        now, eye[0], eye[1], eye[2],
        target[0] - eye[0], target[1] - eye[1], target[2] - eye[2],
        weather, weatherLevel,
      )
      const idle = now - lastInput > IDLE_MS ? Math.min(1, (now - lastInput - IDLE_MS) / 1000) : 0
      const iris = irisAlpha(now, irisFrom, irisUntil)
      const input = makeInput(now, host, {
        uncovered, progress, preset, weather, weatherLevel, music, fx, playing, timerLeft, timerRunning,
        idle, iris, joy, banks: banks.snapshot(), loggedIn: !!token, tier,
        period, panelW, panelH,
      })
      if (shell.draw(uiCtx, input) && uiTex) renderer.updateUi(uiTex, uiCanvas)
      const scene = world
      const push = (mesh: MeshData, list: { mesh: MeshData; model: Float32Array }[]) => {
        if (mesh.indices.length >= 3 && mesh.interleaved.length >= 36) list.push({ mesh, model })
      }
      const items: { mesh: MeshData; model: Float32Array }[] = []
      push(scene.terrain, items)
      push(scene.water, items)
      push(scene.river, items)
      push(scene.lake, items)
      push(scene.grass, items)
      push(scene.trees, items)
      push(scene.rocks, items)
      push(scene.cabin, items)
      push(scene.props, items)
      push(scene.falls, items)
      push(scene.clouds, items)
      // Campfire flame lives in props (Huodui); legacy fire mesh kept for drop/compat.
      push(scene.fire, items)
      if (rain) push(scene.rain, items)
      const outline: { mesh: MeshData; model: Float32Array }[] = []
      if (tier === 'high') {
        push(scene.terrain, outline)
        push(scene.trees, outline)
        push(scene.rocks, outline)
        push(scene.cabin, outline)
        push(scene.props, outline)
      }
      const look = skyLook(period)
      const rainy = weather === 'rain'
      renderer.draw({
        eye, target,
        sun: normalize(periodTouched ? PERIOD_LOOK[period].sun : preset.sun),
        sunColor: periodTouched ? PERIOD_LOOK[period].color : preset.sunColor,
        fogColor: rainy
          ? [look.hor[0] * 0.55 + 0.18, look.hor[1] * 0.55 + 0.2, look.hor[2] * 0.55 + 0.22]
          : look.hor,
        fogDensity: preset.fogDensity + (sceneWeather === 'fog' ? 0.02 * weatherLevel : weather === 'wind' ? 0.008 * weatherLevel : 0),
        shadeSteps: tier === 'low' ? 3 : 4,
        time: now / 1000,
        tier: uncovered ? tier : 'low',
        rain: rainy,
        period,
        cover: skyCover(weather),
        items,
        outline,
      }, { texture: host.uiOnScreen ? null : uiTex, alpha: 1 })
      if (Math.floor(now / 2000) !== Math.floor(prev / 2000)) {
        host.storageSet('boluo.pos', JSON.stringify(cam))
        host.storageSet('boluo.timer', String(timerLeft))
      }
    }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (typeof document !== 'undefined') document.title = msg
    }
    host.raf(frame)
  }
  host.raf(frame)
}

function irisAlpha(now: number, from: number, until: number): number {
  if (!from || now >= until) return 0
  const t = (now - from) / 1000
  if (t < 2) return t / 2
  if (t < 3.5) return 1
  if (t < 5.66) return 1 - (t - 3.5) / 2.16
  return 0
}

function normalize(v: number[]): number[] {
  const len = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / len, v[1] / len, v[2] / len]
}

function initialTrack(raw: string | null): string {
  if (raw && TRACKS.some((track) => track.name === raw && track.src)) return raw
  return 'Music1_1'
}

function num(raw: string | null, fallback: number): number {
  const n = raw == null ? NaN : Number(raw)
  return Number.isFinite(n) ? n : fallback
}

function readPos(host: { storageGet(key: string): string | null }): { x: number; z: number; yaw: number; pitch: number } | null {
  try {
    const raw = host.storageGet('boluo.pos')
    if (!raw) return null
    return JSON.parse(raw) as { x: number; z: number; yaw: number; pitch: number }
  } catch { return null }
}

function makeInput(
  now: number,
  host: { system(): { capsule: { width: number; x: number } | null } },
  s: {
    uncovered: boolean
    progress: number
    preset: typeof PRESETS[number]
    weather: 'clear' | 'cloud' | 'rain' | 'fog' | 'wind'
    weatherLevel: number
    music: number
    fx: number
    playing: string
    timerLeft: number
    timerRunning: boolean
    idle: number
    iris: number
    joy: { x: number; y: number; active: boolean }
    banks: ReturnType<BankDownload['snapshot']>
    loggedIn: boolean
    tier: Tier
    period: number
    panelW: number
    panelH: number
  },
): UiInput {
  const capsule = host.system().capsule
  const track = TRACKS.find((t) => t.name === s.playing)
  return {
    now,
    loading: !s.uncovered,
    progress: s.progress,
    presetId: s.preset.id,
    presetLabel: s.preset.label,
        weather: s.weather,
    weatherLevel: s.weatherLevel,
    music: s.music,
    fx: s.fx,
    trackName: track?.label ?? '',
    playing: !!s.playing,
    timerLeft: s.timerLeft,
    timerRunning: s.timerRunning,
    period: s.period,
    panelW: s.panelW,
    panelH: s.panelH,
    idleAlpha: s.idle,
    iris: s.iris,
    joystick: s.joy,
    banks: s.banks,
    loggedIn: s.loggedIn,
    capsulePad: capsule ? 80 : 0,
  }
}
