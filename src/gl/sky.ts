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

const LOOKS: SkyLook[] = [
  {
    zen: [0.29, 0.62, 0.90], mid: [0.55, 0.78, 0.94], low: [0.95, 0.82, 0.70],
    hor: [1.0, 0.90, 0.72], horSun: [1.0, 0.95, 0.78], disc: [1.0, 0.96, 0.82],
    cloudLit: [1, 0.97, 0.90], cloudMid: [0.96, 0.88, 0.80], cloudSh: [0.62, 0.70, 0.86], cloudDeep: [0.45, 0.55, 0.78],
    night: 0,
  },
  {
    zen: [0.165, 0.518, 0.933], mid: [0.239, 0.608, 0.957], low: [0.439, 0.718, 0.965],
    hor: [0.706, 0.859, 0.969], horSun: [0.847, 0.929, 0.984], disc: [1, 0.984, 0.902],
    cloudLit: [1, 1, 1], cloudMid: [0.902, 0.937, 0.984], cloudSh: [0.643, 0.749, 0.914], cloudDeep: [0.486, 0.616, 0.839],
    night: 0,
  },
  {
    zen: [0.310, 0.408, 0.847], mid: [0.604, 0.525, 0.886], low: [1, 0.561, 0.651],
    hor: [1, 0.616, 0.322], horSun: [1, 0.843, 0.369], disc: [1, 0.945, 0.722],
    cloudLit: [1, 0.800, 0.447], cloudMid: [1, 0.498, 0.576], cloudSh: [0.482, 0.325, 0.761], cloudDeep: [0.275, 0.220, 0.604],
    night: 0.15,
  },
  {
    zen: [0.114, 0.133, 0.400], mid: [0.263, 0.216, 0.553], low: [0.596, 0.325, 0.651],
    hor: [0.949, 0.471, 0.361], horSun: [1, 0.682, 0.392], disc: [1, 0.690, 0.439],
    cloudLit: [0.918, 0.541, 0.549], cloudMid: [0.455, 0.345, 0.659], cloudSh: [0.204, 0.188, 0.435], cloudDeep: [0.129, 0.129, 0.314],
    night: 1,
  },
]

export function skyLook(period: number): SkyLook {
  const i = Math.max(0, Math.min(LOOKS.length - 1, period))
  return LOOKS[i]
}

export function skyCover(weather: 'clear' | 'cloud' | 'rain' | 'fog' | 'wind'): number {
  if (weather === 'rain') return 0.92
  if (weather === 'cloud') return 0.68
  if (weather === 'wind') return 0.5
  if (weather === 'fog') return 0.4
  return 0.26
}
