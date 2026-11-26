export type SkyWeather = 'clear' | 'cloud' | 'rain' | 'fog' | 'wind'

export interface ClockSample {
  sampledAt: number
  wallMs: number
}

export interface LiveSky {
  place: string
  weather: SkyWeather
  level: number
  label: string
  temp: number
  clock: ClockSample
  lat: number
  lon: number
}

interface Place {
  lat: number
  lon: number
  timezone: string
}

const PLACE: Record<string, string> = {
  Beijing: '北京',
  Shanghai: '上海',
  Guangzhou: '广州',
  Shenzhen: '深圳',
  Chengdu: '成都',
  Hangzhou: '杭州',
  Wuhan: '武汉',
  Nanjing: '南京',
  Chongqing: '重庆',
  Tianjin: '天津',
  Suzhou: '苏州',
  "Xi'an": '西安',
  Xian: '西安',
  Zhengzhou: '郑州',
  Changsha: '长沙',
  Qingdao: '青岛',
  Dalian: '大连',
  Xiamen: '厦门',
  Kunming: '昆明',
  Hefei: '合肥',
  Fuzhou: '福州',
  Jinan: '济南',
  Harbin: '哈尔滨',
  Shenyang: '沈阳',
  Changchun: '长春',
  Nanning: '南宁',
  Nanchang: '南昌',
  Guiyang: '贵阳',
  Lanzhou: '兰州',
  Taiyuan: '太原',
  Shijiazhuang: '石家庄',
  Hohhot: '呼和浩特',
  Urumqi: '乌鲁木齐',
  Lhasa: '拉萨',
  Haikou: '海口',
  Yinchuan: '银川',
  Xining: '西宁',
  Ningbo: '宁波',
  Wuxi: '无锡',
  Foshan: '佛山',
  Dongguan: '东莞',
}

const RAIN_LIGHT = new Set([176, 263, 266, 293, 296, 353])
const RAIN_MID = new Set([299, 302, 356])
const RAIN_HEAVY = new Set([305, 308, 359])
const THUNDER = new Set([200, 386, 389])
const SNOW_LIGHT = new Set([179, 323, 326, 368])
const SNOW_MID = new Set([227, 329, 332, 371])
const SNOW_HEAVY = new Set([230, 335, 338, 392, 395])
const SLEET = new Set([182, 185, 281, 284, 311, 314, 317, 320, 350, 362, 365, 374, 377])

/** Until a fix arrives, latitude is the Yangtze delta and longitude follows the device zone. */
export function deviceGeo(): { lat: number; lon: number } {
  const lon = Math.max(-180, Math.min(180, -new Date().getTimezoneOffset() / 4))
  return { lat: 31.23, lon }
}

export function deviceClock(now: number): ClockSample {
  const d = new Date(now)
  return {
    sampledAt: now,
    wallMs: Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()),
  }
}

export function readClock(sample: ClockSample, now: number): { hours: number; text: string; day: string } {
  const d = new Date(sample.wallMs + (now - sample.sampledAt))
  const h = d.getUTCHours()
  const m = d.getUTCMinutes()
  const s = d.getUTCSeconds()
  return {
    hours: h + m / 60 + s / 3600,
    text: `${pad(h)}:${pad(m)}`,
    day: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
  }
}

/** 清晨在左侧。6 点为 0°，之后顺时针走过正午、黄昏、夜晚。 */
export function handDegrees(hours: number): number {
  const deg = ((hours - 6) / 24) * 360
  return ((deg % 360) + 360) % 360
}

export async function fetchLiveSky(now = Date.now()): Promise<LiveSky> {
  const where = await locate().catch(() => null)
  const zone = where?.timezone || 'Asia/Shanghai'
  const [clockRes, weatherRes, placeRes] = await Promise.allSettled([
    fetchClock(zone),
    fetchWeather(where),
    where ? chinesePlace(where.lat, where.lon) : Promise.resolve(''),
  ])
  if (clockRes.status === 'rejected' && weatherRes.status === 'rejected') {
    throw clockRes.reason instanceof Error ? clockRes.reason : new Error('live')
  }
  const clock = clockRes.status === 'fulfilled' ? clockRes.value : deviceClock(now)
  const weather = weatherRes.status === 'fulfilled'
    ? weatherRes.value
    : { place: '', weather: 'clear' as const, level: 1, label: '', temp: Number.NaN }
  const place = placeRes.status === 'fulfilled' && placeRes.value ? placeRes.value : weather.place
  const geo = where ?? deviceGeo()
  return { clock, ...weather, place, lat: geo.lat, lon: geo.lon }
}

export function mapWeather(code: number, windKmh: number, cloud: number): { weather: SkyWeather; level: number; label: string } {
  if (RAIN_LIGHT.has(code)) return { weather: 'rain', level: 1, label: '小雨' }
  if (RAIN_MID.has(code)) return { weather: 'rain', level: 2, label: '中雨' }
  if (RAIN_HEAVY.has(code)) return { weather: 'rain', level: 3, label: '大雨' }
  if (THUNDER.has(code)) return { weather: 'rain', level: 3, label: '雷雨' }
  if (SLEET.has(code)) return { weather: 'rain', level: 1, label: '雨夹雪' }
  if (SNOW_LIGHT.has(code)) return { weather: 'fog', level: 1, label: '小雪' }
  if (SNOW_MID.has(code)) return { weather: 'fog', level: 2, label: '中雪' }
  if (SNOW_HEAVY.has(code)) return { weather: 'fog', level: 3, label: '大雪' }
  if (code === 143) return { weather: 'fog', level: 1, label: '轻雾' }
  if (code === 248) return { weather: 'fog', level: 2, label: '雾' }
  if (code === 260) return { weather: 'fog', level: 3, label: '浓雾' }
  if (code === 116) return windOr({ weather: 'cloud', level: 1, label: '少云' }, windKmh)
  if (code === 119) return windOr({ weather: 'cloud', level: 1, label: '多云' }, windKmh)
  if (code === 122) return windOr({ weather: 'cloud', level: 1, label: '阴' }, windKmh)
  if (code === 113 || cloud < 30) return windOr({ weather: 'clear', level: 1, label: '晴' }, windKmh)
  if (cloud >= 75) return windOr({ weather: 'cloud', level: 1, label: '阴' }, windKmh)
  return windOr({ weather: 'cloud', level: 1, label: '多云' }, windKmh)
}

