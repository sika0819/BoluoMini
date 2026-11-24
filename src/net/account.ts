import {
  ApiFail,
  deviceBody,
  request,
  setDeviceId,
  setUserToken,
  useBrowserProxy,
  type ApiResult,
  type DeviceProfile,
} from './client'

const SESSION = 'boluo.session'
const DEVICE = 'boluo.device'
const DEVICE_TOKEN = 'boluo.deviceToken'
const CIPHER = 'boluo.cipher'
const EXPIRED = new Set([3, 16, 400, 401])
const TOKEN_TTL = 30 * 24 * 3600

export interface BoluoUser {
  token: string
  userId: string
  userName: string
  avatar: string
  mobile: string
  sex: number
  birthday: string
  openId: string
  guest: boolean
  isCancel: boolean
  cancelMsg: string
  /** Unix 秒。未过期且设备未变时直接复用，不再重新登录。 */
  expire: number
  deviceId: string
}

export type PollHit =
  | { kind: 'wait' }
  | { kind: 'ok'; user: BoluoUser }
  | { kind: 'bind'; openId: string }
  | { kind: 'retry'; message: string }
  | { kind: 'fail'; message: string }

interface Store {
  get(key: string): string | null
  set(key: string, value: string): void
  remove(key: string): void
}

const memory = new Map<string, string>()
let store: Store = {
  get: (key) => memory.get(key) ?? null,
  set: (key, value) => { memory.set(key, value) },
  remove: (key) => { memory.delete(key) },
}
let user: BoluoUser | null = null
let deviceToken = ''
let deviceExpire = 0
let cipher = ''
let profile: DeviceProfile | null = null
let deviceFlight: Promise<string> | null = null
let renewingUser = false

export function bindNet(host: {
  kind: string
  storageGet(key: string): string | null
  storageSet(key: string, value: string): void
  storageRemove(key: string): void
}): void {
  useBrowserProxy(host.kind === 'browser')
  store = {
    get: (key) => host.storageGet(key),
    set: (key, value) => host.storageSet(key, value),
    remove: (key) => host.storageRemove(key),
  }
  profile = readJson<DeviceProfile>(DEVICE) || createDevice()
  writeJson(DEVICE, profile)
  setDeviceId(profile.deviceId)
  const cached = readJson<{ token: string; expire: number }>(DEVICE_TOKEN)
  if (cached?.token) {
    deviceToken = cached.token
    deviceExpire = storedExpire(cached.expire)
    if (deviceExpire !== cached.expire) writeJson(DEVICE_TOKEN, { token: deviceToken, expire: deviceExpire })
  }
  cipher = store.get(CIPHER) || ''
  user = readJson<BoluoUser>(SESSION)
  setUserToken(user?.token || '')
}

export function currentUser(): BoluoUser | null {
  return user
}

export async function cachedSession(): Promise<BoluoUser | null> {
  try {
    await ensureDevice(false)
  } catch {
    /* 设备票失败时仍优先用未过期的用户缓存 */
  }
  return reusableUser()
}

export async function bootSession(): Promise<BoluoUser | null> {
  const cached = await cachedSession()
  if (cached) return cached
  return enterGuest()
}

export async function logoutSession(): Promise<BoluoUser | null> {
  try {
    await ensureDevice(false)
    await postJson('/wanosuser/api/commonUser/logout', {})
  } catch {
    /* 退出上报失败也要清掉正式会话 */
  }
  clearUser()
  return enterGuest()
}

export async function enterGuest(): Promise<BoluoUser | null> {
  if (renewingUser) return null
  renewingUser = true
  const previous = user?.token || ''
  setUserToken('')
  try {
    await ensureDevice(false)
    const data = await postJson('/wanosuser/api/commonUser/touristLogin', {
      latitude: 0,
      longitude: 0,
      accuracy: 0,
    })
    const next = readUser(data, true)
    saveUser(next)
    return next
  } catch {
    setUserToken(previous)
    return null
  } finally {
    renewingUser = false
  }
}

export async function sendVerifyCode(mobile: string): Promise<number> {
  await ensureDevice(false)
  const result = await send('GET', '/wanosuser/api/commonUser/getVerifyCode', {
    mobile,
    nation: '+86',
  }, null, true, false)
  const data = must(result)
  const raw = Number(data.expireTime || 60)
  if (raw > 1e9) return Math.max(1, raw - Math.floor(Date.now() / 1000))
  return Math.max(1, raw)
}

export async function loginMobile(mobile: string, verifyCode: string): Promise<BoluoUser> {
  await ensureDevice(false)
  const data = await postJson('/wanosuser/api/commonUser/mobileLogin', {
    mobile,
    verifyCode,
    nation: '+86',
    latitude: 0,
    longitude: 0,
    accuracy: 0,
  }, true)
  const next = readUser(data, false)
  saveUser(next)
  return next
}

