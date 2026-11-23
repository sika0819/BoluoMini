import { sha256 } from './sha256'
import { boluoEnv } from './env'

const NONCE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const CHANNEL = 'BOLUOANDROIDAPPSTORE'
const ORIGIN = 'boluoapp'
export const APP_VERSION = '1.1.60'
const APP_ID = 1101
const OS_TYPE = 1

export class ApiFail extends Error {
  constructor(readonly code: number, message: string) {
    super(message)
  }
}

export interface DeviceProfile {
  deviceId: string
  brand: string
  model: string
  osVersion: string
  company: string
}

export interface ApiResult {
  code: number
  msg: string
  data: Record<string, unknown> | null
  bytes: Uint8Array | null
}

let useProxy = false
let userToken = ''
let deviceId = ''

export function useBrowserProxy(on: boolean): void {
  useProxy = on
}

export function setUserToken(token: string): void {
  userToken = token && token !== 'guest_token' ? token : ''
}

export function setDeviceId(id: string): void {
  deviceId = id
}

export function deviceBody(profile: DeviceProfile): Record<string, string | number> {
  return {
    deviceId: profile.deviceId,
    channel: CHANNEL,
    appId: APP_ID,
    version: APP_VERSION,
    osType: OS_TYPE,
    osVersion: profile.osVersion,
    brand: profile.brand,
    model: profile.model,
    originEnd: ORIGIN,
    deviceType: 'phone',
    company: profile.company,
  }
}

function nonce(): string {
  let text = ''
  for (let i = 0; i < 32; i++) text += NONCE[Math.floor(Math.random() * NONCE.length)]
  return text
}

function flatten(value: unknown, prefix: string, out: Record<string, string>): void {
  if (Array.isArray(value)) {
    out[prefix] = JSON.stringify(value)
    return
  }
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      flatten((value as Record<string, unknown>)[key], prefix ? `${prefix}.${key}` : key, out)
    }
    return
  }
  if (typeof value === 'string') out[prefix] = value
  else if (typeof value === 'number') out[prefix] = Number.isInteger(value) ? String(value) : value.toFixed(6)
  else if (typeof value === 'boolean') out[prefix] = value ? 'true' : 'false'
  else out[prefix] = ''
}

/** SignKit GenerateSign: flatten JSON, append nonceStr, sort, key=SECRET, SHA-256 uppercase. */
export function signJson(json: string): { sign: string; nonceStr: string } {
  const nonceStr = nonce()
  const dict: Record<string, string> = {}
  flatten(JSON.parse(json), '', dict)
  dict.nonceStr = nonceStr
  const keys = Object.keys(dict).filter((key) => key.length > 0).sort()
  let concatenated = ''
  for (const key of keys) concatenated += `${key}=${dict[key]}&`
  concatenated += `key=${boluoEnv.signKey}`
  return { sign: sha256(concatenated), nonceStr }
}

interface MiniRequest {
  request?: (opts: {
    url: string
    method: string
    header: Record<string, string>
    data?: string
    responseType: 'arraybuffer'
    success: (res: { statusCode?: number; data?: ArrayBuffer | string }) => void
    fail: () => void
  }) => void
}

function miniApi(): MiniRequest | null {
  const scope = globalThis as { wx?: MiniRequest; tt?: MiniRequest; bl?: MiniRequest }
  return scope.wx?.request ? scope.wx : scope.tt?.request ? scope.tt : scope.bl?.request ? scope.bl : null
}

function load(url: string, method: string, headers: Record<string, string>, body: string | null): Promise<{ status: number; bytes: Uint8Array }> {
  const mini = miniApi()
  if (mini?.request && typeof fetch !== 'function') {
    return new Promise((resolve, reject) => {
      mini.request?.({
        url,
        method,
        header: headers,
        data: body || undefined,
        responseType: 'arraybuffer',
        success: (res) => {
          const data = res.data
          const bytes = data instanceof ArrayBuffer
            ? new Uint8Array(data)
            : new TextEncoder().encode(typeof data === 'string' ? data : '')
          resolve({ status: res.statusCode || 0, bytes })
        },
        fail: () => reject(new Error('network')),
      })
    })
  }
  return fetch(url, { method, headers, body: body || undefined }).then(async (response) => ({
    status: response.status,
    bytes: new Uint8Array(await response.arrayBuffer()),
  }))
}

function endpoint(path: string): string {
  const suffix = path.startsWith('/') ? path : `/${path}`
  if (useProxy) return `/wanos-api${suffix}`
  return `${boluoEnv.api}${suffix}`
}

export async function request(
  method: 'GET' | 'POST',
  path: string,
  query: Record<string, string>,
  body: Record<string, unknown> | null,
  deviceToken: string,
  binary: boolean,
): Promise<ApiResult> {
  const payload = method === 'POST' ? JSON.stringify(body || {}) : null
  const signed = signJson(payload || JSON.stringify(query))
  const headers: Record<string, string> = {
    deviceToken,
    userToken,
    deviceId,
    channel: CHANNEL,
    version: APP_VERSION,
    healthChannel: '',
    thirdPartyId: deviceId,
    originEnd: ORIGIN,
    notCheckSign: '0',
    sign: signed.sign,
    nonceStr: signed.nonceStr,
  }
  let url = endpoint(path)
  if (method === 'GET') {
    const search = new URLSearchParams()
    for (const key of Object.keys(query)) {
      if (query[key]) search.append(key, query[key])
    }
    const text = search.toString()
    if (text) url += `?${text}`
  } else {
    headers['Content-Type'] = 'application/json'
  }
  let status = 0
  let bytes: Uint8Array
  try {
    const loaded = await load(url, method, headers, payload)
    status = loaded.status
    bytes = loaded.bytes
  } catch {
    throw new ApiFail(-1, '网络连接失败，请检查网络')
  }
  if (binary && bytes.length && bytes[0] !== 123) {
    if (status < 200 || status >= 300) throw new ApiFail(status, '二维码加载失败')
    return { code: 0, msg: '', data: null, bytes }
  }
  let parsed: { code?: number; msg?: string; data?: unknown } = {}
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes)) as { code?: number; msg?: string; data?: unknown }
  } catch {
    throw new ApiFail(status || -1, '网络连接失败，请检查网络')
  }
  const data = parsed.data && typeof parsed.data === 'object' ? parsed.data as Record<string, unknown> : null
  return { code: Number(parsed.code ?? -1), msg: String(parsed.msg || ''), data, bytes: null }
}
