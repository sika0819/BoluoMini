export type HostKind = 'wechat' | 'douyin' | 'bilibili' | 'browser'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface HostCanvas {
  width: number
  height: number
  getContext(kind: 'webgl', attrs?: WebGLContextAttributes): WebGLRenderingContext | null
  getContext(kind: '2d'): CanvasRenderingContext2D | null
}

export interface TouchPoint {
  id: number
  x: number
  y: number
}

export interface InnerVoice {
  play(url: string, loop: boolean): void
  setVolume(v: number): void
  stop(): void
}

/**
 * Playlist music. A media element, not a WebAudio gain, so its volume
 * cannot overwrite rain, wind, grass, or other effects.
 */
export interface MusicVoice {
  /** Empty url stops. `restart` plays the same url again from the beginning. */
  load(url: string, restart: boolean): void
  /** Buffer a song during the loading page. Stays silent until load() or resume(). */
  warm(url: string): void
  setVolume(v: number): void
  /** Seconds. 0 until the file reports a duration. */
  duration(): number
  /** Seconds into the file. This is the clock the beat grid follows. */
  position(): number
  /** True once playback has actually begun for the current url. */
  started(): boolean
  stop(): void
  pause(): void
  resume(): void
}

export interface SpatialVoice {
  setPosition(x: number, y: number, z: number): void
  setGain(v: number): void
  stop(): void
}

/** Opaque decoded buffer owned by the host audio context. */
export interface AudioClip {
  readonly duration: number
}

export interface WebAudioHost {
  playLoop(
    seconds: number,
    freq: number,
    x: number,
    y: number,
    z: number,
    refDistance: number,
    maxDistance: number,
  ): SpatialVoice
  /** Loop a decoded clip. spatial=false plays it as a bed (music, weather). */
  playClip(
    clip: AudioClip,
    loop: boolean,
    spatial: boolean,
    x: number,
    y: number,
    z: number,
    refDistance: number,
    maxDistance: number,
  ): SpatialVoice
  decode(data: ArrayBuffer): Promise<AudioClip>
  setListener(x: number, y: number, z: number, fx: number, fy: number, fz: number): void
  /** Short non-spatial tone. Hit and miss feedback. Follows the effect volume. */
  beep(freq: number, seconds: number): void
  /** User sound-effect volume, 0–1. Scales beeps and is stored for later tones. */
  setFxVolume(v: number): void
  /** False while the context is waiting for a user gesture. */
  running(): boolean
  suspend(): void
  resume(): void
}

/** Code from wx.login / tt.login. Douyin also returns anonymousCode. */
export interface PlatformCode {
  code: string
  anonymousCode: string
}

export interface Host {
  readonly kind: HostKind
  /** Bilibili Android has no gl.getExtension. Renderer must not call it when false. */
  readonly allowGlExtensions: boolean
  readonly screen: HostCanvas
  createOffscreen(width: number, height: number): HostCanvas
  raf(cb: (timeMs: number) => void): number
  cancelRaf(id: number): void
  now(): number
  onTouch(
    start: (p: TouchPoint) => void,
    move: (p: TouchPoint) => void,
    end: (p: TouchPoint) => void,
  ): void
  download(url: string): Promise<ArrayBuffer>
  storageGet(key: string): string | null
  storageSet(key: string, value: string): void
  storageRemove(key: string): void
  innerAudio(): InnerVoice
  /** One playlist player for the life of the host. */
  music(): MusicVoice
  webAudio(): WebAudioHost | null
  login(): Promise<PlatformCode | null>
  onHide(cb: () => void): void
  onShow(cb: () => void): void
  system(): { width: number; height: number; dpr: number; capsule: Rect | null }
  /**
   * Rectangle that maps onto the 1125×2436 stage, in the same pixel space as touch points.
   * Browser points are relative to the UI element, so this box starts at 0.
   * Mini-game points are window coordinates and include the letterbox offset.
   */
  stageBox(): Rect
  launchSuccess(): void
  network(): Promise<'wifi' | 'cellular' | 'none'>
  /** Visible UI surface. Browser draws on this overlay; mini games use an offscreen canvas. */
  readonly uiOnScreen: boolean
  uiCanvas(width: number, height: number): HostCanvas
  openBootVideo(url: string): void
  closeBootVideo(): void
  /**
   * Browser keeps the boot video up until it has actually played, or gives up.
   * Mini hosts are ready as soon as the caller asks.
   */
  bootReady(sinceBoot: number): boolean
}
