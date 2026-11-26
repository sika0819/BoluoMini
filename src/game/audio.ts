import type { AudioClip, Host, MusicVoice, SpatialVoice } from '../host/types'
import { BANKS, CLIPS, grassClip, weatherClip } from './catalog'
import { ambienceFor, type AmbienceBed } from '../scene/world'
import { CAMPFIRE_X, CAMPFIRE_Z, FIRE_FULL, FIRE_REACH } from '../scene/campfire'
import type { SceneKind } from '../scene/island'
import type { WeatherKind } from './catalog'

interface BedRuntime extends AmbienceBed {
  voice: SpatialVoice | null
  src: string
}

/** Display dB → engine dB. 0 stays 0; −17.25 lands near −96. */
function engineDb(display: number): number {
  if (display >= -9) return display
  if (display >= -12) return -9 + 3 * (display + 9)
  if (display >= -15) return -18 + 6 * (display + 12)
  return -36 + (80 / 3) * (display + 15)
}

/** Full volume inside `full` meters, then the shared curve down to silence at `reach`. */
function distanceGain(dist: number, full: number, reach: number, trimDb: number): number {
  if (dist >= reach) return 0
  let display = 0
  if (dist > full && reach > full) display = -17.25 * ((dist - full) / (reach - full))
  return 10 ** ((engineDb(display) + trimDb) / 20)
}

export class Ambience {
  private zones: BedRuntime[]
  private musicGain = 0.8
  private fxGain = 0.8
  private uncovered = false
  private paused = false
  private clips = new Map<string, AudioClip>()
  private pending = new Map<string, ArrayBuffer>()
  private failedAt = new Map<string, number>()
  private loading = new Set<string>()
  private musicName = ''
  private song: MusicVoice
  private musicElapsed = 0
  private musicMark = 0
  private musicDuration = 0
  /** True after the current file has actually started. The wall clock waits for this. */
  private musicHeard = false
  private levelArmed = false
  /** Period used to start the grass bed before the world is uncovered. */
  private bedPeriod = 0
  /** Fires once when the selected level's clip actually starts. */
  onLevelStart: ((seconds: number) => void) | null = null
  private beds = new Map<string, { src: string; voice: SpatialVoice }>()
  /** 0 cold, 1 fully lit. The clip only plays while the pile is burning. */
  private flame = 0
  private flameVoice: SpatialVoice | null = null
  private flameSrc = BANKS.find((b) => b.name === 'Campfire')?.src ?? ''

  constructor(private host: Host) {
    this.song = host.music()
    this.zones = this.bind('meadow')
    // Effects do not wait for a dialog or a tap. Resume as soon as the context exists.
    this.host.webAudio()?.resume()
  }

  private bind(scene: SceneKind): BedRuntime[] {
    return ambienceFor(scene).map((bed) => ({
      ...bed,
      voice: null,
      src: BANKS.find((b) => b.name === bed.name)?.src ?? '',
    }))
  }

  setScene(scene: SceneKind): void {
    this.stopZones()
    this.zones = this.bind(scene)
  }

  setVolumes(music: number, fx: number): void {
    this.musicGain = music
    this.fxGain = fx
    // Music is a media element. Effects stay on WebAudio gains, including beeps.
    this.song.setVolume(this.musicGain)
    this.host.webAudio()?.setFxVolume(this.fxGain)
  }

  /** Night ignition, already eased. 0 keeps the pile silent. */
  setFlame(level: number): void {
    this.flame = Math.max(0, Math.min(1, level))
  }

  /** Empty name stops the track. Only one music voice is ever running. */
  setMusic(name: string): void {
    if (name === this.musicName) {
      this.song.setVolume(this.musicGain)
      return
    }
    this.musicName = name
    this.stopMusic()
    this.musicElapsed = 0
    this.musicDuration = 0
    this.levelArmed = false
    this.startSong(name)
  }

  /**
   * Restart a track from the beginning.
   * `tour` arms the step round for the moment the clip actually starts.
   */
  playMusic(name: string, tour: boolean): void {
    this.levelArmed = false
    this.musicName = ''
    this.stopMusic()
    this.musicElapsed = 0
    this.musicMark = 0
    this.musicDuration = 0
    if (!name) return
    this.levelArmed = tour
    this.musicName = name
    this.startSong(name)
  }

  /**
   * Seconds into the file. The element clock wins once it is moving,
   * so a landing stays on the beat you hear. The wall clock covers the
   * moment before the element reports a position.
   */
  songSeconds(): number {
    if (!this.musicHeard) return 0
    const at = this.song.position()
    if (at > 0.02) return at
    return this.musicElapsed / 1000
  }

