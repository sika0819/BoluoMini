import { stageFit } from '../ui/fit'
import type { AudioClip, Host, HostCanvas, InnerVoice, SpatialVoice, TouchPoint, WebAudioHost } from './types'

/** Keep the 3D buffer near 720p. High-dpi panels were filling pixels, not triangles. */
function glScale(cssW: number, cssH: number, dpr: number): number {
  const cap = Math.min(Math.max(dpr, 1), 2)
  const area = Math.max(1, cssW * cssH)
  const budget = 1280 * 720
  if (area * cap * cap <= budget) return cap
  return Math.max(1, Math.min(cap, Math.sqrt(budget / area)))
}

export function createBrowserHost(): Host {
  const canvas = document.getElementById('boluo') as HTMLCanvasElement | null
    ?? document.querySelector('canvas')
  if (!canvas) throw new Error('missing canvas')
  const ui = document.getElementById('ui') as HTMLCanvasElement | null
  const fit = () => {
    const scale = glScale(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1)
    canvas.width = Math.max(2, Math.floor(window.innerWidth * scale))
    canvas.height = Math.max(2, Math.floor(window.innerHeight * scale))
    canvas.style.width = '100vw'
    canvas.style.height = '100vh'
    if (!ui) return
    const box = stageFit(window.innerWidth, window.innerHeight)
    ui.style.left = `${box.x}px`
    ui.style.top = `${box.y}px`
    ui.style.width = `${box.width}px`
    ui.style.height = `${box.height}px`
  }
  fit()
  window.addEventListener('resize', fit)
  const screen = canvas as unknown as HostCanvas
  const video = document.getElementById('boot') as HTMLVideoElement | null
  const hit = ui ?? canvas
  let web: WebAudioHost | null | undefined
  const ensureWeb = (): WebAudioHost | null => {
    if (web !== undefined) return web
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) {
      web = null
      return web
    }
    const ctx = new Ctx()
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
        setGain(v) { gain.gain.value = v },
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
      video.src = url
      void video.play().catch(() => { /* autoplay can wait for a gesture */ })
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
        // A context created during boot stays suspended until a real tap.
        // Create it inside the gesture so the first tap unlocks playback.
        void ensureWeb()?.resume()
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
    webAudio(): WebAudioHost | null {
      return ensureWeb()
    },
    async login() { return 'browser-guest' },
    onHide() {},
    onShow() {},
    system() {
      return {
        width: window.innerWidth,
        height: window.innerHeight,
        dpr: Math.min(window.devicePixelRatio || 1, 2),
        capsule: null,
      }
    },
    stageBox() {
      if (ui && hit === ui) {
        const r = ui.getBoundingClientRect()
        return { x: 0, y: 0, width: r.width, height: r.height }
      }
      return stageFit(window.innerWidth, window.innerHeight)
    },
    launchSuccess() {},
    async network() { return navigator.onLine ? 'wifi' : 'none' },
  }
}