export async function loginPassword(mobile: string, password: string): Promise<BoluoUser> {
  await ensureDevice(false)
  const data = await postJson('/wanosuser/api/commonUser/passwordLogin', {
    mobile,
    password,
    nation: '+86',
    latitude: 0,
    longitude: 0,
    accuracy: 0,
  }, true)
  const next = readUser(data, false)
  saveUser(next)
  return next
}

export async function startWechat(): Promise<{ sceneId: number; expireSec: number; image: string }> {
  await ensureDevice(false)
  const scene = must(await send('GET', '/wanosuser/api/wechat/PublicAccount/getSceneId', {}, null, true, false))
  const sceneId = Number(scene.sceneId || 0)
  if (!sceneId) throw new ApiFail(-1, '二维码加载失败')
  const image = await send('GET', '/wanosuser/api/wechat/PublicAccount/getQrCode', {
    sceneId: String(sceneId),
  }, null, true, true)
  if (!image.bytes || !image.bytes.length) throw new ApiFail(image.code, image.msg || '二维码加载失败')
  const raw = Number(scene.expireTime || 60)
  const expireSec = raw > 1e9 ? Math.max(1, raw - Math.floor(Date.now() / 1000)) : Math.max(1, raw)
  return { sceneId, expireSec, image: toDataUrl(image.bytes) }
}

export async function pollWechat(sceneId: number): Promise<PollHit> {
  let result: ApiResult
  try {
    result = await send('GET', '/wanosuser/api/wechat/PublicAccount/Polling', {
      sceneId: String(sceneId),
    }, null, true, false)
  } catch (err) {
    return { kind: 'retry', message: err instanceof ApiFail ? err.message : '网络连接失败，请检查网络' }
  }
  if (result.code === 201016) return { kind: 'wait' }
  if (result.code === 0 && result.data) {
    const next = readUser(result.data, false)
    saveUser(next)
    return { kind: 'ok', user: next }
  }
  if (result.code === 20016) {
    const openId = result.data ? str(result.data.openId) : ''
    if (!openId) return { kind: 'fail', message: result.msg || '请绑定手机号' }
    return { kind: 'bind', openId }
  }
  if (result.code === 30000) return { kind: 'fail', message: result.msg || '二维码已失效' }
  return { kind: 'fail', message: result.msg || '网络连接失败，请检查网络' }
}

export async function loginWechatCode(authCode: string): Promise<BoluoUser> {
  if (!authCode) throw new ApiFail(-1, '登录失败')
  await ensureDevice(false)
  const data = await postJson('/wanosuser/api/commonUser/wechatLogin', {
    authCode,
    latitude: 0,
    longitude: 0,
    accuracy: 0,
  })
  const next = readUser(data, false)
  saveUser(next)
  return next
}

export async function loginDouyinCode(code: string, anonymousCode: string): Promise<BoluoUser> {
  if (!code && !anonymousCode) throw new ApiFail(-1, '登录失败')
  await ensureDevice(false)
  const data = await postJson('/wanosuser/api/commonUser/douyinLogin', {
    code,
    anonymousCode,
    latitude: 0,
    longitude: 0,
    accuracy: 0,
  })
  const next = readUser(data, false)
  saveUser(next)
  return next
}

export async function bindWechatPhone(mobile: string, verifyCode: string, openId: string): Promise<BoluoUser> {
  await ensureDevice(false)
  const data = await postJson('/wanosuser/api/wechat/PublicAccount/bind', { mobile, verifyCode, openId })
  const next = readUser(data, false)
  if (!next.openId) next.openId = openId
  saveUser(next)
  return next
}

async function ensureDevice(force: boolean): Promise<string> {
  if (!force && deviceToken && deviceExpire - 60 > Date.now() / 1000) return deviceToken
  if (deviceFlight) return deviceFlight
  deviceFlight = refreshDevice(force).finally(() => { deviceFlight = null })
  return deviceFlight
}

async function refreshDevice(force: boolean): Promise<string> {
  if (!profile) {
    profile = createDevice()
    writeJson(DEVICE, profile)
    setDeviceId(profile.deviceId)
  }
  if (force) {
    deviceToken = ''
    deviceExpire = 0
    store.remove(DEVICE_TOKEN)
  }
  if (!cipher) {
    const data = await postJson('/wanosuser/api/commonUser/boluoRsa', deviceBody(profile), false)
    cipher = str(data.cipherText)
    if (!cipher) throw new ApiFail(-1, '设备注册失败')
    store.set(CIPHER, cipher)
  }
  const data = await postJson('/wanosuser/api/commonUser/boluoDeviceLogin', {
    cipherText: cipher,
    latitude: 0,
    longitude: 0,
    accuracy: 0,
  }, false)
  deviceToken = str(data.deviceToken)
  deviceExpire = expireFromServer(Number(data.expireTime || 0))
  if (!deviceToken) throw new ApiFail(-1, '设备注册失败')
  writeJson(DEVICE_TOKEN, { token: deviceToken, expire: deviceExpire })
  return deviceToken
}

