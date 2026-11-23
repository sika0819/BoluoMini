import type { Host } from '../host/types'
import { BANKS, type BankItem } from './catalog'

export type ReadyState = 'missing' | 'downloading' | 'ready' | 'failed'

export interface DownloadSnapshot {
  states: Record<string, ReadyState>
  progress: Record<string, number>
  consentWifi: boolean
  consentCellular: boolean
  dialog: 'none' | 'offline' | 'storage' | 'cellular' | 'wifi' | 'progress' | 'request'
  pending: string[]
  toast: string
}

export class BankDownload {
  states: Record<string, ReadyState> = {}
  progress: Record<string, number> = {}
  consentWifi = false
  consentCellular = false
  dialog: DownloadSnapshot['dialog'] = 'none'
  pending: string[] = []
  toast = ''
  private toastUntil = 0

  constructor(_host: Host) {
    for (const item of BANKS) {
      if (item.src || item.group === 'preset') this.states[item.name] = 'ready'
    }
  }

  isReady(name: string): boolean {
    return this.states[name] === 'ready'
  }

  request(names: string[], now: number, _quiet = false): void {
    const need = names.filter((n) => this.states[n] !== 'ready')
    if (need.length === 0) {
      this.toast = '已经在本地'
      this.toastUntil = now + 1600
      return
    }
    this.toast = '本地没有这首音频'
    this.toastUntil = now + 1800
    this.pending = []
    this.dialog = 'none'
  }

  confirm(_kind: 'cellular' | 'wifi' | 'storage-retry'): void {
    this.dialog = 'none'
  }

  cancel(): void {
    this.dialog = 'none'
    this.pending = []
  }

  /** 关掉进度卡，下载继续。对齐 DownloadProgressForm：关窗不打断传输。 */
  hideDialog(): void {
    if (this.dialog === 'progress') this.dialog = 'none'
  }

  tick(now: number): void {
    if (this.toast && now > this.toastUntil) this.toast = ''
  }

  snapshot(): DownloadSnapshot {
    return {
      states: { ...this.states },
      progress: { ...this.progress },
      consentWifi: this.consentWifi,
      consentCellular: this.consentCellular,
      dialog: this.dialog,
      pending: this.pending.slice(),
      toast: this.toast,
    }
  }

  label(name: string): string {
    return BANKS.find((b) => b.name === name)?.label ?? name
  }

  item(name: string): BankItem | undefined {
    return BANKS.find((b) => b.name === name)
  }
}
