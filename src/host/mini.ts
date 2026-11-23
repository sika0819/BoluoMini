import { stageFit } from '../ui/fit'
import type { AudioClip, Host, HostCanvas, HostKind, InnerVoice, Rect, TouchPoint, WebAudioHost, SpatialVoice } from './types'

interface MiniApi {
  createCanvas: () => HostCanvas
  createInnerAudioContext?: () => {
    src: string
    loop: boolean
    volume: number
    play: () => void
    stop: () => void
  }
  createWebAudioContext?: () => WebAudioContextLike
  downloadFile?: (opts: {
    url: string
    success?: (res: { tempFilePath?: string; statusCode?: number }) => void
    fail?: (err: unknown) => void
  }) => void
  request?: (opts: {
    url: string
    responseType?: string
    success?: (res: { data: ArrayBuffer }) => void
    fail?: (err: unknown) => void
  }) => void
  getFileSystemManager?: () => {
    readFile: (opts: {
      filePath: string
      success?: (res: { data: ArrayBuffer }) => void
      fail?: (err: unknown) => void
    }) => void
  }
  getStorageSync?: (key: string) => string
  setStorageSync?: (key: string, value: string) => void
  removeStorageSync?: (key: string) => void
  getSystemInfoSync?: () => { windowWidth: number; windowHeight: number; pixelRatio: number }
  getMenuButtonBoundingClientRect?: () => { left: number; top: number; width: number; height: number }
  onTouchStart?: (cb: (e: { touches: { identifier: number; clientX: number; clientY: number }[] }) => void) => void
  onTouchMove?: (cb: (e: { touches: { identifier: number; clientX: number; clientY: number }[] }) => void) => void
  onTouchEnd?: (cb: (e: { changedTouches: { identifier: number; clientX: number; clientY: number }[] }) => void) => void
  onTouchCancel?: (cb: (e: { changedTouches: { identifier: number; clientX: number; clientY: number }[] }) => void) => void
  onHide?: (cb: () => void) => void
  onShow?: (cb: () => void) => void
  login?: (opts: { success?: (res: { code?: string }) => void; fail?: () => void }) => void
  getNetworkType?: (opts: { success?: (res: { networkType?: string }) => void; fail?: () => void }) => void
  canIUse?: (name: string) => boolean
  launchSuccess?: () => void
  createVideo?: (opts: {
    src: string
    autoplay?: boolean
    loop?: boolean
    controls?: boolean
    muted?: boolean
    objectFit?: string
    x?: number
    y?: number
    width?: number
    height?: number
  }) => { play?: () => void; stop?: () => void; destroy?: () => void; width?: number; height?: number }
}

interface WebAudioContextLike {
  sampleRate: number
  destination: AudioNode
  listener: AudioListener
  createBuffer: (channels: number, length: number, sampleRate: number) => AudioBuffer
  createBufferSource: () => AudioBufferSourceNode
  createGain: () => GainNode
  createPanner?: () => PannerNode
  decodeAudioData?: (
    data: ArrayBuffer,
    success?: (buffer: AudioBuffer) => void,
    fail?: (err: unknown) => void,
  ) => Promise<AudioBuffer> | void
  state?: string
  suspend?: () => void
  resume?: () => void
}

function wrapInner(api: MiniApi): InnerVoice {
  const ctx = api.createInnerAudioContext ? api.createInnerAudioContext() : null
  return {
    play(url, loop) {
      if (!ctx) return
      ctx.src = url
      ctx.loop = loop
      ctx.play()
    },
    setVolume(v) {
      if (ctx) ctx.volume = v
    },
    stop() {
      ctx?.stop()
    },
  }
}

function wrapWeb(api: MiniApi): WebAudioHost | null {
  if (!api.createWebAudioContext) return null
  if (api.canIUse && !api.canIUse('createWebAudioContext')) return null
  const ctx = api.createWebAudioContext()
  const hasPanner = typeof ctx.createPanner === 'function'
  const start = (
    buffer: AudioBuffer,
    loop: boolean,
    spatial: boolean,
    x: number,
    y: number,
    z: number,
    refDistance: number,
    maxDistance: number,
  ): SpatialVoice => {
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.loop = loop
    const gain = ctx.createGain()
    gain.gain.value = 1
    let panner: PannerNode | null = null
    if (spatial && hasPanner && ctx.createPanner) {
      panner = ctx.createPanner()
      panner.panningModel = 'HRTF'
      panner.distanceModel = 'inverse'
      panner.refDistance = refDistance
      panner.maxDistance = maxDistance
      panner.setPosition(x, y, z)
      source.connect(panner)
      panner.connect(gain)
    } else {
      source.connect(gain)
    }
    gain.connect(ctx.destination)
    source.start()
    return {
      setPosition(px, py, pz) {
        if (panner) panner.setPosition(px, py, pz)
      },
      setGain(v) { gain.gain.value = v },
      stop() {
        gain.gain.value = 0
        try { gain.disconnect() } catch { /* already detached */ }
        try { source.stop() } catch { /* already stopped */ }
        try { source.disconnect() } catch { /* already detached */ }
      },
    }
  }
  return {
    playLoop(seconds, freq, x, y, z, refDistance, maxDistance) {
      const rate = ctx.sampleRate || 44100
      const length = Math.max(1, Math.floor(rate * seconds))
      const buffer = ctx.createBuffer(1, length, rate)
      const data = buffer.getChannelData(0)
      for (let i = 0; i < length; i++) data[i] = Math.sin((i / rate) * freq * Math.PI * 2) * 0.15
      return start(buffer, true, true, x, y, z, refDistance, maxDistance)
    },
    playClip(clip, loop, spatial, x, y, z, refDistance, maxDistance) {
      return start(clip as AudioBuffer, loop, spatial, x, y, z, refDistance, maxDistance)
    },
    decode(data) {
      return new Promise((resolve, reject) => {
        if (!ctx.decodeAudioData) {
          reject(new Error('decode'))
          return
        }
        const pending = ctx.decodeAudioData(data.slice(0), (buf) => resolve(buf), reject)
        if (pending && typeof (pending as Promise<AudioBuffer>).then === 'function') {
          ;(pending as Promise<AudioBuffer>).then(resolve, reject)
        }
      })
    },
    setListener(x, y, z, fx, fy, fz) {
      const listener = ctx.listener
      if (listener.positionX) {
        listener.positionX.value = x
        listener.positionY.value = y
        listener.positionZ.value = z
        listener.forwardX.value = fx
        listener.forwardY.value = fy
        listener.forwardZ.value = fz
      } else {
        listener.setPosition(x, y, z)
        listener.setOrientation(fx, fy, fz, 0, 1, 0)
      }
    },
    running() { return !ctx.state || ctx.state === 'running' },
    suspend() { ctx.suspend?.() },
    resume() { ctx.resume?.() },
  }
}

