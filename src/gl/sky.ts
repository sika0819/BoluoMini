/** Paint palettes adapted from beautiful-wonderland (noon, sunset, dusk) plus a morning key. */
export type RGB3 = [number, number, number]

export interface SkyLook {
  zen: RGB3
  mid: RGB3
  low: RGB3
  hor: RGB3
  horSun: RGB3
  disc: RGB3
  cloudLit: RGB3
  cloudMid: RGB3
  cloudSh: RGB3
  cloudDeep: RGB3
  night: number
}

const hex = (h: number): RGB3 => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255]

/** Golden, noon, sunset, dusk — noon is the single scene. Keys from beautiful-wonderland. */
const LOOKS: SkyLook[] = [
  {
    zen: hex(0x3d8ee6), mid: hex(0x66a9f0), low: hex(0xb7d5ee),
    hor: hex(0xffe7b2), horSun: hex(0xfff2c4), disc: hex(0xfff6d0),
    cloudLit: hex(0xfff4dc), cloudMid: hex(0xf8dccb), cloudSh: hex(0xa3a9de), cloudDeep: hex(0x7e88cb),
    night: 0,
  },
  {
    zen: hex(0x2a84ee), mid: hex(0x3d9bf4), low: hex(0x70b7f6),
    hor: hex(0xb4dbf7), horSun: hex(0xd8edfb), disc: hex(0xfffbe6),
    cloudLit: hex(0xffffff), cloudMid: hex(0xe6effb), cloudSh: hex(0xa4bfe9), cloudDeep: hex(0x7c9dd6),
    night: 0,
  },
  {
    zen: hex(0x4f68d8), mid: hex(0x9a86e2), low: hex(0xff8fa6),
    hor: hex(0xff9d52), horSun: hex(0xffd75e), disc: hex(0xfff1b8),
    cloudLit: hex(0xffcc72), cloudMid: hex(0xff7f93), cloudSh: hex(0x7b53c2), cloudDeep: hex(0x46389a),
    night: 0.15,
  },
  {
    zen: hex(0x1d2266), mid: hex(0x43378d), low: hex(0x9853a6),
    hor: hex(0xf2785c), horSun: hex(0xffae64), disc: hex(0xffb070),
    cloudLit: hex(0xea8a8c), cloudMid: hex(0x7458a8), cloudSh: hex(0x34306f), cloudDeep: hex(0x212150),
    night: 1,
  },
]

export function skyLook(period: number): SkyLook {
  const i = Math.max(0, Math.min(LOOKS.length - 1, period))
  return LOOKS[i]
}

/** Targets the frame lerps toward. Densities stay in this island's scale, not the reference scene's. */
export interface WeatherGoal {
  rain: number
  wind: number
  fogScale: number
  fogAdd: number
  /** 0..1 height mist. Drizzle and fog pool it; heavy rain washes it out. */
  mist: number
  cover: number
}

export function weatherGoal(weather: 'clear' | 'cloud' | 'rain' | 'fog' | 'wind', level = 0): WeatherGoal {
  const t = Math.max(0, Math.min(3, level)) | 0
  if (weather === 'rain') {
    const rain = [0, 0.34, 0.7, 1][t]
    return {
      rain,
      wind: [0.32, 0.55, 0.95, 1.45][t],
      fogScale: 1,
      fogAdd: [0, 0.0015, 0.003, 0.0055][t],
      mist: [0, 0.28, 0.14, 0.04][t],
      cover: 0.58 + 0.1 * t,
    }
  }
  if (weather === 'fog') {
    return {
      rain: 0,
      wind: 0.16,
      fogScale: 1,
      fogAdd: [0, 0.0045, 0.008, 0.012][t],
      mist: [0, 0.48, 0.72, 0.92][t],
      cover: 0.34 + 0.08 * t,
    }
  }
  if (weather === 'wind') {
    return {
      rain: 0,
      wind: [0.22, 0.72, 1.25, 2.05][t],
      fogScale: 1 - 0.22 * t,
      fogAdd: 0,
      mist: 0,
      cover: Math.max(0.1, 0.46 - 0.12 * t),
    }
  }
  if (weather === 'cloud') {
    return {
      rain: 0,
      wind: 0.42,
      fogScale: 1.25,
      fogAdd: 0.0004,
      mist: 0.06,
      cover: 0.68,
    }
  }
  return {
    rain: 0,
    wind: 0.28,
    fogScale: 1,
    fogAdd: 0,
    mist: 0,
    cover: 0.26,
  }
}
