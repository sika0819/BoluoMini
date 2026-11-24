import { createHost } from '../host'
import { Renderer, type Tier } from '../gl/renderer'
import { skyLook, weatherGoal } from '../gl/sky'
import { identity } from '../gl/math'
import { actorMatrix, loadActor, type Actor } from '../actor/skin'
import { aimCamera, mascotFollow, steer, type Body } from '../actor/drive'
import { createCatchlights, updateCatchlights } from '../actor/highlight'
import { Ambience } from './audio'
import { Round } from './round'
import { BOOT_VIDEO, TRACKS } from './catalog'
import { BankDownload } from './download'
import { WALK_R } from '../scene/island'
import { buildSolids, canOccupy, footY, tryMove, type Solid } from '../scene/collide'
import { buildWorld, SCENE_SPAWN, type MeshData, type WorldMeshes } from '../scene/world'
import { screenToStage, stageFit } from '../ui/fit'
import { bindNet, cachedSession, currentUser, enterGuest, loginDouyinCode, loginWechatCode, logoutSession } from '../net/account'
import { deviceClock, fetchLiveSky, handDegrees, readClock, type LiveSky } from '../net/live'
import { Shell, STAGE_H, STAGE_W, type UiAction, type UiInput } from '../ui/shell'

const UNCOVER_MS = 5000
const IDLE_MS = 15000
const TIMER_SEC = 25 * 60
const PERIOD_NAME = ['清晨', '正午', '黄昏', '夜晚']
const LIVE_REFRESH_MS = 20 * 60 * 1000
/** 2π×2000. Whole turn for uWindTime coefficients 0.4, 0.5175, 0.7, and 1. */
const WIND_PHASE_WRAP = Math.PI * 4000
/** uRainTime * 8 over a rain column of 16, so this repeats one column. */
const RAIN_PHASE_WRAP = 2
function sunDir(azDeg: number, elDeg: number): number[] {
  const a = (azDeg * Math.PI) / 180
  const e = (elDeg * Math.PI) / 180
  const ce = Math.cos(e)
  return [Math.cos(a) * ce, Math.sin(e), Math.sin(a) * ce]
}

/** One meadow. Light matches beautiful-wonderland noon until the time control is used. */
const SCENE = {
  sun: sunDir(118, 56),
  sunColor: [1.04, 1.0, 0.92],
  fogDensity: 0.00145,
  weather: 'clear' as const,
  weatherLevel: 1,
  hours: 12,
}

