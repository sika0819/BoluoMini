import { createBrowserHost } from './browser'
import { createMiniHost } from './mini'
import type { Host } from './types'

interface GlobalMini {
  wx?: Parameters<typeof createMiniHost>[1] & { createCanvas: () => never }
  tt?: Parameters<typeof createMiniHost>[1]
  bl?: Parameters<typeof createMiniHost>[1]
}

export function createHost(): Host {
  const g = globalThis as unknown as GlobalMini
  if (g.bl && typeof g.bl.createCanvas === 'function') {
    return createMiniHost('bilibili', g.bl, false)
  }
  if (g.tt && typeof g.tt.createCanvas === 'function') {
    return createMiniHost('douyin', g.tt, true)
  }
  if (g.wx && typeof g.wx.createCanvas === 'function') {
    return createMiniHost('wechat', g.wx, true)
  }
  return createBrowserHost()
}

export type { Host, HostKind, PlatformCode } from './types'
