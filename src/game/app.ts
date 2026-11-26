import { createHost } from '../host'
import { Renderer, type Tier } from '../gl/renderer'
import { periodUtc, skyBodies } from '../gl/astro'
import { skyLook, weatherGoal } from '../gl/sky'
import { identity, lookAt, multiply, perspective } from '../gl/math'
import { ACTOR_LIFT, ACTOR_SCALE, actorMatrix, loadActor, type Actor } from '../actor/skin'
import { LENS_BACK, aimCamera, driveCamera, lensSlot, mascotFollow, steer, type Body } from '../actor/drive'
import { createCatchlights, updateCatchlights } from '../actor/highlight'
import { Wardrobe } from '../actor/costume'
import { outfitById, readOwned, readWorn, writeOwned, writeWorn } from '../game/outfits'
import { Ambience } from './audio'
import { Round } from './round'
import { TourPilot, type DanceKind } from './tourMotion'
import { ALBUMS, BOOT_VIDEO, TRACKS } from './catalog'
import { BankDownload } from './download'
import { WALK_R } from '../scene/island'
import { buildSolids, canOccupy, footY, tryMove, type Solid } from '../scene/collide'
import { buildWorld, SCENE_SPAWN, type MeshData, type WorldMeshes } from '../scene/world'
import { aimFlame, campfireFlame, campfireLight } from '../scene/campfire'
import { screenToStage, stageFit } from '../ui/fit'
import { bindNet, cachedSession, currentUser, enterGuest, guestLoginOpen, loginDouyinCode, loginWechatCode, logoutSession } from '../net/account'
import { deviceClock, deviceGeo, fetchLiveSky, handDegrees, readClock, type LiveSky } from '../net/live'
import { Shell, STAGE_H, STAGE_W, type PlayMode, type UiAction, type UiInput } from '../ui/shell'

const UNCOVER_MS = 5000
const IDLE_MS = 15000
/** Draw spacing once the HUD is down and nothing is playing. Sway and breath stay smooth here. */
const REST_MS = 80
const TIMER_SEC = 25 * 60
const PERIOD_NAME = ['清晨', '正午', '黄昏', '夜晚']
const LIVE_REFRESH_MS = 20 * 60 * 1000
/** 2π×2000. Whole turn for uWindTime coefficients 0.4, 0.5175, 0.7, and 1. */
const WIND_PHASE_WRAP = Math.PI * 4000
/** uRainTime * 8 over a rain column of 16, so this repeats one column. */
const RAIN_PHASE_WRAP = 2
/** Sky fbm octaves repeat every 7, 14 and 28 cells. Wrapping here is seamless. */
const CLOUD_DRIFT_WRAP = 28
/** Slow vertical crawl. One wrap is a cloud shift, many hours apart. */
const CLOUD_LIFT_WRAP = 224
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

const PERIOD_COLOR = [
  [1.1, 0.985, 0.8],
  [1.04, 1.0, 0.92],
  [1.17, 0.8, 0.6],
  [0.6, 0.58, 0.86],
]

function periodOf(hours: number): number {
  if (hours < 10) return 0
  if (hours < 16) return 1
  if (hours < 20) return 2
  return 3
}

