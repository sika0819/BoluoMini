import { stageFit } from '../ui/fit'
import type { AudioClip, Host, HostCanvas, InnerVoice, MusicVoice, SpatialVoice, TouchPoint, WebAudioHost } from './types'

/** Keep the 3D buffer near 720p. High-dpi panels were filling pixels, not triangles. */
function glScale(cssW: number, cssH: number, dpr: number): number {
  const cap = Math.min(Math.max(dpr, 1), 2)
  const area = Math.max(1, cssW * cssH)
  const budget = 1280 * 720
  if (area * cap * cap <= budget) return cap
  return Math.max(1, Math.min(cap, Math.sqrt(budget / area)))
}

/** Playlist player. Volume lives on the element, not on a shared WebAudio gain. */
function createBrowserMusic(): MusicVoice {
  const audio = new Audio()
  audio.preload = 'auto'
  audio.crossOrigin = 'anonymous'
  let want = false
  let current = ''
  let volume = 1
  let heard = false
  let nextTry = 0
  const abs = (url: string): string => {
    try { return new URL(url, location.href).href } catch { return url }
  }
  audio.addEventListener('playing', () => {
    if (current && audio.src === current) heard = true
  })
  const tryPlay = () => {
    if (!want || !current) return
    if (heard && !audio.paused) return
    const now = performance.now()
    if (now < nextTry) return
    nextTry = now + 400
    audio.volume = volume
    void audio.play().catch(() => { /* autoplay waits for a gesture */ })
  }
  return {
    load(url, restart) {
      if (!url) {
        this.stop()
        return
      }
      const next = abs(url)
      const same = current === next
      if (!same) {
        heard = false
        audio.src = url
        // Keep the resolved url so the playing event still matches after a path prefix.
        current = audio.src || next
      }
      if (!same || restart) {
        heard = false
        try { audio.currentTime = 0 } catch { /* metadata not in yet */ }
      }
      want = true
      nextTry = 0
      audio.volume = volume
      void audio.play().catch(() => { /* autoplay waits for a gesture */ })
    },
    warm(url) {
      if (!url) return
      const next = abs(url)
      if (current === next) return
      audio.preload = 'auto'
      audio.src = url
      current = audio.src || next
    },
    setVolume(v) {
      volume = Math.max(0, Math.min(1, v))
      audio.volume = volume
    },
    duration() {
      return Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0
    },
    position() {
      const at = audio.currentTime
      return Number.isFinite(at) && at > 0 ? at : 0
    },
    started() { return heard && this.duration() > 0 },
    stop() {
      want = false
      heard = false
      current = ''
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
    },
    pause() {
      nextTry = 0
      audio.pause()
    },
    resume() { tryPlay() },
  }
}