const PERIOD_LOOK = [
  { sun: sunDir(158, 23), color: [1.1, 0.985, 0.8] },
  { sun: sunDir(118, 56), color: [1.04, 1.0, 0.92] },
  { sun: sunDir(176, 6.5), color: [1.17, 0.8, 0.6] },
  { sun: sunDir(180, -7.5), color: [0.6, 0.58, 0.86] },
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
  const showProfile = host.kind !== 'wechat' && host.kind !== 'douyin'
  const shell = new Shell(true, showProfile)
  const banks = new BankDownload(host)
  const ambience = new Ambience(host)
  const uiCanvas = host.uiCanvas(STAGE_W, STAGE_H)
  const uiCtx = uiCanvas.getContext('2d')
  if (!uiCtx) throw new Error('2d')
  let uiTex: WebGLTexture | null = null
  let bootLandscape = host.system().width >= host.system().height
  host.openBootVideo(bootLandscape ? BOOT_VIDEO.landscape : BOOT_VIDEO.portrait)

  let solids: Solid[] = buildSolids('meadow')
  const savedPos = readPos(host)
  const savedOnLand = savedPos != null
    && Math.hypot(savedPos.x, savedPos.z) < WALK_R
    && canOccupy(savedPos.x, savedPos.z, savedPos.x, savedPos.z, solids)
  const body: Body = {
    x: savedOnLand && savedPos ? savedPos.x : SCENE_SPAWN.x,
    z: savedOnLand && savedPos ? savedPos.z : SCENE_SPAWN.z,
    yaw: savedOnLand && savedPos ? savedPos.yaw : SCENE_SPAWN.yaw,
    camYaw: savedOnLand && savedPos ? savedPos.yaw : SCENE_SPAWN.yaw,
  }
  // The stick drives this outside a round. The pineapple then walks to a slot in front of it.
  const anchor: Body = { x: body.x, z: body.z, yaw: body.yaw, camYaw: body.camYaw }
  let controlled = false
  const glints = createCatchlights()
  const round = new Round()
  let huntAim = false
  ambience.onLevelStart = (seconds) => round.begin(seconds)
  let actor: Actor | null = null
  let walking = false
  const actorModel = new Float32Array(16)
  void host.download('actor/boluo.json').then((buf) => {
    actor = loadActor(new TextDecoder().decode(buf))
  }).catch(() => { /* meadow still runs if the mesh is missing */ })
  let weather: 'clear' | 'cloud' | 'rain' | 'fog' | 'wind' = SCENE.weather
  let weatherLevel = SCENE.weatherLevel
  let clock = deviceClock(Date.now())
  let live: LiveSky | null = null
  let followTime = true
  let followWeather = true
  let liveBusy = false
  let liveAt = 0
  const clearGoal = weatherGoal(SCENE.weather, SCENE.weatherLevel)
  const blend = {
    rain: clearGoal.rain,
    wind: clearGoal.wind,
    fog: SCENE.fogDensity * clearGoal.fogScale + clearGoal.fogAdd,
    mist: clearGoal.mist,
    cover: clearGoal.cover,
    flash: 0,
    nextFlash: 0,
  }
  let gustPhase = 0
  let windTime = 0
  let rainTime = 0
  let cloudDrift = 0
  let period = periodOf(readClock(clock, Date.now()).hours)
  let periodTouched = true
  let music = num(host.storageGet('boluo.music'), 0.8)
  let fx = num(host.storageGet('boluo.fx'), 0.8)
  let tier = (host.storageGet('boluo.tier') as Tier | null) || 'low'
  if (tier !== 'low' && tier !== 'mid' && tier !== 'high') tier = 'low'
  bindNet(host)
  let token = currentUser()?.token ?? null
  let playing = ''
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

  const noteGuestFail = () => {
    shell.toast(showProfile ? '游客登录失败，可在个人中心切换登录' : '登录失败')
  }
  void (async () => {
    const cached = await cachedSession()
    if (cached) {
      token = cached.token
      host.storageSet('boluo.guest', cached.token)
      return
    }
    if (host.kind === 'wechat' || host.kind === 'douyin') {
      const ticket = await host.login()
      if (ticket && (ticket.code || ticket.anonymousCode)) {
        try {
          const next = host.kind === 'wechat'
            ? await loginWechatCode(ticket.code)
            : await loginDouyinCode(ticket.code, ticket.anonymousCode)
          token = next.token
          host.storageSet('boluo.guest', next.token)
          return
        } catch {
          shell.toast('登录失败')
        }
      } else {
        shell.toast('登录失败')
      }
    }
    const guest = await enterGuest()
    if (!guest) {
      noteGuestFail()
      return
    }
    token = guest.token
    host.storageSet('boluo.guest', guest.token)
  })()

  host.onHide(() => { hidden = true; ambience.pause(); shell.openPauseTip() })
  host.onShow(() => { hidden = false })

  const mapToStage = (px: number, py: number) => screenToStage(px, py, host.stageBox())

  const apply = (action: UiAction | null) => {
    if (!action) return
    lastInput = host.now()
    ambience.resume()
      if (action.type === 'move') {
      // 摇杆 x 是画面右，y 是画面深处。长度已经是 0..1。
      moveX = action.x
      moveY = action.y
      joy = { x: action.x, y: action.y, active: action.x !== 0 || action.y !== 0 }
    } else if (action.type === 'weather') {
      weather = action.kind
      weatherLevel = action.level
      followWeather = false
    } else if (action.type === 'period') {
      period = (period + 1) % PERIOD_NAME.length
      periodTouched = true
      followTime = false
    } else if (action.type === 'live') {
      followTime = action.on
      followWeather = action.on
      if (action.on) {
        periodTouched = true
        if (live && live.label) {
          weather = live.weather
          weatherLevel = live.level
        }
      }
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
        round.hold()
        ambience.playLevel(playing)
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
          noteGuestFail()
        }
      })
    } else if (action.type === 'save') {
      host.storageSet('boluo.pos', JSON.stringify({ x: body.x, z: body.z, yaw: body.yaw, pitch: -0.12 }))
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
      if (!liveBusy && (liveAt === 0 || now - liveAt >= LIVE_REFRESH_MS)) pullLive(now)
      const tick = readClock(clock, Date.now())
      if (followTime) period = periodOf(tick.hours)
      const handDeg = followTime ? handDegrees(tick.hours) : ((period % 4) + 4) % 4 * 90
      const liveOn = followTime && followWeather
      const dt = Math.min(0.05, (now - last) / 1000)
      const prev = last
      last = now
      const preset = SCENE
      const level = Math.max(0, Math.min(3, weatherLevel))
      const goal = weatherGoal(weather, level)
      const k = 1 - Math.exp(-dt * 1.7)
      blend.rain += (goal.rain - blend.rain) * k
      blend.wind += (goal.wind - blend.wind) * k
      const fogGoal = preset.fogDensity * goal.fogScale + goal.fogAdd
      blend.fog += (fogGoal - blend.fog) * k
      blend.mist += (goal.mist - blend.mist) * k
      blend.cover += (goal.cover - blend.cover) * k
      gustPhase = wrapPhase(gustPhase + (0.35 + blend.wind * 0.22) * dt)
      const gust = 0.84 + 0.16 * Math.sin(gustPhase)
      const windAmp = blend.wind * gust
      windTime = wrapPhase(windTime + windAmp * dt, WIND_PHASE_WRAP)
      rainTime = wrapPhase(rainTime + blend.rain * dt, RAIN_PHASE_WRAP)
      cloudDrift += (0.012 + windAmp * 0.008) * dt
      if (blend.rain > 0.86) {
        if (blend.nextFlash <= 0) blend.nextFlash = now + 4000
        if (now >= blend.nextFlash) {
          blend.flash = 1
          blend.nextFlash = now + 4500 + Math.random() * 7000
        }
      } else if (blend.flash < 0.02) {
        blend.nextFlash = 0
      }
      blend.flash *= Math.exp(-dt * 11)
      const step = 10 * dt
      smoothX += Math.max(-step, Math.min(step, moveX - smoothX))
      smoothY += Math.max(-step, Math.min(step, moveY - smoothY))
      const playingRound = round.phase === 'step' || round.phase === 'hunt'
      if (playingRound && !controlled) {
        // The round just started. Keep the mascot where it stands and face the way the player was looking.
        body.yaw = anchor.yaw
        body.camYaw = anchor.camYaw
      }
      if (!playingRound && controlled) {
        anchor.x = body.x
        anchor.z = body.z
        anchor.yaw = body.yaw
        anchor.camYaw = body.camYaw
      }
      controlled = playingRound
      const slide = (x: number, z: number, nx: number, nz: number) => tryMove(x, z, nx, nz, solids)
      let speed01 = 0
      if (world) {
        if (playingRound) speed01 = steer(body, smoothX, smoothY, dt, slide, !huntAim)
        else {
          steer(anchor, smoothX, smoothY, dt, slide, true)
          speed01 = mascotFollow(body, anchor, dt, slide)
        }
      }
      if (speed01 > 0.15) walking = true
      else if (speed01 < 0.12) walking = false
      const feet = footY(body.x, body.z)
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
        renderer.loadFace('actor/face.png')
        world = buildWorld('meadow')
        ambience.setScene('meadow')
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
          period, panelW, panelH, handDeg, live: liveOn,
        })
        shell.draw(uiCtx, input)
        host.raf(frame)
        return
      }
      banks.tick(now)
      actor?.advance(dt, walking)
      const web = host.webAudio()
      const clockOn = !web || web.running()
      const roundHooks = {
        beep: web ? (freq: number, seconds: number) => web.beep(freq, seconds) : undefined,
        canOccupy: (x: number, z: number) => canOccupy(x, z, x, z, solids),
        ended: () => ambience.songOver(),
      }
      ambience.tickMusic(now, clockOn)
      round.update(clockOn ? dt : 0, body.x, body.z, body.yaw, roundHooks)
      ambience.setMusic(playing)
      if (ambience.songOver()) round.fail()
      const played = round.view(roundHooks)
      huntAim = played.aimYaw != null
      if (played.aimYaw != null && playingRound) aimCamera(body, played.aimYaw, dt)
      const focus = playingRound ? body : anchor
      const focusFeet = playingRound ? feet : footY(anchor.x, anchor.z)
      ambience.update(
        now, focus.x, focusFeet + 1.55, focus.z,
        Math.sin(focus.yaw), 0, Math.cos(focus.yaw),
        weather, weatherLevel, period,
      )
      const eye = [
        focus.x - Math.sin(focus.camYaw) * 7,
        focusFeet + 3.2,
        focus.z - Math.cos(focus.camYaw) * 7,
      ]
      const target = [focus.x, focusFeet + 0.9, focus.z]
      ambience.setVolumes(music, fx)
      const idle = now - lastInput > IDLE_MS ? Math.min(1, (now - lastInput - IDLE_MS) / 1000) : 0
      const iris = irisAlpha(now, irisFrom, irisUntil)
      const input = makeInput(now, host, {
        uncovered, progress, preset, weather, weatherLevel, music, fx, playing, timerLeft, timerRunning,
        idle, iris, joy, banks: banks.snapshot(), loggedIn: !!token, tier,
        period, panelW, panelH, handDeg, live: liveOn,
        scoreText: played.scoreText, phaseText: played.phaseText,
      })
      if (shell.draw(uiCtx, input) && uiTex) renderer.updateUi(uiTex, uiCanvas)
      const scene = world
      const push = (mesh: MeshData, list: { mesh: MeshData; model: Float32Array }[]) => {
        if (mesh.indices.length >= 3 && mesh.interleaved.length >= 36) list.push({ mesh, model })
      }
      const items: { mesh: MeshData; model: Float32Array }[] = []
      for (const mesh of scene.pieces) push(mesh, items)
      if (blend.rain > 0.03) push(scene.rain, items)
      if (actor) {
        actorMatrix(actorModel, body.x, feet, body.z, body.yaw)
        items.push({ mesh: actor.mesh, model: actorModel })
        updateCatchlights(glints, actor, { x: body.x, y: feet, z: body.z, yaw: body.yaw }, {
          x: eye[0], y: eye[1], z: eye[2],
        })
        items.push({ mesh: glints, model })
      }
      for (const item of played.items) items.push(item)
      const outline: { mesh: MeshData; model: Float32Array }[] = []
      if (tier === 'high') {
        for (const mesh of scene.pieces) {
          if (mesh.role === 'ground' || mesh.role === 'tree') push(mesh, outline)
        }
      }
      const look = skyLook(period)
      const wetFog = [
        look.hor[0] * 0.55 + 0.18,
        look.hor[1] * 0.55 + 0.2,
        look.hor[2] * 0.55 + 0.22,
      ]
      const mistFog = [
        look.hor[0] * 0.72 + 0.22,
        look.hor[1] * 0.74 + 0.24,
        look.hor[2] * 0.76 + 0.24,
      ]
      let fogColor = mix3(look.hor, wetFog, blend.rain)
      fogColor = mix3(fogColor, mistFog, blend.mist * (1 - blend.rain * 0.5))
      const flash = blend.flash
      fogColor = fogColor.map((c) => Math.min(1, c + flash * 0.28))
      const sunScale = 1 + flash * 0.55
      const sunColor = (periodTouched ? PERIOD_LOOK[period].color : preset.sunColor)
        .map((c) => c * sunScale)
      renderer.draw({
        eye, target,
        sun: normalize(periodTouched ? PERIOD_LOOK[period].sun : preset.sun),
        sunColor,
        fogColor,
        fogDensity: blend.fog,
        shadeSteps: tier === 'low' ? 3 : 4,
        time: now / 1000,
        tier: uncovered ? tier : 'low',
        rain: blend.rain,
        mist: blend.mist,
        flash,
        wind: windAmp,
        windTime,
        rainTime,
        cloudDrift,
        period,
        cover: blend.cover,
        dim: 0,
        items,
        outline,
      }, { texture: host.uiOnScreen ? null : uiTex, alpha: 1 })
      if (Math.floor(now / 2000) !== Math.floor(prev / 2000)) {
        host.storageSet('boluo.pos', JSON.stringify({ x: body.x, z: body.z, yaw: body.yaw, pitch: -0.12 }))
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

  function pullLive(now: number): void {
    liveBusy = true
    liveAt = now
    void fetchLiveSky().then((sky) => {
      if (Number.isFinite(sky.clock.wallMs)) clock = sky.clock
      if (sky.label && followWeather) {
        live = sky
        weather = sky.weather
        weatherLevel = sky.level
      } else if (sky.label) {
        live = sky
      } else {
        liveAt = host.now() - LIVE_REFRESH_MS + 60000
      }
    }).catch(() => {
      liveAt = host.now() - LIVE_REFRESH_MS + 60000
    }).finally(() => { liveBusy = false })
  }
}