  /** Drop a tour arm if the song has not started yet. */
  cancelLevel(): void {
    this.levelArmed = false
  }

  /** One shot when the current clip reaches its end. The voice is dropped. */
  takeEnded(): boolean {
    if (!this.songOver()) return false
    this.musicDuration = 0
    this.stopMusic()
    return true
  }

  /** Advance the song clock only while playback is actually running. */
  tickMusic(now: number, running: boolean): void {
    if (!this.musicHeard) {
      if (this.musicName && this.song.started()) {
        const dur = this.song.duration()
        if (dur > 0) {
          this.musicHeard = true
          this.musicDuration = dur
          this.musicElapsed = 0
          this.musicMark = now
          if (this.levelArmed) {
            this.levelArmed = false
            this.onLevelStart?.(dur)
          }
        }
      }
      this.musicMark = now
      return
    }
    if (!this.musicDuration) {
      this.musicMark = now
      return
    }
    if (running && this.musicMark) this.musicElapsed += Math.max(0, now - this.musicMark)
    this.musicMark = now
  }

  songOver(): boolean {
    return this.musicHeard && this.musicDuration > 0 && this.musicElapsed >= this.musicDuration * 1000
  }

  private startSong(name: string): void {
    const src = BANKS.find((b) => b.name === name)?.src
    if (!src) return
    this.song.setVolume(this.musicGain)
    this.song.load(src, true)
  }

  /** Start the song file while the loading page is still up. Playback waits for uncover(). */
  warmTrack(name: string): void {
    const src = BANKS.find((b) => b.name === name)?.src
    if (src) this.song.warm(src)
  }

  private stopMusic(): void {
    this.musicHeard = false
    this.song.stop()
  }

  uncover(): void {
    this.uncovered = true
    this.host.webAudio()?.resume()
    if (this.musicName) this.song.resume()
  }

  /** Start the bed download before the context is allowed to play. */
  prime(period: number): void {
    this.bedPeriod = ((period % 4) + 4) % 4
    this.host.webAudio()?.resume()
    this.clip(grassClip(this.bedPeriod, 'clear'))
    if (this.flameSrc) this.clip(this.flameSrc)
  }

  /**
   * Warm the context and the grass clip while the loading page is up.
   * Beds stay silent until uncover(), which waits for that page to hide.
   */
  pump(): void {
    if (this.paused || this.uncovered) return
    const web = this.host.webAudio()
    if (web && !web.running()) web.resume()
    this.clip(grassClip(this.bedPeriod, 'clear'))
  }

  pause(): void {
    this.paused = true
    this.host.webAudio()?.suspend()
    this.song.pause()
  }

  resume(): void {
    this.paused = false
    if (!this.uncovered) return
    this.host.webAudio()?.resume()
    if (this.musicName) this.song.resume()
  }

  update(
    now: number,
    x: number,
    y: number,
    z: number,
    fx: number,
    fy: number,
    fz: number,
    weather: WeatherKind,
    weatherLevel: number,
    period: number,
  ): void {
    if (!this.uncovered || this.paused) return
    // Download even while autoplay is blocked, so the first tap is not silent.
    this.clip(grassClip(period, weather))
    const web = this.host.webAudio()
    if (web && !web.running()) {
      web.resume()
      this.syncMusic()
      return
    }
    web?.setListener(x, y, z, fx, fy, fz)
    this.syncMusic()
    let nearWater = false
    let best: BedRuntime | null = null
    let bestGain = 0
    const heard: Array<{ zone: BedRuntime; gain: number }> = []
    let waterGain = 0
    for (const zone of this.zones) {
      const gain = zone.src ? distanceGain(zone.distance(x, z, y), zone.full, zone.reach, zone.trimDb) : 0
      heard.push({ zone, gain })
      const wet = zone.name.startsWith('Ocean') || zone.name.startsWith('River') || zone.name.startsWith('Waterfall') || zone.name.startsWith('Lake')
      if (gain > 0 && wet) nearWater = true
      if (wet && gain > waterGain) waterGain = gain
      if (gain > bestGain) {
        best = zone
        bestGain = gain
      }
    }
    const current = this.zones.find((zone) => zone.voice)
    const currentGain = heard.find((item) => item.zone === current)?.gain ?? 0
    if (current && currentGain > 0 && currentGain >= bestGain * 0.85) {
      best = current
      bestGain = currentGain
    }
    for (const { zone, gain } of heard) {
      const active = zone === best && gain > 0
      if (active && !zone.voice && web) {
        const clip = this.clip(zone.src)
        if (clip) zone.voice = web.playClip(clip, true, false, x, y, z, zone.full, zone.reach)
      }
      if (!active && zone.voice) {
        zone.voice.stop()
        zone.voice = null
      } else if (zone.voice) {
        zone.voice.setGain(this.fxGain * gain)
      }
    }
    const level = Math.max(0, weatherLevel)
    const windSrc = weather === 'wind' && level > 0 ? weatherClip('wind', level) : ''
    const rainSrc = weather === 'rain' && level > 0 ? weatherClip('rain', level) : ''
    const waterSrc = rainSrc && nearWater ? CLIPS.Rain_Water : ''
    const rainDuck = rainSrc ? 0.4 : 1
    const grassGain = this.fxGain * 0.7 * rainDuck * (1 - 0.45 * waterGain)
    this.syncBed(web, 'grass', grassClip(period, weather), grassGain)
    this.syncBed(web, 'wind', windSrc, this.fxGain * 0.7)
    this.syncBed(web, 'rain', rainSrc, this.fxGain * 0.75)
    this.syncBed(web, 'rain-water', waterSrc, this.fxGain * 0.45)
    this.syncFlame(web, x, z)
  }