export function createMiniHost(kind: HostKind, api: MiniApi, allowGlExtensions: boolean): Host {
  const screen = api.createCanvas()
  const info = api.getSystemInfoSync?.() ?? { windowWidth: 375, windowHeight: 812, pixelRatio: 2 }
  screen.width = Math.floor(info.windowWidth * info.pixelRatio)
  screen.height = Math.floor(info.windowHeight * info.pixelRatio)
  let launched = false
  let bootUrl = ''
  let web: WebAudioHost | null | undefined
  let bootVideo: { play?: () => void; stop?: () => void; destroy?: () => void; width?: number; height?: number } | null = null
  return {
    kind,
    allowGlExtensions,
    uiOnScreen: false,
    screen,
    createOffscreen(width, height) {
      const canvas = api.createCanvas()
      canvas.width = width
      canvas.height = height
      return canvas
    },
    uiCanvas(width, height) {
      const canvas = api.createCanvas()
      canvas.width = width
      canvas.height = height
      return canvas
    },
    openBootVideo(url) {
      const sys = api.getSystemInfoSync?.() ?? info
      if (bootVideo && bootUrl === url) {
        bootVideo.width = sys.windowWidth
        bootVideo.height = sys.windowHeight
        return
      }
      bootUrl = url
      bootVideo?.destroy?.()
      bootVideo = api.createVideo?.({
        src: url,
        autoplay: true,
        loop: true,
        controls: false,
        muted: true,
        objectFit: 'fill',
        x: 0,
        y: 0,
        width: sys.windowWidth,
        height: sys.windowHeight,
      }) ?? null
      bootVideo?.play?.()
    },
    closeBootVideo() {
      bootUrl = ''
      bootVideo?.stop?.()
      bootVideo?.destroy?.()
      bootVideo = null
    },
    raf(cb) {
      return requestAnimationFrame(cb)
    },
    cancelRaf(id) { cancelAnimationFrame(id) },
    now() { return Date.now() },
    onTouch(start, move, end) {
      const map = (t: { identifier: number; clientX: number; clientY: number }): TouchPoint => ({
        id: t.identifier, x: t.clientX, y: t.clientY,
      })
      api.onTouchStart?.((e) => {
        if (web === undefined) web = wrapWeb(api)
        web?.resume()
        for (const t of e.touches) start(map(t))
      })
      api.onTouchMove?.((e) => { for (const t of e.touches) move(map(t)) })
      api.onTouchEnd?.((e) => { for (const t of e.changedTouches) end(map(t)) })
      api.onTouchCancel?.((e) => { for (const t of e.changedTouches) end(map(t)) })
    },
    download(url) {
      return new Promise((resolve, reject) => {
        if (api.request) {
          api.request({
            url,
            responseType: 'arraybuffer',
            success: (res) => resolve(res.data),
            fail: reject,
          })
          return
        }
        reject(new Error('no request'))
      })
    },
    storageGet(key) {
      try { return api.getStorageSync?.(key) ?? null } catch { return null }
    },
    storageSet(key, value) { api.setStorageSync?.(key, value) },
    storageRemove(key) { api.removeStorageSync?.(key) },
    innerAudio: () => wrapInner(api),
    webAudio() {
      if (web !== undefined) return web
      web = wrapWeb(api)
      return web
    },
    login() {
      return new Promise((resolve) => {
        if (!api.login) { resolve(null); return }
        api.login({
          success: (res) => resolve(res.code ?? null),
          fail: () => resolve(null),
        })
      })
    },
    onHide(cb) { api.onHide?.(cb) },
    onShow(cb) { api.onShow?.(cb) },
    system() {
      const s = api.getSystemInfoSync?.() ?? info
      let capsule: Rect | null = null
      const raw = api.getMenuButtonBoundingClientRect?.()
      if (raw && raw.width) capsule = { x: raw.left, y: raw.top, width: raw.width, height: raw.height }
      return { width: s.windowWidth, height: s.windowHeight, dpr: s.pixelRatio || 1, capsule }
    },
    stageBox() {
      const s = api.getSystemInfoSync?.() ?? info
      return stageFit(s.windowWidth, s.windowHeight)
    },
    launchSuccess() {
      if (launched) return
      launched = true
      api.launchSuccess?.()
    },
    network() {
      return new Promise((resolve) => {
        if (!api.getNetworkType) { resolve('wifi'); return }
        api.getNetworkType({
          success: (res) => {
            const n = res.networkType || ''
            if (n === 'none' || n === 'offline') resolve('none')
            else if (n === 'wifi') resolve('wifi')
            else resolve('cellular')
          },
          fail: () => resolve('wifi'),
        })
      })
    },
  }
}