function wrapPhase(phase: number, period = Math.PI * 2): number {
  return phase < period ? phase : phase % period
}

function irisAlpha(now: number, from: number, until: number): number {
  if (!from || now >= until) return 0
  const t = (now - from) / 1000
  if (t < 2) return t / 2
  if (t < 3.5) return 1
  if (t < 5.66) return 1 - (t - 3.5) / 2.16
  return 0
}

function mix3(a: number[], b: number[], t: number): number[] {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ]
}

function normalize(v: number[]): number[] {
  const len = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / len, v[1] / len, v[2] / len]
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
    preset: { sun: number[]; sunColor: number[]; fogDensity: number }
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
    handDeg: number
    live: boolean
    scoreText?: string
    phaseText?: string
  },
): UiInput {
  const capsule = host.system().capsule
  const track = TRACKS.find((t) => t.name === s.playing)
  return {
    now,
    loading: !s.uncovered,
    progress: s.progress,
    presetId: 'meadow',
    presetLabel: '',
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
    handDeg: s.handDeg,
    live: s.live,
    scoreText: s.scoreText ?? '',
    phaseText: s.phaseText ?? '',
    idleAlpha: s.idle,
    iris: s.iris,
    joystick: s.joy,
    banks: s.banks,
    loggedIn: s.loggedIn,
    capsulePad: capsule ? 80 : 0,
  }
}