async function postJson(path: string, body: Record<string, unknown>, withDevice = true): Promise<Record<string, unknown>> {
  return must(await send('POST', path, {}, body, withDevice, false))
}

async function send(
  method: 'GET' | 'POST',
  path: string,
  query: Record<string, string>,
  body: Record<string, unknown> | null,
  withDevice: boolean,
  binary: boolean,
  retried = false,
): Promise<ApiResult> {
  const result = await request(method, path, query, body, withDevice ? deviceToken : '', binary)
  if (withDevice && !binary && EXPIRED.has(result.code) && !retried) {
    cipher = ''
    store.remove(CIPHER)
    await refreshDevice(true)
    return send(method, path, query, body, withDevice, binary, true)
  }
  return result
}

function reusableUser(): BoluoUser | null {
  if (!user?.token || !profile) return null
  if (user.deviceId && user.deviceId !== profile.deviceId) return null
  const expire = user.expire ? storedExpire(user.expire) : storedExpire(0)
  if (!tokenFresh(expire)) return null
  if (user.expire !== expire || user.deviceId !== profile.deviceId) {
    user = { ...user, expire, deviceId: profile.deviceId }
    writeJson(SESSION, user)
  }
  setUserToken(user.token)
  return user
}

function expireFromServer(raw: number): number {
  const now = Math.floor(Date.now() / 1000)
  if (!Number.isFinite(raw) || raw <= 0) return now + TOKEN_TTL
  if (raw > 10_000_000_000) return Math.floor(raw / 1000)
  if (raw < 1_000_000_000) return now + Math.floor(raw)
  if (raw <= now + 60) return now + TOKEN_TTL
  return Math.floor(raw)
}

function storedExpire(raw: number): number {
  const now = Math.floor(Date.now() / 1000)
  if (!Number.isFinite(raw) || raw <= 0) return now + TOKEN_TTL
  if (raw > 10_000_000_000) return Math.floor(raw / 1000)
  if (raw < 1_000_000_000) return now + Math.floor(raw)
  return Math.floor(raw)
}

function tokenFresh(expire: number): boolean {
  return expire - 60 > Date.now() / 1000
}

function must(result: ApiResult): Record<string, unknown> {
  if (result.code !== 0 || !result.data) throw new ApiFail(result.code, result.msg || '网络连接失败，请检查网络')
  return result.data
}

function readUser(data: Record<string, unknown>, guest: boolean): BoluoUser {
  const token = str(data.token) || str(data.userToken)
  if (!token) throw new ApiFail(0, '登录失败')
  const next: BoluoUser = {
    token,
    userId: str(data.userId),
    userName: str(data.userName),
    avatar: str(data.avatar),
    mobile: str(data.mobile),
    sex: sexOf(data.sex),
    birthday: str(data.birthday),
    openId: str(data.openId),
    guest,
    isCancel: data.isCancel === true || data.isCancel === 1 || data.isCancel === '1',
    cancelMsg: str(data.cancelMsg),
    expire: expireFromServer(Number(data.expireTime || 0)),
    deviceId: profile?.deviceId || '',
  }
  return next
}

function saveUser(next: BoluoUser): void {
  user = next
  setUserToken(next.token)
  writeJson(SESSION, next)
}

function clearUser(): void {
  user = null
  setUserToken('')
  store.remove(SESSION)
}

function createDevice(): DeviceProfile {
  const nav = typeof navigator !== 'undefined' ? navigator : null
  return {
    deviceId: randomHex(16),
    brand: 'web',
    model: (nav?.userAgent || 'BoluoMini').slice(0, 48),
    osVersion: '14',
    company: 'web',
  }
}

function randomHex(size: number): string {
  const alphabet = '0123456789abcdef'
  let text = ''
  for (let i = 0; i < size; i++) text += alphabet[Math.floor(Math.random() * 16)]
  return text
}

function str(value: unknown): string {
  if (value == null) return ''
  return String(value)
}

function sexOf(value: unknown): number {
  const text = str(value)
  if (text === '1' || text === '男') return 1
  if (text === '2' || text === '女') return 2
  const num = Number(text)
  return num === 1 || num === 2 ? num : 0
}

function readJson<T>(key: string): T | null {
  const raw = store.get(key)
  if (!raw) return null
  try { return JSON.parse(raw) as T } catch { return null }
}

function writeJson(key: string, value: unknown): void {
  store.set(key, JSON.stringify(value))
}

function toDataUrl(bytes: Uint8Array): string {
  let binary = ''
  const step = 0x8000
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + step, bytes.length)))
  }
  const mime = bytes[0] === 0x89 ? 'image/png' : 'image/jpeg'
  const btoaFn = typeof btoa === 'function' ? btoa : null
  if (!btoaFn) throw new ApiFail(-1, '二维码加载失败')
  return `data:${mime};base64,${btoaFn(binary)}`
}