function windOr(
  base: { weather: SkyWeather; level: number; label: string },
  windKmh: number,
): { weather: SkyWeather; level: number; label: string } {
  if (base.weather !== 'clear' && base.weather !== 'cloud') return base
  if (windKmh >= 50) return { weather: 'wind', level: 3, label: '大风' }
  if (windKmh >= 38) return { weather: 'wind', level: 2, label: '大风' }
  if (windKmh >= 28) return { weather: 'wind', level: 1, label: '有风' }
  return base
}

async function locate(): Promise<Place | null> {
  const gps = await gpsIfGranted()
  if (gps) return gps
  const data = await getJson('https://get.geojs.io/v1/ip/geo.json')
  const lat = num((data as { latitude?: unknown }).latitude)
  const lon = num((data as { longitude?: unknown }).longitude)
  const timezone = text((data as { timezone?: unknown }).timezone) || 'Asia/Shanghai'
  if (lat == null || lon == null) return null
  return { lat, lon, timezone }
}

function gpsIfGranted(): Promise<Place | null> {
  const nav = typeof navigator === 'undefined' ? undefined : navigator
  if (!nav?.geolocation || !nav.permissions?.query) return Promise.resolve(null)
  return nav.permissions.query({ name: 'geolocation' }).then((status) => {
    if (status.state !== 'granted') return null
    return new Promise<Place | null>((resolve) => {
      nav.geolocation.getCurrentPosition(
        (pos) => {
          const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai'
          resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, timezone: zone })
        },
        () => resolve(null),
        { enableHighAccuracy: false, timeout: 4000, maximumAge: 600000 },
      )
    })
  }).catch(() => null)
}

async function chinesePlace(lat: number, lon: number): Promise<string> {
  const data = await getJson(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=zh`)
  const row = data as { city?: unknown; locality?: unknown }
  const city = text(row.city).replace(/市$/, '')
  if (city) return city
  return text(row.locality)
}

async function fetchClock(zone: string): Promise<ClockSample> {
  const data = await getJson(`https://timeapi.io/api/time/current/zone?timeZone=${encodeURIComponent(zone)}`)
  const iso = text((data as { dateTime?: unknown }).dateTime)
  const sample = iso ? parseWall(iso, Date.now()) : null
  if (!sample) throw new Error('time')
  return sample
}

async function fetchWeather(where: Place | null): Promise<Pick<LiveSky, 'place' | 'weather' | 'level' | 'label' | 'temp'>> {
  const loc = where ? `/${where.lat.toFixed(2)},${where.lon.toFixed(2)}` : ''
  const data = await getJson(`https://wttr.in${loc}?format=j1`)
  const root = data as {
    current_condition?: Array<Record<string, unknown>>
    nearest_area?: Array<{ areaName?: Array<{ value?: string }> }>
  }
  const current = root.current_condition?.[0]
  if (!current) throw new Error('weather')
  const code = num(current.weatherCode) ?? 113
  const wind = num(current.windspeedKmph) ?? 0
  const cloud = num(current.cloudcover) ?? 0
  const temp = num(current.temp_C) ?? Number.NaN
  const mapped = mapWeather(code, wind, cloud)
  const area = root.nearest_area?.[0]?.areaName?.[0]?.value || ''
  return { place: placeName(area), temp, ...mapped }
}

function parseWall(iso: string, sampledAt: number): ClockSample | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(iso)
  if (!m) return null
  return {
    sampledAt,
    wallMs: Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])),
  }
}

function placeName(raw: string): string {
  const name = raw.trim()
  return PLACE[name] || name || '当地'
}

interface MiniRequest {
  request?: (opts: {
    url: string
    method: string
    header: Record<string, string>
    responseType: string
    success: (res: { statusCode?: number; data?: ArrayBuffer | string }) => void
    fail: () => void
  }) => void
}

function loadText(url: string): Promise<string> {
  const scope = globalThis as { wx?: MiniRequest; tt?: MiniRequest; bl?: MiniRequest; fetch?: typeof fetch }
  const mini = scope.wx?.request ? scope.wx : scope.tt?.request ? scope.tt : scope.bl?.request ? scope.bl : null
  if (mini?.request && typeof fetch !== 'function') {
    return new Promise((resolve, reject) => {
      mini.request?.({
        url,
        method: 'GET',
        header: {},
        responseType: 'text',
        success: (res) => {
          const data = res.data
          if (typeof data === 'string') resolve(data)
          else if (data instanceof ArrayBuffer) resolve(new TextDecoder().decode(data))
          else reject(new Error('network'))
        },
        fail: () => reject(new Error('network')),
      })
    })
  }
  return fetch(url).then((res) => {
    if (!res.ok) throw new Error(String(res.status))
    return res.text()
  })
}

function getJson(url: string): Promise<unknown> {
  const work = loadText(url).then((text) => JSON.parse(text) as unknown)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), 8000)
    work.then((value) => {
      clearTimeout(timer)
      resolve(value)
    }, (err) => {
      clearTimeout(timer)
      reject(err instanceof Error ? err : new Error('network'))
    })
  })
}

function num(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isFinite(n) ? n : null
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}