/** 22:00 躺下，一直保持到 07:00，整点起身回到默认站立。 */
function asleepHours(hours: number): boolean {
  const h = Math.floor(hours)
  return h >= 22 || h < 7
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
  // Outside a round the stick drives this lens. The pineapple walks to a slot in front of it.
  const anchor: Body = { x: body.x, z: body.z, yaw: body.yaw, camYaw: body.camYaw }
  const glints = createCatchlights()
  const round = new Round()
  let huntAim = false
  const pilot = new TourPilot()
  let tourPhase: 'off' | 'enter' | 'lead' | 'leave' | 'ask' = 'off'
  let leaveTo: 'ask' | 'off' = 'off'
  let blendT = 0
  let leaveAge = 0
  let songReady = false
  let enterYaw = 0
  ambience.onLevelStart = () => { songReady = true }
  let actor: Actor | null = null
  let walking = false
  /** Faster than a stroll. Hysteresis keeps the gait from flickering. */
  let running = false
  /** Seconds the stick has actually been carrying the body, outside a tour. */
  let roamMove = 0
  /** Seconds the stick stayed up while the body was not travelling. */
  let roamStill = 0
  /** Tap cycle. After a wave finishes the body stands, and the next tap sits. */
  let gesture: 'stand' | 'wave' | 'sit' | 'lie' = 'stand'
  let waveHeld = false
  let bedLay = false
  let poseChosen = false
  let pineFeet = 0
  /** One hop per step ring. Progress follows the song so the sole meets the beat. */
  let hop: { x0: number; z0: number; x1: number; z1: number; start: number; landAt: number } | null = null
  let hopU = 0
  let hopH = 0
  const viewEye = [0, 3, -7]
  const viewAt = [0, 1, 0]
  let viewW = STAGE_W
  let viewH = STAGE_H
  const camView = new Float32Array(16)
  const camProj = new Float32Array(16)
  const camViewProj = new Float32Array(16)
  const actorModel = new Float32Array(16)
  let wardrobe: Wardrobe | null = null
  void host.download('actor/boluo.json').then((buf) => {
    actor = loadActor(new TextDecoder().decode(buf))
    wardrobe = new Wardrobe(actor)
  }).catch(() => { /* meadow still runs if the mesh is missing */ })
  let owned = readOwned((key) => host.storageGet(key))
  let worn = readWorn((key) => host.storageGet(key))
  if (worn && !owned.includes(worn)) worn = ''
  let preview = ''
  let weather = readWeather(host.storageGet('boluo.weather'))
  let weatherLevel = clampLevel(num(host.storageGet('boluo.weatherLevel'), SCENE.weatherLevel))
  let clock = deviceClock(Date.now())
  let geo = deviceGeo()
  let live: LiveSky | null = null
  let followTime = readFlag(host.storageGet('boluo.followTime'), true)
  let followWeather = readFlag(host.storageGet('boluo.followWeather'), true)
  let liveBusy = false
  let liveAt = 0
  const bootGoal = weatherGoal(weather, weatherLevel)
  const blend = {
    rain: bootGoal.rain,
    wind: bootGoal.wind,
    fog: SCENE.fogDensity * bootGoal.fogScale + bootGoal.fogAdd,
    mist: bootGoal.mist,
    cover: bootGoal.cover,
    flash: 0,
    nextFlash: 0,
  }
  let gustPhase = 0
  let windTime = 0
  let rainTime = 0
  let cloudDrift = 0
  let cloudLift = 0
  let period = periodOf(readClock(clock, Date.now()).hours)
  if (!followTime) {
    const savedPeriod = Math.round(num(host.storageGet('boluo.period'), -1))
    if (savedPeriod >= 0 && savedPeriod < PERIOD_NAME.length) period = savedPeriod
  }
  ambience.prime(period)
  let fireGoal = ((period % 4) + 4) % 4 === 3 ? 1 : 0
  let fireLevel = fireGoal
  let fireFrom = fireGoal
  let fireT = 1
  const flame = campfireFlame()
  let music = num(host.storageGet('boluo.music'), 0.8)
  let fx = num(host.storageGet('boluo.fx'), 0.8)
  ambience.setVolumes(music, fx)
  let tier = (host.storageGet('boluo.tier') as Tier | null) || 'low'
  if (tier !== 'low' && tier !== 'mid' && tier !== 'high') tier = 'low'
  bindNet(host)
  let token = currentUser()?.token ?? null
  let playing = ''
  const savedTrack = readTrack(host.storageGet('boluo.track'))
  ambience.warmTrack(savedTrack || ALBUMS[0]?.banks[0] || '')
  let playMode = readMode(host.storageGet('boluo.playmode'))
  let touring = readFlag(host.storageGet('boluo.tour'), false)
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
  let worldHold = false
  let bootGone = false
  let effectsOn = false
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
      if (guestLoginOpen()) noteGuestFail()
      return
    }
    token = guest.token
    host.storageSet('boluo.guest', guest.token)
  })()

  host.onHide(() => { hidden = true; ambience.pause(); shell.openPauseTip() })
  host.onShow(() => { hidden = false })

  const mapToStage = (px: number, py: number) => screenToStage(px, py, host.stageBox())

  const showGesture = (next: 'stand' | 'wave' | 'sit' | 'lie') => {
    gesture = next
    if (next !== 'wave') waveHeld = false
    actor?.gesture(next)
  }

  const nextGesture = () => {
    if (!actor) return
    poseChosen = true
    const bedtime = asleepHours(readClock(clock, Date.now()).hours)
    if (gesture === 'lie') showGesture('stand')
    else if (gesture === 'sit') showGesture(bedtime ? 'lie' : 'stand')
    else if (gesture === 'wave' || waveHeld) showGesture('sit')
    else showGesture('wave')
    shell.pokeGesture(gesture)
  }

  /** Stage pixels. The whole posed body, not only the crown. */
  const hitPine = (stageX: number, stageY: number) => {
    if (!actor) return false
    const box = actor.bodyBox()
    const center = projectLocal(box.center)
    if (!center) return false
    let rx = 48
    let ry = 48
    for (const point of box.reach) {
      const projected = projectLocal(point)
      if (!projected) continue
      rx = Math.max(rx, Math.abs(projected.x - center.x))
      ry = Math.max(ry, Math.abs(projected.y - center.y))
    }
    const nx = (stageX - center.x) / (rx * 1.08)
    const ny = (stageY - center.y) / (ry * 1.08)
    return nx * nx + ny * ny <= 1
  }

  const projectLocal = (
    local: { x: number; y: number; z: number },
    extraY = 0,
  ): { x: number; y: number } | null => {
    if (!actor) return null
    const yaw = body.yaw
    const cyaw = Math.cos(yaw)
    const syaw = Math.sin(yaw)
    const s = ACTOR_SCALE
    const wx = body.x + s * (cyaw * local.x + syaw * local.z)
    const wy = pineFeet + ACTOR_LIFT + actor.groundLift() + hopH + s * local.y + extraY
    const wz = body.z + s * (-syaw * local.x + cyaw * local.z)
    lookAt(viewEye, viewAt, [0, 1, 0], camView)
    perspective(Math.PI / 3, viewW / Math.max(1, viewH), 0.15, 2800, camProj)
    multiply(camProj, camView, camViewProj)
    const m = camViewProj
    const cx = m[0] * wx + m[4] * wy + m[8] * wz + m[12]
    const cy4 = m[1] * wx + m[5] * wy + m[9] * wz + m[13]
    const cw = m[3] * wx + m[7] * wy + m[11] * wz + m[15]
    if (cw <= 0.05) return null
    return {
      x: (cx / cw * 0.5 + 0.5) * viewW,
      y: (1 - (cy4 / cw * 0.5 + 0.5)) * viewH,
    }
  }

  const readyIn = (names: string[]): string[] => names.filter((name) => {
    const track = TRACKS.find((item) => item.name === name)
    return !!track?.src && banks.isReady(name)
  })
  const allReady = (): string[] => readyIn(TRACKS.map((track) => track.name))
  const listOf = (name: string): string[] => {
    const album = ALBUMS.find((item) => item.banks.includes(name))
    const list = readyIn(album?.banks ?? [])
    return list.length ? list : allReady()
  }
  const pick = (list: string[], avoid: string): string => {
    const choices = avoid ? list.filter((name) => name !== avoid) : list
    const pool = choices.length ? choices : list
    return pool[Math.floor(Math.random() * pool.length)] ?? ''
  }
  const advance = (name: string): string => {
    const list = listOf(name)
    if (!list.length) return ''
    if (playMode === 'single') return list.includes(name) ? name : list[0]
    if (playMode === 'shuffle') return pick(list, name)
    const index = list.indexOf(name)
    return list[(index + 1) % list.length]
  }
  const openingTrack = (): string => {
    const list = readyIn(ALBUMS[0]?.banks ?? [])
    const pool = list.length ? list : allReady()
    if (playMode === 'shuffle') return pick(pool, '')
    return pool[0] ?? ''
  }
  const parkAnchor = (): void => {
    anchor.x = body.x
    anchor.z = body.z
    anchor.yaw = body.yaw
    anchor.camYaw = body.camYaw
  }
  const beginLeave = (to: 'ask' | 'off'): void => {
    leaveTo = to
    tourPhase = 'leave'
    blendT = 0
    leaveAge = 0
    hop = null
    round.hold()
    parkAnchor()
  }
  const startPlaylist = (name: string, keepTour = false): void => {
    if (!name || !banks.isReady(name)) return
    playing = name
    host.storageSet('boluo.track', playing)
    pilot.reset(name, body.yaw)
    hop = null
    round.hold()
    songReady = false
    if (keepTour) {
      touring = true
      if (tourPhase !== 'lead' && tourPhase !== 'enter') {
        tourPhase = 'enter'
        blendT = 0
        enterYaw = anchor.camYaw
      }
      ambience.playMusic(name, true)
      return
    }
    touring = false
    if (tourPhase !== 'leave') tourPhase = 'off'
    ambience.playMusic(name, false)
  }
  /** 导览一开就把歌曲模式改成随机，后面每首才会换着播。 */
  const useShuffle = (): void => {
    if (playMode === 'shuffle') return
    playMode = 'shuffle'
    host.storageSet('boluo.playmode', playMode)
  }
  const beginTour = (): boolean => {
    if (touring && (tourPhase === 'enter' || tourPhase === 'lead')) return true
    const name = pick(allReady(), '')
    if (!name) return false
    useShuffle()
    touring = true
    tourPhase = 'enter'
    blendT = 0
    leaveAge = 0
    songReady = false
    enterYaw = anchor.camYaw
    playing = name
    host.storageSet('boluo.track', playing)
    pilot.reset(name, enterYaw)
    hop = null
    round.hold()
    showGesture('stand')
    ambience.playMusic(name, true)
    return true
  }
  const declineTour = (): void => {
    const name = advance(playing)
    touring = false
    tourPhase = 'off'
    blendT = 0
    hop = null
    round.hold()
    if (name) startPlaylist(name, false)
  }
  const stopTour = (): void => {
    if (tourPhase === 'ask') {
      declineTour()
      return
    }
    if (!touring && tourPhase === 'off') return
    touring = false
    ambience.cancelLevel()
    if (tourPhase === 'off') return
    beginLeave('off')
  }
  const onTrackEnded = (): void => {
    if (touring && tourPhase !== 'ask' && tourPhase !== 'off') {
      if (tourPhase === 'leave') leaveTo = 'ask'
      else beginLeave('ask')
      return
    }
    if (tourPhase === 'ask') return
    startPlaylist(advance(playing))
  }

  const sceneStamp = (): string => [
    weather,
    weatherLevel,
    ((period % 4) + 4) % 4,
    followTime ? 1 : 0,
    followWeather ? 1 : 0,
    touring ? 1 : 0,
  ].join('|')
  let prefsStamp = sceneStamp()
  const persistPrefs = (): void => {
    const stamp = sceneStamp()
    if (stamp === prefsStamp) return
    prefsStamp = stamp
    host.storageSet('boluo.weather', weather)
    host.storageSet('boluo.weatherLevel', String(weatherLevel))
    host.storageSet('boluo.period', String(((period % 4) + 4) % 4))
    host.storageSet('boluo.followTime', followTime ? '1' : '0')
    host.storageSet('boluo.followWeather', followWeather ? '1' : '0')
    host.storageSet('boluo.tour', touring ? '1' : '0')
  }
  let resumed = false
  const resumeSaved = (): void => {
    if (resumed) return
    resumed = true
    if (playing) return
    if (touring) {
      useShuffle()
      if (savedTrack && banks.isReady(savedTrack)) startPlaylist(savedTrack, true)
      else if (!beginTour()) touring = false
      return
    }
    if (savedTrack && banks.isReady(savedTrack)) startPlaylist(savedTrack, false)
  }

  const apply = (action: UiAction | null) => {
    if (!action) return
    lastInput = host.now()
    ambience.resume()
    if (action.type === 'tap') {
      moveX = 0
      moveY = 0
      joy = { x: 0, y: 0, active: false }
      const inRound = round.phase === 'step' || round.phase === 'hunt'
      if (!inRound && hitPine(action.x, action.y)) nextGesture()
    } else if (action.type === 'move') {
      // 摇杆 x 是画面右，y 是画面深处。长度已经是 0..1。
      moveX = action.x
      moveY = action.y
      joy = { x: action.x, y: action.y, active: action.x !== 0 || action.y !== 0 }
    } else if (action.type === 'weather') {
      weather = action.kind
      weatherLevel = action.level
      followWeather = false
    } else if (action.type === 'outfit-preview') {
      preview = action.id
      actor?.playDance('jelly')
    } else if (action.type === 'outfit-clear') {
      preview = ''
    } else if (action.type === 'outfit-wear') {
      preview = ''
      worn = action.id && owned.includes(action.id) ? action.id : ''
      writeWorn((key, value) => host.storageSet(key, value), worn)
      if (worn) actor?.playDance('jelly')
    } else if (action.type === 'outfit-buy') {
      if (outfitById(action.id) && !owned.includes(action.id)) owned = [...owned, action.id]
      worn = action.id
      preview = ''
      writeOwned((key, value) => host.storageSet(key, value), owned)
      writeWorn((key, value) => host.storageSet(key, value), worn)
      actor?.playDance('jelly')
    } else if (action.type === 'period') {
      period = (period + 1) % PERIOD_NAME.length
      followTime = false
    } else if (action.type === 'live') {
      followTime = action.on
      followWeather = action.on
      if (action.on) {
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
      const keep = touring || tourPhase === 'ask'
      if (banks.isReady(action.name)) {
        const changed = action.name !== playing
        startPlaylist(action.name, keep)
        if (changed) shell.announceSong(action.name)
      } else banks.request([action.name], host.now())
    } else if (action.type === 'play-default') {
      if (!playing) {
        const first = openingTrack()
        if (first) startPlaylist(first)
      }
    } else if (action.type === 'play-mode') {
      playMode = action.mode
      host.storageSet('boluo.playmode', playMode)
    } else if (action.type === 'tour-next') {
      const name = advance(playing)
      if (name) startPlaylist(name, true)
    } else if (action.type === 'tour') {
      if (action.on) {
        if (!beginTour()) shell.toast('还没有可以播放的音乐')
      } else if (tourPhase === 'ask') declineTour()
      else stopTour()
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
          if (guestLoginOpen()) noteGuestFail()
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
    persistPrefs()
  }

  let wake = () => {}
  host.onTouch(
    (p) => { wake(); const s = mapToStage(p.x, p.y); apply(shell.pointer('down', s.x, s.y, p.id)) },
    (p) => { wake(); const s = mapToStage(p.x, p.y); apply(shell.pointer('move', s.x, s.y, p.id)) },
    (p) => { wake(); const s = mapToStage(p.x, p.y); apply(shell.pointer('up', s.x, s.y, p.id)) },
  )

  let last = host.now()
  let restPace = false
  let restTimer: ReturnType<typeof setTimeout> | null = null
  let fpsFrames = 0
  let fpsWindow = last
  const fpsEl = typeof document !== 'undefined' ? document.getElementById('fps') : null
  const frame = (now: number) => {
    let restNext = false
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
    viewW = panelW
    viewH = panelH
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
      const dt = Math.min(restPace ? 0.12 : 0.05, (now - last) / 1000)
      const wantFire = ((period % 4) + 4) % 4 === 3 ? 1 : 0
      if (fireGoal !== wantFire) {
        fireGoal = wantFire
        fireFrom = fireLevel
        fireT = 0
      }
      if (fireT < 1) {
        fireT = Math.min(1, fireT + dt)
        const s = fireT * fireT * (3 - 2 * fireT)
        fireLevel = fireFrom + (fireGoal - fireFrom) * s
      }
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
      cloudDrift = wrapPhase(cloudDrift + (0.012 + windAmp * 0.008) * dt, CLOUD_DRIFT_WRAP)
      cloudLift = wrapPhase(cloudLift + 0.004 * dt, CLOUD_LIFT_WRAP)
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
      const slide = (x: number, z: number, nx: number, nz: number) => tryMove(x, z, nx, nz, solids)
      const stickHeld = joy.active
      const freeRoam = tourPhase === 'off' || tourPhase === 'ask'
      const fromX = body.x
      const fromZ = body.z
      let danceNow: DanceKind | null = null
      if (world && freeRoam) {
        const camSpeed = driveCamera(anchor, smoothX, smoothY, dt, slide)
        mascotFollow(body, anchor, dt, slide, camSpeed)
      } else if (world && tourPhase === 'lead') {
        if (stickHeld) {
          steer(body, smoothX, smoothY, dt, slide, true)
          if (!hop) round.disarm()
        } else if (!songReady) {
          if (!hop) round.disarm()
        } else {
          const song = ambience.songSeconds()
          const frame = pilot.step(
            song, body, dt, false, hop != null, slide,
            (x, z) => canOccupy(x, z, x, z, solids),
          )
          if (!stickHeld && frame.ring) round.arm(frame.ring.x, frame.ring.z)
          else if (!hop) round.disarm()
          if (!hop && frame.hop) {
            hop = {
              x0: body.x, z0: body.z, x1: frame.hop.x, z1: frame.hop.z,
              start: song, landAt: frame.hop.landAt,
            }
            hopU = 0
          }
          if (!hop) danceNow = frame.dance
        }
      } else if (world && tourPhase === 'enter') {
        blendT += dt
        const face = Math.atan2(Math.sin(enterYaw - body.yaw), Math.cos(enterYaw - body.yaw))
        body.yaw += face * (1 - Math.exp(-dt / 0.15))
        // Face into the view first, then take a normal stroll. A turn toward the lens would step into the camera.
        if (Math.abs(face) < 0.5) {
          const moved = slide(
            body.x, body.z,
            body.x + Math.sin(body.yaw) * 1.15 * dt,
            body.z + Math.cos(body.yaw) * 1.15 * dt,
          )
          body.x = moved.x
          body.z = moved.z
        }
        round.disarm()
        if (blendT >= 1.5 && songReady) tourPhase = 'lead'
      } else if (world && tourPhase === 'leave') {
        blendT += dt
        leaveAge += dt
        const slot = lensSlot(anchor)
        const dx = slot.x - body.x
        const dz = slot.z - body.z
        const dist = Math.hypot(dx, dz)
        if (dist > 0.28) {
          const face = Math.atan2(dx, dz)
          const turn = Math.atan2(Math.sin(face - body.yaw), Math.cos(face - body.yaw))
          body.yaw += turn * (1 - Math.exp(-dt / 0.1))
          const stepLen = Math.min(dist, 1.15 * dt)
          const moved = slide(body.x, body.z, body.x + (dx / dist) * stepLen, body.z + (dz / dist) * stepLen)
          body.x = moved.x
          body.z = moved.z
        }
        if ((dist <= 0.28 || leaveAge > 4) && blendT >= 1.5) {
          tourPhase = leaveTo === 'ask' ? 'ask' : 'off'
          if (tourPhase === 'off') touring = false
        }
      }
      if ((tourPhase === 'enter' || tourPhase === 'lead') && !stickHeld && !danceNow) {
        const turn = Math.atan2(Math.sin(body.yaw - body.camYaw), Math.cos(body.yaw - body.camYaw))
        const dead = 4 * Math.PI / 180
        if (Math.abs(turn) > dead) {
          const follow = turn * (1 - Math.exp(-dt / 1.1))
          const cap = 18 * Math.PI / 180 * dt
          body.camYaw += Math.max(-cap, Math.min(cap, follow))
        }
      }
      hopH = 0
      if (hop && world && tourPhase === 'lead') {
        const song = ambience.songSeconds()
        const span = Math.max(0.05, hop.landAt - hop.start)
        const u = Math.max(0, Math.min(1, (song - hop.start) / span))
        hopU = u
        const s = u * u * (3 - 2 * u)
        const nx = hop.x0 + (hop.x1 - hop.x0) * s
        const nz = hop.z0 + (hop.z1 - hop.z0) * s
        if (canOccupy(nx, nz, body.x, body.z, solids)) {
          body.x = nx
          body.z = nz
        } else {
          const moved = slide(body.x, body.z, nx, nz)
          body.x = moved.x
          body.z = moved.z
        }
        const face = Math.atan2(hop.x1 - body.x, hop.z1 - body.z)
        const turn = Math.atan2(Math.sin(face - body.yaw), Math.cos(face - body.yaw))
        body.yaw += turn * (1 - Math.exp(-dt / 0.55))
        hopH = Math.sin(u * Math.PI) * 0.95
        if (u >= 1) {
          if (canOccupy(hop.x1, hop.z1, body.x, body.z, solids)) {
            body.x = hop.x1
            body.z = hop.z1
          }
          round.land(hop.x1, hop.z1, (freq, seconds) => host.webAudio()?.beep(freq, seconds))
          hop = null
          hopU = 0
        }
      } else if (hop) {
        hop = null
        hopU = 0
      } else hopU = 0
      // Gait follows the distance travelled this frame, not the chart or the stick.
      // A stroll is about 1.2 m/s and a run about 2.6 m/s. Stopped legs stay still.
      const speed = Math.hypot(body.x - fromX, body.z - fromZ) / Math.max(dt, 1e-4)
      if (speed > 0.3) walking = true
      else if (speed < 0.12) walking = false
      if (speed > 1.9) running = true
      else if (speed < 1.5) running = false
      if (!walking) running = false
      if (tourPhase === 'off' && stickHeld && speed > 0.3) {
        roamMove += dt
        roamStill = 0
      } else if (tourPhase === 'off' && stickHeld) {
        roamStill += dt
        if (roamStill > 0.45) roamMove = 0
      } else {
        if (world && tourPhase === 'off' && !stickHeld && roamMove >= 10) {
          if (beginTour()) shell.muteStepLine(playing)
          else shell.toast('还没有可以播放的音乐')
        }
        roamMove = 0
        roamStill = 0
      }
      if ((walking || running) && (gesture !== 'stand' || waveHeld)) {
        gesture = 'stand'
        waveHeld = false
        actor?.gesture('stand')
      }
      const feet = footY(body.x, body.z)
      pineFeet = feet
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
        // Paint the HUD once before the world build, which blocks the first frame.
        if (!worldHold) worldHold = true
        else {
          renderer = new Renderer(host)
          renderer.loadLeaf('oil/brush.png')
          renderer.loadFace('actor/face.png')
          renderer.loadFire()
          world = buildWorld('meadow')
          ambience.setScene('meadow')
          if (!host.uiOnScreen) uiTex = renderer.uploadUi(uiCanvas)
          uncovered = true
          host.launchSuccess()
          ambience.setVolumes(music, fx)
          try { renderer.compileTier(tier) } catch { tier = 'low' }
        }
      }
      if (!bootGone && host.bootReady(sinceBoot)) {
        bootGone = true
        host.closeBootVideo()
      }
      if (!effectsOn && uncovered && bootGone) {
        effectsOn = true
        ambience.uncover()
        resumeSaved()
      }
      if (!world || !renderer) {
        ambience.pump()
        const input = makeInput(now, host, {
          uncovered, bootGone, progress, preset, weather, weatherLevel, music, fx, playing, timerLeft, timerRunning,
          idle: 0, iris: 0, joy, banks: banks.snapshot(), loggedIn: !!token, tier,
          period, hour: tick.hours, day: tick.day, sleep: null, head: null, panelW, panelH, handDeg, live: liveOn,
          playMode, tour: touring, tourAsk: false,
          outfitOwned: owned.join(','), outfitWorn: worn,
        })
        shell.draw(uiCtx, input)
        apply(shell.takeQueued())
        persistPrefs()
        host.raf(frame)
        return
      }
      const nightBed = tourPhase === 'off' && asleepHours(tick.hours)
      if (nightBed) {
        if (!bedLay) poseChosen = false
        if (!walking && !poseChosen) {
          gesture = 'lie'
          waveHeld = false
          actor?.gesture('lie')
        }
        bedLay = true
      } else if (gesture === 'lie' || bedLay) {
        // 没到 22 点就起来。点选的躺姿也不算睡觉。
        if (gesture === 'lie') {
          gesture = 'stand'
          waveHeld = false
          actor?.gesture('stand')
        }
        bedLay = false
        poseChosen = false
      }
      banks.tick(now)
      if (hop) actor?.stopDance(true)
      else if (danceNow) actor?.playDance(danceNow)
      else actor?.stopDance(false)
      actor?.setJump(hop ? Math.sin(hopU * Math.PI) : 0)
      actor?.setSpeaking(shell.isSpeaking(), shell.speakPhase())
      const immersed = tourPhase === 'off' && now - lastInput > IDLE_MS
      actor?.advance(dt, walking, immersed, running, now)
      if (actor?.takeWaveEnd() && gesture === 'wave') {
        gesture = 'stand'
        waveHeld = true
      }
      const web = host.webAudio()
      const clockOn = !web || web.running()
      const roundHooks = {
        beep: web ? (freq: number, seconds: number) => web.beep(freq, seconds) : undefined,
        canOccupy: (x: number, z: number) => canOccupy(x, z, x, z, solids),
      }
      ambience.tickMusic(now, clockOn)
      if (ambience.takeEnded()) onTrackEnded()
      round.update(clockOn ? dt : 0, body.x, body.z, body.yaw, roundHooks)
      ambience.setMusic(playing)
      const played = round.view(roundHooks)
      huntAim = played.aimYaw != null
      if (played.aimYaw != null && tourPhase === 'lead') aimCamera(body, played.aimYaw, dt)
      const chaseK = tourPhase === 'lead' ? 1
        : tourPhase === 'enter' ? smoothStep(Math.min(1, blendT / 1.5))
        : tourPhase === 'leave' ? 1 - smoothStep(Math.min(1, blendT / 1.5))
        : 0
      const npcFeet = footY(anchor.x, anchor.z)
      const chaseEye = [
        body.x - Math.sin(body.camYaw) * LENS_BACK,
        feet + 3.2,
        body.z - Math.cos(body.camYaw) * LENS_BACK,
      ]
      const chaseAt = [body.x, feet + 0.9, body.z]
      const npcEye = [
        anchor.x - Math.sin(anchor.camYaw) * LENS_BACK,
        npcFeet + 3.2,
        anchor.z - Math.cos(anchor.camYaw) * LENS_BACK,
      ]
      const npcAt = [anchor.x, npcFeet + 0.9, anchor.z]
      const eye = [
        npcEye[0] + (chaseEye[0] - npcEye[0]) * chaseK,
        npcEye[1] + (chaseEye[1] - npcEye[1]) * chaseK,
        npcEye[2] + (chaseEye[2] - npcEye[2]) * chaseK,
      ]
      const target = [
        npcAt[0] + (chaseAt[0] - npcAt[0]) * chaseK,
        npcAt[1] + (chaseAt[1] - npcAt[1]) * chaseK,
        npcAt[2] + (chaseAt[2] - npcAt[2]) * chaseK,
      ]
      const hear = chaseK > 0.5 ? body : anchor
      const hearFeet = chaseK > 0.5 ? feet : npcFeet
      ambience.setFlame(fireLevel)
      ambience.update(
        now, hear.x, hearFeet + 1.55, hear.z,
        Math.sin(hear.yaw), 0, Math.cos(hear.yaw),
        weather, weatherLevel, period,
      )
      viewEye[0] = eye[0]
      viewEye[1] = eye[1]
      viewEye[2] = eye[2]
      viewAt[0] = target[0]
      viewAt[1] = target[1]
      viewAt[2] = target[2]
      ambience.setVolumes(music, fx)
      const idle = tourPhase === 'off' && now - lastInput > IDLE_MS ? Math.min(1, (now - lastInput - IDLE_MS) / 1000) : 0
      const iris = irisAlpha(now, irisFrom, irisUntil)
      const head = actor ? projectLocal(actor.topLocal()) : null
      const sleep = actor && nightBed && gesture === 'lie' ? projectLocal(actor.crownLocal(), 0.32) : null
      const input = makeInput(now, host, {
        uncovered, bootGone, progress, preset, weather, weatherLevel, music, fx, playing, timerLeft, timerRunning,
        idle, iris, joy, banks: banks.snapshot(), loggedIn: !!token, tier,
        period, hour: tick.hours, day: tick.day, sleep, head, panelW, panelH, handDeg, live: liveOn,
        playMode, tour: touring, tourAsk: tourPhase === 'ask',
        scoreText: played.scoreText, phaseText: played.phaseText,
        stepping: tourPhase === 'enter' || tourPhase === 'lead',
        outfitOwned: owned.join(','), outfitWorn: worn,
      })
      if (shell.draw(uiCtx, input) && uiTex) renderer.updateUi(uiTex, uiCanvas)
      apply(shell.takeQueued())
      const scene = world
      const push = (mesh: MeshData, list: { mesh: MeshData; model: Float32Array }[]) => {
        if (mesh.indices.length >= 3 && mesh.interleaved.length >= 36) list.push({ mesh, model })
      }
      const items: { mesh: MeshData; model: Float32Array }[] = []
      for (const mesh of scene.pieces) push(mesh, items)
      if (fireLevel > 0.004) {
        aimFlame(flame, eye[0], eye[2])
        push(flame, items)
      }
      if (blend.rain > 0.03) push(scene.rain, items)
      if (actor) {
        actorMatrix(actorModel, body.x, feet, body.z, body.yaw, actor.groundLift() + hopH)
        items.push({ mesh: actor.mesh, model: actorModel })
        updateCatchlights(glints, actor, {
          x: body.x, y: feet, z: body.z, yaw: body.yaw,
          lift: actor.groundLift() + hopH,
        }, {
          x: eye[0], y: eye[1], z: eye[2],
        })
        items.push({ mesh: glints, model })
        const shown = outfitById(preview || worn)
        if (wardrobe && shown) {
          wardrobe.pose(shown.id, actor)
          const cloth = wardrobe.mesh(shown.id)
          if (cloth) items.push({ mesh: cloth, model: actorModel })
          const sparks = wardrobe.sparkle(actor, now / 1000, shown.spark)
          if (sparks) items.push({ mesh: sparks, model: actorModel })
        }
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
      const periodIndex = ((period % 4) + 4) % 4
      const civil = clock.wallMs + (Date.now() - clock.sampledAt)
      const utc = followTime
        ? Date.now()
        : periodUtc(periodIndex, civil, clock.wallMs - clock.sampledAt, geo.lat, geo.lon)
      const bodies = skyBodies(utc, geo.lat, geo.lon)
      const sunColor = PERIOD_COLOR[periodIndex].map((c) => c * sunScale)
      renderer.draw({
        eye, target,
        sun: bodies.sun,
        skySun: bodies.skySun,
        moon: bodies.moon,
        moonEl: bodies.moonEl,
        moonLit: bodies.moonLit,
        moonCos: bodies.moonCos,
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
        cloudLift,
        period,
        cover: blend.cover,
        dim: 0,
        look: outfitById(preview || worn)?.look ?? 0,
        fire: fireLevel,
        firePos: campfireLight(),
        items,
        outline,
      }, { texture: host.uiOnScreen ? null : uiTex, alpha: 1 })
      if (Math.floor(now / 2000) !== Math.floor(prev / 2000)) {
        host.storageSet('boluo.pos', JSON.stringify({ x: body.x, z: body.z, yaw: body.yaw, pitch: -0.12 }))
        host.storageSet('boluo.timer', String(timerLeft))
      }
      persistPrefs()
      restNext = shell.coasting()
        && tourPhase === 'off'
        && !walking
        && !joy.active
        && moveX === 0
        && moveY === 0
        && iris === 0
    }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (typeof document !== 'undefined') document.title = msg
    }
    restPace = restNext
    if (restNext) {
      const wait = Math.max(0, REST_MS - (host.now() - now))
      restTimer = setTimeout(() => {
        restTimer = null
        frame(host.now())
      }, wait)
    } else {
      host.raf(frame)
    }
  }
  wake = () => {
    if (restTimer == null) return
    clearTimeout(restTimer)
    restTimer = null
    host.raf(frame)
  }
  host.raf(frame)

  function pullLive(now: number): void {
    liveBusy = true
    liveAt = now
    void fetchLiveSky().then((sky) => {
      if (Number.isFinite(sky.lat) && Number.isFinite(sky.lon)) geo = { lat: sky.lat, lon: sky.lon }
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

function smoothStep(u: number): number {
  const t = Math.max(0, Math.min(1, u))
  return t * t * (3 - 2 * t)
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

function num(raw: string | null, fallback: number): number {
  const n = raw == null ? NaN : Number(raw)
  return Number.isFinite(n) ? n : fallback
}

function readMode(raw: string | null): PlayMode {
  if (raw === 'loop' || raw === 'shuffle' || raw === 'single') return raw
  return 'loop'
}

function readFlag(raw: string | null, fallback: boolean): boolean {
  if (raw === '1') return true
  if (raw === '0') return false
  return fallback
}

function readWeather(raw: string | null): 'clear' | 'cloud' | 'rain' | 'fog' | 'wind' {
  if (raw === 'clear' || raw === 'cloud' || raw === 'rain' || raw === 'fog' || raw === 'wind') return raw
  return SCENE.weather
}

function clampLevel(n: number): number {
  return Math.max(0, Math.min(3, Math.round(n)))
}

function readTrack(raw: string | null): string {
  if (!raw) return ''
  return TRACKS.some((track) => track.name === raw) ? raw : ''
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
    /** Boot video has left. The greeting waits for this and the progress bar. */
    bootGone: boolean
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
    hour: number
    day: string
    sleep: { x: number; y: number } | null
    head: { x: number; y: number } | null
    panelW: number
    panelH: number
    handDeg: number
    live: boolean
    playMode: PlayMode
    tour: boolean
    tourAsk?: boolean
    scoreText?: string
    phaseText?: string
    stepping?: boolean
    outfitOwned?: string
    outfitWorn?: string
  },
): UiInput {
  const capsule = host.system().capsule
  const track = TRACKS.find((t) => t.name === s.playing)
  return {
    now,
    loading: !s.uncovered || !s.bootGone,
    progress: s.progress,
    presetId: 'meadow',
    presetLabel: '',
        weather: s.weather,
    weatherLevel: s.weatherLevel,
    music: s.music,
    fx: s.fx,
    trackName: track?.label ?? '',
    trackId: s.playing,
    playing: !!s.playing,
    timerLeft: s.timerLeft,
    timerRunning: s.timerRunning,
    period: s.period,
    hour: s.hour,
    day: s.day,
    sleep: s.sleep,
    head: s.head,
    panelW: s.panelW,
    panelH: s.panelH,
    handDeg: s.handDeg,
    live: s.live,
    playMode: s.playMode,
    tour: s.tour,
    tourAsk: s.tourAsk ?? false,
    scoreText: s.scoreText ?? '',
    phaseText: s.phaseText ?? '',
    stepping: s.stepping ?? false,
    outfitOwned: s.outfitOwned ?? '',
    outfitWorn: s.outfitWorn ?? '',
    idleAlpha: s.idle,
    iris: s.iris,
    joystick: s.joy,
    banks: s.banks,
    loggedIn: s.loggedIn,
    capsulePad: capsule ? 80 : 0,
  }
}