  /** Retry the playlist element until a gesture lets it start. Effects stay on `web`. */
  private syncMusic(): void {
    if (!this.musicName || this.paused) return
    this.song.setVolume(this.musicGain)
    this.song.resume()
  }

  private syncBed(web: ReturnType<Host['webAudio']>, key: string, src: string, gain: number): void {
    const current = this.beds.get(key)
    if (!src) {
      current?.voice.stop()
      this.beds.delete(key)
      return
    }
    if (current && current.src === src) {
      current.voice.setGain(gain)
      return
    }
    current?.voice.stop()
    this.beds.delete(key)
    if (!web) return
    const clip = this.clip(src)
    if (!clip) return
    const voice = web.playClip(clip, true, false, 0, 0, 0, 1, 1)
    voice.setGain(gain)
    this.beds.set(key, { src, voice })
  }

  private clip(src: string): AudioClip | null {
    const cached = this.clips.get(src)
    if (cached) return cached
    const buf = this.pending.get(src)
    const web = buf ? this.host.webAudio() : null
    if (buf && web && !this.loading.has(src)) {
      this.loading.add(src)
      void web.decode(buf).then((decoded) => {
        this.clips.set(src, decoded)
        this.pending.delete(src)
        this.loading.delete(src)
      }).catch(() => {
        this.pending.delete(src)
        this.failedAt.set(src, Date.now())
        this.loading.delete(src)
      })
    }
    if (buf || this.loading.has(src)) return null
    const failed = this.failedAt.get(src) ?? 0
    if (failed && Date.now() - failed < 2500) return null
    this.loading.add(src)
    void this.host.download(src).then((data) => {
      this.pending.set(src, data)
      this.loading.delete(src)
      this.clip(src)
    }).catch(() => {
      this.failedAt.set(src, Date.now())
      this.loading.delete(src)
    })
    return null
  }

  stopAll(): void {
    this.stopZones()
    this.musicName = ''
    this.stopMusic()
    this.flameVoice?.stop()
    this.flameVoice = null
    for (const bed of this.beds.values()) bed.voice.stop()
    this.beds.clear()
  }

  /** Horizontal falloff from the pile. The voice is not spatial, so the curve is not applied twice. */
  private syncFlame(web: ReturnType<Host['webAudio']>, x: number, z: number): void {
    if (!this.flameSrc) return
    const dist = Math.hypot(x - CAMPFIRE_X, z - CAMPFIRE_Z)
    const heard = this.fxGain * distanceGain(dist, FIRE_FULL, FIRE_REACH, 0) * this.flame
    if (heard <= 0.0008) {
      this.flameVoice?.stop()
      this.flameVoice = null
      return
    }
    if (!this.flameVoice && web) {
      const clip = this.clip(this.flameSrc)
      if (clip) this.flameVoice = web.playClip(clip, true, false, 0, 0, 0, 1, 1)
    }
    this.flameVoice?.setGain(heard)
  }

  private stopZones(): void {
    for (const zone of this.zones) {
      zone.voice?.stop()
      zone.voice = null
    }
  }
}
