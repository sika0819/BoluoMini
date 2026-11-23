import type { AudioClip, Host, SpatialVoice } from '../host/types'
import { BANKS, CLIPS, weatherClip } from './catalog'
import { ambienceFor, type AmbienceBed } from '../scene/world'
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
  private loading = new Set<string>()
  private musicName = ''
  private musicVoice: SpatialVoice | null = null
  private beds = new Map<string, { src: string; voice: SpatialVoice }>()

  constructor(private host: Host) {
    this.zones = this.bind('p01')
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
    this.musicVoice?.setGain(this.musicGain)
  }

  /** Empty name stops the track. Only one music voice is ever running. */
  setMusic(name: string): void {
    if (name === this.musicName) {
      this.musicVoice?.setGain(this.musicGain)
      return
    }
    this.musicName = name
    this.stopMusic()
    const src = BANKS.find((b) => b.name === name)?.src
    if (src) this.clip(src)
  }

  private stopMusic(): void {
    this.musicVoice?.stop()
    this.musicVoice = null
  }

  uncover(): void {
    this.uncovered = true
    this.host.webAudio()?.resume()
  }

  /** Start the cued track as soon as the context is allowed to play, including during boot. */
  pump(): void {
    if (this.paused) return
    const web = this.host.webAudio()
    if (!web) return
    if (!web.running()) {
      web.resume()
      return
    }
    this.syncMusic(web)
  }

  pause(): void {
    this.paused = true
    this.host.webAudio()?.suspend()
  }

  resume(): void {
    this.paused = false
    if (this.uncovered) this.host.webAudio()?.resume()
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
  ): void {
    if (!this.uncovered || this.paused) return
    const web = this.host.webAudio()
    if (web && !web.running()) {
      web.resume()
      return
    }
    web?.setListener(x, y, z, fx, fy, fz)
    this.syncMusic(web)
    let nearWater = false
    let best: BedRuntime | null = null
    let bestGain = 0
    const heard: Array<{ zone: BedRuntime; gain: number }> = []
    for (const zone of this.zones) {
      const gain = zone.src ? distanceGain(zone.distance(x, z, y), zone.full, zone.reach, zone.trimDb) : 0
      heard.push({ zone, gain })
      if (gain > 0 && (zone.name.startsWith('Ocean') || zone.name.startsWith('River') || zone.name.startsWith('Waterfall'))) {
        nearWater = true
      }
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
    this.syncBed(web, 'wind', windSrc, this.fxGain * 0.7)
    this.syncBed(web, 'rain', rainSrc, this.fxGain * 0.75)
    this.syncBed(web, 'rain-water', waterSrc, this.fxGain * 0.45)
  }

  private syncMusic(web: ReturnType<Host['webAudio']>): void {
    if (!this.musicName || this.musicVoice || !web) return
    const name = this.musicName
    const src = BANKS.find((b) => b.name === name)?.src
    if (!src) return
    const clip = this.clip(src)
    if (!clip || this.musicName !== name || this.musicVoice) return
    this.stopMusic()
    this.musicVoice = web.playClip(clip, true, false, 0, 0, 0, 1, 1)
    this.musicVoice.setGain(this.musicGain)
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
    if (this.loading.has(src)) return null
    const web = this.host.webAudio()
    if (!web) return null
    this.loading.add(src)
    void this.host.download(src).then((buf) => web.decode(buf)).then((decoded) => {
      this.clips.set(src, decoded)
      this.loading.delete(src)
    }).catch(() => {
      this.loading.delete(src)
    })
    return null
  }

  stopAll(): void {
    this.stopZones()
    this.musicName = ''
    this.stopMusic()
    for (const bed of this.beds.values()) bed.voice.stop()
    this.beds.clear()
  }

  private stopZones(): void {
    for (const zone of this.zones) {
      zone.voice?.stop()
      zone.voice = null
    }
  }
}