export function createBrowserHost(): Host {
  const canvas = document.getElementById('boluo') as HTMLCanvasElement | null
    ?? document.querySelector('canvas')
  if (!canvas) throw new Error('missing canvas')
  const ui = document.getElementById('ui') as HTMLCanvasElement | null
  // The soft keyboard shrinks innerHeight. Refitting to that short viewport
  // scales the whole login card down. Keep the size from before the keyboard.
  let stableW = 0
  let stableH = 0
  const fieldFocused = (): boolean => {
    const active = document.activeElement
    return active instanceof HTMLElement && active.classList.contains('boluo-field')
  }
  const screenSize = (): { width: number; height: number } => {
    const width = window.innerWidth
    const height = Math.max(window.innerHeight, Math.round(window.visualViewport?.height ?? 0))
    const rotated = stableW > 0 && Math.abs(width - stableW) > 80
    // A focused field ignores the shorter viewport the keyboard creates.
    // A real rotation still updates both sides.
    if (stableH === 0 || !fieldFocused() || rotated || height > stableH) {
      stableW = width
      stableH = height
    }
    return { width: stableW, height: stableH }
  }
  const fit = () => {
    const { width, height } = screenSize()
    const scale = glScale(width, height, window.devicePixelRatio || 1)
    canvas.width = Math.max(2, Math.floor(width * scale))
    canvas.height = Math.max(2, Math.floor(height * scale))
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    if (!ui) return
    const box = stageFit(width, height)
    ui.style.left = `${box.x}px`
    ui.style.top = `${box.y}px`
    ui.style.width = `${box.width}px`
    ui.style.height = `${box.height}px`
  }
  fit()
  window.addEventListener('resize', fit)
  window.visualViewport?.addEventListener('resize', fit)
  window.visualViewport?.addEventListener('scroll', () => {
    if (fieldFocused()) window.scrollTo(0, 0)
  })
  const screen = canvas as unknown as HostCanvas
  const video = document.getElementById('boot') as HTMLVideoElement | null
  const hit = ui ?? canvas
  let bootMark = 0
  let bootBad = false
  let ctx: AudioContext | null = null
  let fxVolume = 1
  const musicVoice = createBrowserMusic()
  if (video) {
    video.addEventListener('playing', () => {
      if (!bootMark) bootMark = performance.now()
      video.style.zIndex = '3'
    })
    video.addEventListener('error', () => { bootBad = true })
  }
  let web: WebAudioHost | null | undefined
  const ensureWeb = (): WebAudioHost | null => {
    if (web !== undefined) return web
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) {
      web = null
      return web
    }
    ctx = new Ctx()
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
      if (spatial) {
        panner = ctx.createPanner()
        panner.panningModel = 'HRTF'
        panner.distanceModel = 'inverse'
        panner.refDistance = refDistance
        panner.maxDistance = maxDistance
        panner.positionX.value = x
        panner.positionY.value = y
        panner.positionZ.value = z
        source.connect(panner)
        panner.connect(gain)
      } else {
        source.connect(gain)
      }
      gain.connect(ctx.destination)
      source.start()
      return {
        setPosition(px, py, pz) {
          if (!panner) return
          panner.positionX.value = px
          panner.positionY.value = py
          panner.positionZ.value = pz
        },
        setGain(v) { gain.gain.value = Math.max(0, v) },
        stop() {
          gain.gain.value = 0
          try { gain.disconnect() } catch { /* already detached */ }
          try { source.stop() } catch { /* ended */ }
          try { source.disconnect() } catch { /* already detached */ }
        },
      }
    }
    web = {
      playLoop(seconds, freq, x, y, z, refDistance, maxDistance): SpatialVoice {
        const rate = ctx.sampleRate
        const length = Math.floor(rate * seconds)
        const buffer = ctx.createBuffer(1, length, rate)
        const data = buffer.getChannelData(0)
        for (let i = 0; i < length; i++) data[i] = Math.sin((i / rate) * freq * Math.PI * 2) * 0.15
        return start(buffer, true, true, x, y, z, refDistance, maxDistance)
      },
      playClip(clip, loop, spatial, x, y, z, refDistance, maxDistance): SpatialVoice {
        return start(clip as AudioBuffer, loop, spatial, x, y, z, refDistance, maxDistance)
      },
      beep(freq, seconds) {
        const rate = ctx.sampleRate
        const length = Math.max(1, Math.floor(rate * seconds))
        const buffer = ctx.createBuffer(1, length, rate)
        const data = buffer.getChannelData(0)
        const amp = 0.22 * fxVolume
        for (let i = 0; i < length; i++) {
          const env = 1 - i / length
          data[i] = Math.sin((i / rate) * freq * Math.PI * 2) * amp * env
        }
        const source = ctx.createBufferSource()
        source.buffer = buffer
        source.connect(ctx.destination)
        source.start()
      },
      setFxVolume(v) { fxVolume = Math.max(0, Math.min(1, v)) },
      decode(data: ArrayBuffer): Promise<AudioClip> {
        const copy = data.slice(0)
        return new Promise((resolve, reject) => {
          const pending = ctx.decodeAudioData(copy, (buf) => resolve(buf), reject)
          if (pending && typeof (pending as Promise<AudioBuffer>).then === 'function') {
            ;(pending as Promise<AudioBuffer>).then(resolve, reject)
          }
        })
      },
      setListener(x, y, z, fx, fy, fz) {
        const listener = ctx.listener
        listener.positionX.value = x
        listener.positionY.value = y
        listener.positionZ.value = z
        listener.forwardX.value = fx
        listener.forwardY.value = fy
        listener.forwardZ.value = fz
        listener.upX.value = 0
        listener.upY.value = 1
        listener.upZ.value = 0
      },
      running() { return ctx.state === 'running' },
      suspend() { void ctx.suspend() },
      resume() { void ctx.resume() },
    }
    return web
  }
  const kick = () => {
    void video?.play().catch(() => { /* still muted; a later tap retries */ })
    const audio = ensureWeb()
    if (!audio || !ctx) return
    const buffer = ctx.createBuffer(1, 1, ctx.sampleRate)
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(ctx.destination)
    try { source.start() } catch { /* already started */ }
    audio.resume()
    musicVoice.resume()
  }
  window.addEventListener('pointerdown', kick, { capture: true })
  window.addEventListener('keydown', kick, { capture: true })
  return {
    kind: 'browser',
    allowGlExtensions: true,
    uiOnScreen: ui != null,
    screen,
    createOffscreen(width, height) {
      const off = document.createElement('canvas')
      off.width = width
      off.height = height
      return off as unknown as HostCanvas
    },
    raf: (cb) => requestAnimationFrame(cb),
    cancelRaf: (id) => cancelAnimationFrame(id),
    now: () => performance.now(),
    uiCanvas(width, height) {
      if (!ui) {
        const off = document.createElement('canvas')
        off.width = width
        off.height = height
        return off as unknown as HostCanvas
      }
      ui.width = width
      ui.height = height
      return ui as unknown as HostCanvas
    },
    openBootVideo(url) {
      if (!video) return
      video.style.display = 'block'
      video.muted = true
      video.loop = true
      video.playsInline = true
      video.preload = 'auto'
      const wanted = url.charAt(0) === '/' ? url : `/${url}`
      const current = video.currentSrc ? new URL(video.currentSrc, location.href).pathname : ''
      if (!current.endsWith(wanted)) {
        bootMark = 0
        bootBad = false
        video.src = url
      }
      void video.play().catch(() => { /* autoplay can wait for a gesture */ })
    },
    bootReady(sinceBoot) {
      if (!video) return sinceBoot >= 1200
      if (bootBad) return true
      if (bootMark > 0 && performance.now() - bootMark >= 1100) return true
      // A cold visit can spend several seconds just fetching the video.
      // Don't hold the first music behind a clip that hasn't shown a frame.
      return sinceBoot >= 2200
    },
    closeBootVideo() {
      if (!video) return
      video.pause()
      video.removeAttribute('src')
      video.load()
      video.style.display = 'none'
    },
    onTouch(start, move, end) {
      const local = (ev: PointerEvent): TouchPoint => {
        const r = hit.getBoundingClientRect()
        return { id: ev.pointerId, x: ev.clientX - r.left, y: ev.clientY - r.top }
      }
      hit.addEventListener('pointerdown', (ev) => {
        start(local(ev))
        kick()
      })
      hit.addEventListener('pointermove', (ev) => { if (ev.buttons) move(local(ev)) })
      hit.addEventListener('pointerup', (ev) => end(local(ev)))
      hit.addEventListener('pointercancel', (ev) => end(local(ev)))
    },
    async download(url) {
      const res = await fetch(url)
      if (!res.ok) throw new Error(String(res.status))
      return res.arrayBuffer()
    },
    storageGet: (key) => localStorage.getItem(key),
    storageSet: (key, value) => localStorage.setItem(key, value),
    storageRemove: (key) => localStorage.removeItem(key),
    innerAudio(): InnerVoice {
      const audio = new Audio()
      audio.crossOrigin = 'anonymous'
      return {
        play(url, loop) { audio.src = url; audio.loop = loop; void audio.play() },
        setVolume(v) { audio.volume = Math.max(0, Math.min(1, v)) },
        stop() { audio.pause() },
      }
    },
    music: () => musicVoice,
    webAudio(): WebAudioHost | null {
      return ensureWeb()
    },
    async login() { return null },
    onHide() {},
    onShow() {},
    system() {
      const { width, height } = screenSize()
      return {
        width,
        height,
        dpr: Math.min(window.devicePixelRatio || 1, 2),
        capsule: null,
      }
    },
    stageBox() {
      if (ui && hit === ui) {
        const r = ui.getBoundingClientRect()
        return { x: 0, y: 0, width: r.width, height: r.height }
      }
      const { width, height } = screenSize()
      return stageFit(width, height)
    },
    launchSuccess() {},
    async network() { return navigator.onLine ? 'wifi' : 'none' },
  }
}
