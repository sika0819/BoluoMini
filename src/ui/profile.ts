import {
  bindWechatPhone,
  currentUser,
  enterGuest,
  loginMobile,
  loginPassword,
  pollWechat,
  sendVerifyCode,
  startWechat,
  type BoluoUser,
} from '../net/account'
import { APP_VERSION } from '../net/client'
import { h5Origin } from '../net/env'
import type { UiAction } from './shell'

const W = 1125
const H = 2436
const U = 1125 / 402
const INK = '#19191A'
const SUB = '#878791'
const VALUE = '#A2A2A6'
const LINK = '#3D5176'
const ERR = '#F32C2C'
const BRAND = '#00A375'
const GRAY5 = '#ADADAF'
const LINE = '#E6E6F0'
const STORE = 'boluo.mine'
const LAST_LOGIN = 'boluo.login.last'

function dp(n: number): number {
  return Math.round(n * U)
}

type View =
  | 'home' | 'settings' | 'feedback' | 'about' | 'edit'
  | 'account' | 'legal' | 'privacy' | 'phone'
  | 'password' | 'init-password' | 'change-password'
  | 'cancel' | 'wechat'
  | 'switch' | 'login-phone' | 'login-password' | 'login-wechat' | 'login-bind'

type Overlay = '' | 'nick' | 'gender' | 'birthday' | 'nick-save' | 'birth-save' | 'unbind' | 'phone-confirm' | 'other' | 'agree'

type LoginMethod = '' | 'verify' | 'password' | 'wechat' | 'guest'

function readLast(): LoginMethod {
  try {
    const raw = localStorage.getItem(LAST_LOGIN)
    if (raw === 'verify' || raw === 'password' || raw === 'wechat' || raw === 'guest') return raw
  } catch { /* storage can be unavailable */ }
  return ''
}

type FieldId = 'nick' | 'feedback' | 'contact' | 'phone' | 'code' | 'pass' | 'pass2'

interface MineData {
  name: string
  userId: string
  sex: number
  birthday: string
  mobile: string
  passwordSet: boolean
  wechatBound: boolean
  locationOn: boolean
  avatar: string
}

interface Box {
  id: FieldId
  x: number
  y: number
  w: number
  h: number
  multiline: boolean
  secret: boolean
  font: number
  weight: number
  pad: number
  placeholder: string
  numeric: boolean
}

interface Frame {
  ox: number
  oy: number
  pw: number
  ph: number
}

interface Host {
  now: number
  modal: boolean
  hit(x: number, y: number, w: number, h: number, id: string, on: () => UiAction | null): void
  toast(text: string): void
  askLogout(): void
  close(): void
}

const LEGAL: Record<string, { title: string; path: string }> = {
  agreement: { title: '用户协议', path: '/userAgreement' },
  privacy: { title: '隐私政策', path: '/privacy-policy' },
  third: { title: '第三方信息共享清单', path: '/third-party-information-sharing-list' },
  personal: { title: '个人信息收集清单', path: '/personal-information' },
}

const NOTICE_1 = '注销波萝账号是不可逆的操作，注销波萝账号后，你将无法再以该账号登录和使用波萝产品及服务，亦无法找回该账号相关的任何内容和信息，即使你使用相同的手机号再次注册波萝账号。'
const NOTICE_2 = '申请注销后你的账号会在所有设备上登出，并进入时长为7天的确认期，确认期结束后账号将自动注销。你如果在确认期结束前登录了该账号，则视为你自愿放弃账号注销，流程自动终止。'

function fresh(): MineData {
  return {
    name: '波萝用户',
    userId: String(10000000 + Math.floor(Math.random() * 89999999)),
    sex: 0,
    birthday: '',
    mobile: '',
    passwordSet: false,
    wechatBound: false,
    locationOn: false,
    avatar: '',
  }
}

function load(): MineData {
  const base = fresh()
  try {
    const raw = localStorage.getItem(STORE)
    if (!raw) return base
    const parsed = JSON.parse(raw) as Partial<MineData>
    return { ...base, ...parsed, userId: parsed.userId || base.userId }
  } catch {
    return base
  }
}

function maskMobile(mobile: string): string {
  if (mobile.length < 7) return mobile || '未绑定'
  return `${mobile.slice(0, 3)}****${mobile.slice(-4)}`
}

function sexLabel(sex: number): string {
  if (sex === 1) return '男'
  if (sex === 2) return '女'
  return '保密'
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

function validPassword(value: string): boolean {
  return /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{8,20}$/.test(value)
}

function validDate(year: number, month: number, day: number): boolean {
  if (year < 1920 || month < 1 || month > 12 || day < 1) return false
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return false
  const today = new Date()
  today.setHours(23, 59, 59, 999)
  return date.getTime() <= today.getTime()
}

export class ProfilePane {
  private data: MineData = load()
  private stack: View[] = ['home']
  private overlay: Overlay = ''
  private legalKey = 'agreement'
  private passMode: 'change' | 'forgot' = 'change'
  private scroll = 0
  private scrollMax = 0
  private dragY = 0
  private dragScroll = 0
  private dragMoved = false
  private now = 0
  private host: Host | null = null
  private scrolling = false
  private clipY = 0
  private clipH = 0
  private field: FieldId | '' = ''
  private values: Record<FieldId, string> = { nick: '', feedback: '', contact: '', phone: '', code: '', pass: '', pass2: '' }
  private secret: Record<string, boolean> = { pass: true, pass2: true }
  private boxes: Box[] = []
  private showLegal = false
  private codeUntil = 0
  private codeSent = false
  private cancelUntil = 0
  private wechatAt = 0
  private birthY = 2000
  private birthM = 1
  private birthD = 1
  private avatarRev = 0
  private images: string[] = []
  private imageRev = 0
  private seenToken = ''
  private loginBusy = false
  private loginW = W
  private loginH = H
  private loginX = 0
  private loginPadX = 0
  private loginPadY = 0
  private codeShown = false
  private agreedLogin = false
  private pendingLogin: (() => void) | null = null
  private lastMethod: LoginMethod = readLast()
  private qrGen = 0
  private qrScene = 0
  private qrImage = ''
  private qrUntil = 0
  private qrState: 'idle' | 'loading' | 'ready' | 'error' | 'expired' = 'idle'
  private qrMsg = ''
  private pollAt = 0
  private pollBusy = false
  private pollFails = 0
  private bindOpenId = ''
  private frame: Frame = { ox: 0, oy: 0, pw: W, ph: H }
  private legalBox = { x: 48, y: 400, w: W - 96, h: 800 }

  get view(): View {
    return this.stack[this.stack.length - 1] || 'home'
  }

  logging(): boolean {
    return this.view === 'switch' || this.view === 'login-phone' || this.view === 'login-password'
      || this.view === 'login-wechat' || this.view === 'login-bind'
  }

  key(): string {
    const codeLeft = Math.max(0, Math.ceil((this.codeUntil - this.now) / 1000))
    const cancelLeft = this.view === 'cancel' ? Math.max(0, Math.ceil((this.cancelUntil - this.now) / 1000)) : 0
    return [
      this.stack.join('.'), this.overlay, this.legalKey, this.passMode,
      Math.round(this.scroll), this.field, this.values.nick, this.values.feedback, this.values.contact,
      this.values.phone, this.values.code, this.values.pass.length, this.values.pass2.length,
      this.secret.pass ? 1 : 0, this.data.name, this.data.sex, this.data.birthday, this.data.mobile,
      this.data.passwordSet ? 1 : 0, this.data.wechatBound ? 1 : 0, this.data.locationOn ? 1 : 0,
      this.avatarRev, this.images.length, this.imageRev, codeLeft, cancelLeft, this.showLegal ? 1 : 0,
      this.view === 'wechat' && this.now - this.wechatAt < 800 ? 1 : 0,
      this.qrState, this.qrScene, this.loginBusy ? 1 : 0, this.codeShown ? 1 : 0,
      this.agreedLogin ? 1 : 0, this.lastMethod,
      this.view === 'login-wechat' ? Math.max(0, Math.ceil((this.qrUntil - this.now) / 1000)) : 0,
    ].join('|')
  }

  busy(): boolean {
    if (this.field) return true
    if (this.codeUntil > this.now) return true
    if (this.view === 'cancel' && this.cancelUntil > this.now) return true
    if (this.view === 'wechat' && this.now - this.wechatAt < 800) return true
    if (this.view === 'login-wechat' && (this.qrState === 'loading' || this.qrState === 'ready')) return true
    return false
  }

  sync(now: number): void {
    this.now = now
    const session = currentUser()
    if (session && session.token !== this.seenToken) {
      this.seenToken = session.token
      this.adopt(session)
    }
    this.pollQr()
  }

  openLogin(): void {
    this.qrGen += 1
    this.stack = ['switch']
    this.overlay = ''
    this.scroll = 0
    this.blur()
    this.values.phone = ''
    this.values.code = ''
    this.values.pass = ''
    this.codeShown = false
    this.pendingLogin = null
    this.detach()
  }

  home(): void {
    this.qrGen += 1
    this.stack = ['home']
    this.overlay = ''
    this.scroll = 0
    this.blur()
    this.detach()
  }

  arm(y: number): void {
    this.dragY = y
    this.dragScroll = this.scroll
    this.dragMoved = false
  }

  drag(y: number): void {
    if (this.overlay) return
    if (Math.abs(y - this.dragY) > 8) this.dragMoved = true
    if (!this.dragMoved) return
    this.scroll = Math.max(0, Math.min(this.scrollMax, this.dragScroll - (y - this.dragY)))
  }

  end(): boolean {
    const moved = this.dragMoved
    this.dragMoved = false
    return moved
  }

  note(id: string): void {
    if (!this.field) return
    if (id.startsWith(`pfield-${this.field}`) || id.startsWith(`peye-${this.field}`)) return
    this.blur()
  }

  logout(): void {
    this.data = { ...fresh(), userId: this.data.userId }
    this.values = { nick: '', feedback: '', contact: '', phone: '', code: '', pass: '', pass2: '' }
    this.images = []
    this.save()
    this.home()
  }

  wipe(): void {
    try { localStorage.removeItem(STORE) } catch { /* storage can be unavailable */ }
    this.data = fresh()
    this.values = { nick: '', feedback: '', contact: '', phone: '', code: '', pass: '', pass2: '' }
    this.images = []
    this.save()
    this.home()
  }

  detach(): void {
    this.showLegal = false
    this.blur()
    const frame = document.getElementById('boluo-legal')
    if (frame) frame.remove()
  }

  draw(ctx: CanvasRenderingContext2D, host: Host, frame: Frame): void {
    this.host = host
    this.frame = frame
    this.now = host.now
    this.boxes = []
    this.showLegal = false
    if (this.logging()) {
      const colW = Math.min(W, frame.pw)
      const colX = Math.round((frame.pw - colW) / 2)
      this.loginW = colW
      this.loginH = frame.ph
      this.loginX = colX
      this.frame = { ox: colX, oy: frame.oy, pw: frame.pw, ph: frame.ph }
      ctx.save()
      ctx.translate(colX, 0)
      this.host = {
        now: host.now,
        modal: host.modal,
        toast: (text) => host.toast(text),
        askLogout: () => host.askLogout(),
        close: () => host.close(),
        hit: (x, y, w, h, id, on) => host.hit(x + colX, y, w, h, id, on),
      }
      this.paintLogin(ctx)
      if (this.overlay === 'other' || this.overlay === 'agree') this.drawLoginOverlay(ctx)
      this.host = host
      ctx.restore()
      this.place(host)
      return
    }
    const top = H * 0.08
    if (this.view === 'home') this.drawHome(ctx, top)
    else {
      this.header(ctx, top, this.title())
      this.clipY = top + 354
      this.clipH = H - this.clipY - 24
      host.hit(0, this.clipY, W, this.clipH, 'pscroll', () => null)
      ctx.save()
      ctx.beginPath()
      ctx.rect(0, this.clipY, W, this.clipH)
      ctx.clip()
      ctx.translate(0, -this.scroll)
      this.scrolling = true
      const bottom = this.body(ctx, this.clipY)
      this.scrolling = false
      ctx.restore()
      this.scrollMax = Math.max(0, bottom - (this.clipY + this.clipH))
      if (this.scroll > this.scrollMax) this.scroll = this.scrollMax
    }
    if (this.overlay) this.drawOverlay(ctx, top)
    this.place(host)
  }

  place(host: Host): void {
    if (typeof document === 'undefined') return
    const legal = document.getElementById('boluo-legal') as HTMLIFrameElement | null
    if (!this.showLegal || host.modal || this.overlay) {
      legal?.remove()
    } else {
      const frame = legal ?? document.createElement('iframe')
      frame.id = 'boluo-legal'
      frame.style.position = 'fixed'
      frame.style.zIndex = '7'
      frame.style.border = '0'
      frame.style.background = '#fff'
      const path = LEGAL[this.legalKey]?.path || ''
      if (frame.dataset.path !== path) {
        frame.dataset.path = path
        frame.src = h5Origin + path
      }
      if (!legal) document.body.appendChild(frame)
      this.pin(frame, this.legalBox.x, this.legalBox.y, this.legalBox.w, this.legalBox.h)
    }
    this.placeField(host)
  }

  private title(): string {
    if (this.view === 'settings') return '系统设置'
    if (this.view === 'about') return '关于波萝'
    if (this.view === 'feedback') return '帮助与反馈'
    if (this.view === 'edit') return '编辑个人资料'
    if (this.view === 'account') return '账号与安全'
    if (this.view === 'legal') return LEGAL[this.legalKey]?.title || '协议'
    if (this.view === 'privacy') return '隐私权限设置'
    if (this.view === 'phone') return '更换绑定手机号'
    if (this.view === 'password' || this.view === 'init-password') return '登录密码'
    if (this.view === 'change-password') return this.passMode === 'forgot' ? '忘记密码' : '修改密码'
    if (this.view === 'cancel') return '账号注销'
    if (this.view === 'switch') return '登录'
    if (this.view === 'login-phone') return '短信验证登录/注册'
    if (this.view === 'login-password') return '账户密码登录'
    if (this.view === 'login-wechat') return '微信扫码登录'
    if (this.view === 'login-bind') return '绑定手机号'
    return '微信绑定'
  }

  private push(view: View): void {
    this.stack.push(view)
    this.scroll = 0
    this.overlay = ''
    this.blur()
    if (view === 'cancel') this.cancelUntil = this.now + 5000
    if (view === 'wechat') this.wechatAt = this.now
    if (view === 'switch') {
      this.values.phone = ''
      this.values.code = ''
      this.values.pass = ''
      this.codeShown = false
    }
    if (view === 'login-phone') {
      this.values.code = ''
      this.codeShown = false
    }
    if (view === 'login-password') this.values.pass = ''
    if (view === 'login-bind') {
      this.values.phone = ''
      this.values.code = ''
      this.codeShown = true
    }
    if (view === 'login-wechat') this.openQr()
    if (view !== 'legal') this.showLegal = false
  }

  private back(): void {
    if (this.overlay === 'nick') {
      this.askNickClose()
      return
    }
    if (this.overlay === 'birthday') {
      this.askBirthClose()
      return
    }
    if (this.overlay) {
      this.overlay = ''
      this.blur()
      return
    }
    const from = this.view
    if (this.stack.length > 1) this.stack.pop()
    if (from === 'login-bind' && this.view === 'login-wechat') this.openQr()
    if (from === 'login-wechat') this.qrGen += 1
    this.scroll = 0
    this.blur()
    this.showLegal = false
  }

  private header(ctx: CanvasRenderingContext2D, top: number, title: string): void {
    blit(ctx, '/ui/mine/back.svg', 48, top + 48, 108, 108)
    this.host?.hit(48, top + 48, 180, 140, 'pback', () => {
      if (this.stack.length <= 1 && this.view === 'switch') {
        this.host?.close()
        return null
      }
      this.back()
      return null
    })
    ctx.fillStyle = INK
    ctx.font = font(66)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(title, W / 2, top + 273)
  }

  private drawHome(ctx: CanvasRenderingContext2D, top: number): void {
    let y = top + 120
    const ring = 225
    this.avatar(ctx, 48, y, ring, 64)
    ctx.fillStyle = INK
    ctx.font = '600 57px "PingFang SC","PingFangSC-Semibold","Hiragino Sans GB",sans-serif'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    const name = this.data.name || '波萝用户'
    ctx.fillText(name, 48 + ring + 48, y + ring / 2)
    this.host?.hit(48, y, W - 96, ring, 'phome-edit', () => {
      this.push('edit')
      return null
    })
    y += ring + 108
    ctx.fillStyle = '#BFD0CA'
    ctx.font = font(30)
    ctx.fillText('通用', 108, y + 20)
    y += 42
    const rows: Array<[string, string, View]> = [
      ['/ui/mine/settings.svg', '系统设置', 'settings'],
      ['/ui/mine/feedback.svg', '帮助与反馈', 'feedback'],
      ['/ui/mine/about.svg', '关于波萝', 'about'],
    ]
    this.card(ctx, 48, y, W - 96, 24 + rows.length * 144)
    rows.forEach((row, i) => {
      const ry = y + 24 + i * 144
      if (row[0]) blit(ctx, row[0], 108, ry + 42, 60, 60)
      ctx.fillStyle = INK
      ctx.font = font(45)
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillText(row[1], row[0] ? 192 : 108, ry + 72)
      blit(ctx, '/ui/mine/detail.svg', W - 168, ry + 42, 60, 60)
      this.host?.hit(48, ry, W - 96, 144, 'prow-' + row[2], () => {
        this.push(row[2])
        return null
      })
    })
    y += 24 + rows.length * 144 + 60
    const logoW = 300
    const logoH = 84
    blit(ctx, '/ui/mine/logo.svg', (W - logoW) / 2, y, logoW, logoH)
    ctx.fillStyle = '#C3C3CF'
    ctx.font = font(30)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText(`Version ${APP_VERSION}`, W / 2, y + logoH + 12)
  }

  private body(ctx: CanvasRenderingContext2D, y: number): number {
    if (this.view === 'settings') return this.pageSettings(ctx, y)
    if (this.view === 'about') return this.pageAbout(ctx, y)
    if (this.view === 'feedback') return this.pageFeedback(ctx, y)
    if (this.view === 'edit') return this.pageEdit(ctx, y)
    if (this.view === 'account') return this.pageAccount(ctx, y)
    if (this.view === 'legal') return this.pageLegal(ctx, y)
    if (this.view === 'privacy') return this.pagePrivacy(ctx, y)
    if (this.view === 'phone') return this.pagePhone(ctx, y)
    if (this.view === 'password') return this.pagePassword(ctx, y)
    if (this.view === 'init-password') return this.pageInitPassword(ctx, y)
    if (this.view === 'change-password') return this.pageChangePassword(ctx, y)
    if (this.view === 'cancel') return this.pageCancel(ctx, y)
    return this.pageWechat(ctx, y)
  }

  private paintLogin(ctx: CanvasRenderingContext2D): void {
    const outerW = this.loginW
    const outerH = this.loginH
    const cardW = Math.min(dp(340), Math.max(dp(260), outerW - dp(24)))
    const home = this.view === 'switch'
    const cardH = Math.min(home ? dp(400) : dp(560), Math.max(dp(360), outerH - dp(32)))
    const x = Math.round((outerW - cardW) / 2)
    const y = Math.round((outerH - cardH) / 2)
    round(ctx, x, y, cardW, cardH, dp(16))
    ctx.fillStyle = '#fff'
    ctx.fill()
    this.hit(x, y, cardW, cardH, 'lcard', () => null)
    this.loginW = cardW
    this.loginH = cardH
    this.loginPadX = x
    this.loginPadY = y
    ctx.save()
    round(ctx, x, y, cardW, cardH, dp(16))
    ctx.clip()
    ctx.translate(x, y)
    if (this.view === 'switch') this.pageLoginHome(ctx)
    else if (this.view === 'login-phone') this.pageLoginPhone(ctx)
    else if (this.view === 'login-password') this.pageLoginPassword(ctx)
    else if (this.view === 'login-wechat') this.pageLoginWechat(ctx)
    else this.pageLoginBind(ctx)
    ctx.restore()
    this.loginPadX = 0
    this.loginPadY = 0
    this.loginW = outerW
    this.loginH = outerH
  }

  private pageLoginHome(ctx: CanvasRenderingContext2D): void {
    const W = this.loginW
    ctx.fillStyle = INK
    ctx.font = fontBold(dp(22))
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('登录', W / 2, dp(40))
    const x = dp(28)
    const w = W - dp(56)
    const buttonH = dp(56)
    let y = dp(72)
    const phoneMark = this.lastMethod === 'verify' || this.lastMethod === 'password'
    this.loginButton(ctx, x, y, w, '手机号登录', true, 'login-phone', () => {
      this.push('login-phone')
      return null
    }, true)
    if (phoneMark) this.lastBubble(ctx, W / 2, y)
    y += buttonH + dp(12)
    this.loginButton(ctx, x, y, w, '微信登录', true, 'login-wechat', () => {
      this.ensureAgree(() => this.push('login-wechat'))
      return null
    }, false)
    if (this.lastMethod === 'wechat') this.lastBubble(ctx, W / 2, y)
    y += buttonH + dp(12)
    this.loginButton(ctx, x, y, w, '游客进入', true, 'login-guest-go', () => {
      this.ensureAgree(() => this.submitGuest())
      return null
    }, false)
    if (this.lastMethod === 'guest') this.lastBubble(ctx, W / 2, y)
    y += buttonH + dp(36)
    this.agreementRow(ctx, y, true)
  }

  private pageLoginPhone(ctx: CanvasRenderingContext2D): void {
    const W = this.loginW
    let y = this.loginHeading(ctx, '短信验证登录/注册', '未注册的手机号验证后将自动注册')
    y += dp(60)
    this.phoneLine(ctx, y)
    y += dp(56)
    if (this.codeShown) {
      y += dp(4)
      this.codeLine(ctx, y)
      y += dp(56)
    }
    y += dp(16)
    this.agreementRow(ctx, y + dp(12), false)
    y += dp(24) + dp(40)
    const ready = this.codeShown ? this.values.code.length === 4 : this.values.phone.length > 0
    this.loginButton(ctx, dp(60), y, W - dp(120), this.codeShown ? '登录' : '验证并登录', ready && !this.loginBusy, 'login-go', () => {
      if (!this.codeShown) this.requestCode()
      else this.submitMobile()
      return null
    })
    y += dp(56) + dp(24)
    this.loginChoices(ctx, y, '密码登录', () => {
      this.push('login-password')
      return null
    }, this.lastMethod === 'password')
  }

  private pageLoginPassword(ctx: CanvasRenderingContext2D): void {
    const W = this.loginW
    let y = this.loginHeading(ctx, '账户密码登录', '请使用已经注册的账户和密码')
    y += dp(60)
    this.phoneLine(ctx, y)
    y += dp(56) + dp(4)
    this.passwordLine(ctx, y)
    y += dp(56) + dp(16)
    this.agreementRow(ctx, y + dp(12), false)
    y += dp(24) + dp(40)
    const ready = this.values.phone.length > 0 && this.values.pass.length > 0
    this.loginButton(ctx, dp(60), y, W - dp(120), '登录', ready && !this.loginBusy, 'login-pass', () => {
      this.submitPassword()
      return null
    })
    y += dp(56) + dp(24)
    this.loginChoices(ctx, y, '验证码登录', () => {
      this.back()
      return null
    }, this.lastMethod === 'verify')
  }

  private pageLoginBind(ctx: CanvasRenderingContext2D): void {
    const W = this.loginW
    let y = this.loginHeading(ctx, '绑定手机号', '')
    y += dp(60)
    this.phoneLine(ctx, y)
    y += dp(56) + dp(4)
    this.codeLine(ctx, y)
    y += dp(56) + dp(40)
    const ready = this.values.phone.length > 0 && this.values.code.length === 4
    this.loginButton(ctx, dp(60), y, W - dp(120), '确定', ready && !this.loginBusy, 'login-bind', () => {
      this.submitBind()
      return null
    })
  }

  private pageLoginWechat(ctx: CanvasRenderingContext2D): void {
    const W = this.loginW
    const H = this.loginH
    this.loginBack(ctx, false)
    const title = '微信扫码登录波萝'
    const size = dp(200)
    const block = dp(24) + dp(12) + size
    const y0 = (H - block) / 2
    ctx.font = font(dp(17))
    ctx.textBaseline = 'middle'
    const mark = '微信'
    const rest = title.slice(mark.length)
    const titleW = ctx.measureText(title).width
    let tx = (W - titleW) / 2
    const ty = y0 + dp(12)
    ctx.textAlign = 'left'
    ctx.fillStyle = BRAND
    ctx.fillText(mark, tx, ty)
    tx += ctx.measureText(mark).width
    ctx.fillStyle = INK
    ctx.fillText(rest, tx, ty)
    const x = (W - size) / 2
    const y = y0 + dp(24) + dp(12)
    round(ctx, x, y, size, size, dp(4))
    ctx.fillStyle = '#fff'
    ctx.fill()
    ctx.strokeStyle = '#EAEAEA'
    ctx.lineWidth = Math.max(1, dp(1))
    ctx.stroke()
    if (this.qrState === 'ready' && this.qrImage) {
      const photo = imageOf(this.qrImage, () => { this.imageRev += 1 })
      if (photo) ctx.drawImage(photo, x + dp(6), y + dp(6), size - dp(12), size - dp(12))
    } else if (this.qrState === 'loading') {
      this.spin(ctx, x + size / 2, y + size / 2, dp(16))
    }
    if (this.qrState === 'error' || this.qrState === 'expired') {
      round(ctx, x, y, size, size, dp(4))
      ctx.fillStyle = 'rgba(0,0,0,0.7)'
      ctx.fill()
      ctx.fillStyle = '#fff'
      ctx.font = fontRegular(dp(14))
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(this.qrState === 'expired' ? '二维码已失效' : '二维码加载失败', x + size / 2, y + size / 2 - dp(26))
      const bw = dp(100)
      const bh = dp(36)
      const bx = x + (size - bw) / 2
      const by = y + size / 2 + dp(4)
      round(ctx, bx, by, bw, bh, bh / 2)
      ctx.fillStyle = '#fff'
      ctx.fill()
      ctx.fillStyle = INK
      ctx.font = fontRegular(dp(14))
      ctx.fillText('刷新重试', x + size / 2, by + bh / 2)
      this.hit(bx, by, bw, bh, 'login-qr', () => {
        this.openQr()
        return null
      })
    }
  }

  private loginBack(ctx: CanvasRenderingContext2D, closeRoot: boolean): number {
    const y = dp(16)
    ctx.fillStyle = LINK
    ctx.font = fontRegular(dp(15))
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText('返回', dp(20), y + dp(12))
    this.hit(dp(8), y, dp(80), dp(36), 'login-back', () => {
      if (closeRoot && this.stack.length <= 1) {
        this.host?.close()
        return null
      }
      this.back()
      return null
    })
    return y + dp(36)
  }

  private loginHeading(ctx: CanvasRenderingContext2D, title: string, sub: string): number {
    const W = this.loginW
    let y = this.loginBack(ctx, false) + dp(8)
    ctx.fillStyle = INK
    ctx.font = fontBold(dp(22))
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(title, W / 2, y + dp(16))
    y += dp(40)
    if (sub) {
      ctx.fillStyle = GRAY5
      ctx.font = fontRegular(dp(13))
      ctx.fillText(sub, W / 2, y + dp(8))
      y += dp(24)
    }
    return y
  }

  private phoneLine(ctx: CanvasRenderingContext2D, y: number): void {
    const W = this.loginW
    const x = dp(60)
    const w = W - dp(120)
    const h = dp(56)
    ctx.fillStyle = INK
    ctx.font = font(dp(18))
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText('+86', x, y + h / 2)
    ctx.fillStyle = '#C4C4C7'
    ctx.fillRect(x + dp(48), y + (h - dp(16)) / 2, Math.max(1, dp(1)), dp(16))
    this.lineInput(ctx, x + dp(72), y, w - dp(72), 'phone', '请输入手机号', true, false)
    ctx.fillStyle = LINE
    ctx.fillRect(x, y + h - Math.max(1, dp(1)), dp(72), Math.max(1, dp(1)))
  }

  private codeLine(ctx: CanvasRenderingContext2D, y: number): void {
    const W = this.loginW
    const x = dp(60)
    const w = W - dp(120)
    const h = dp(56)
    const left = Math.max(0, Math.ceil((this.codeUntil - this.now) / 1000))
    const label = left > 0 ? `重新获取(${left})` : (this.codeUntil > 0 ? '重新获取' : '获取验证码')
    ctx.font = fontRegular(dp(13))
    const labelW = ctx.measureText(label).width
    this.lineInput(ctx, x, y, w - labelW - dp(12), 'code', '请输入验证码', true, false)
    ctx.font = fontRegular(dp(13))
    ctx.fillStyle = left > 0 ? GRAY5 : LINK
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, x + w, y + h / 2)
    this.hit(x + w - labelW - dp(8), y, labelW + dp(8), h, 'login-code', () => {
      this.requestCode()
      return null
    })
  }

  private passwordLine(ctx: CanvasRenderingContext2D, y: number): void {
    const W = this.loginW
    const x = dp(60)
    const w = W - dp(120)
    const h = dp(56)
    const hidden = this.secret.pass !== false
    ctx.font = fontRegular(dp(13))
    const forgot = '忘记密码'
    const forgotW = ctx.measureText(forgot).width
    const eye = this.values.pass ? (hidden ? '显示' : '隐藏') : ''
    ctx.font = fontRegular(dp(13))
    const eyeW = eye ? ctx.measureText(eye).width + dp(16) : 0
    this.lineInput(ctx, x, y, w - forgotW - eyeW - dp(12), 'pass', '请输入8-20位数字和字母', false, true)
    if (eye) {
      ctx.font = fontRegular(dp(13))
      ctx.fillStyle = GRAY5
      ctx.textAlign = 'right'
      ctx.textBaseline = 'middle'
      ctx.fillText(eye, x + w - forgotW - dp(12), y + h / 2)
      this.hit(x + w - forgotW - eyeW - dp(8), y, eyeW, h, 'login-eye', () => {
        this.secret.pass = !hidden
        return null
      })
    }
    ctx.fillStyle = LINK
    ctx.font = fontRegular(dp(13))
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    ctx.fillText(forgot, x + w, y + h / 2)
    this.hit(x + w - forgotW, y, forgotW, h, 'login-forgot', () => {
      this.toast('请使用短信验证码登录')
      return null
    })
  }

  private lineInput(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    id: FieldId,
    placeholder: string,
    numeric: boolean,
    secret: boolean,
  ): void {
    const h = dp(56)
    const value = this.values[id]
    const live = this.field === id && this.domReady()
    const hidden = secret && this.secret[id] !== false
    if (!live) {
      ctx.fillStyle = value ? INK : '#C4C4C7'
      ctx.font = fontRegular(dp(18))
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      const shown = value
        ? (hidden ? '•'.repeat(Math.min(value.length, 18)) : (id === 'phone' ? spacedPhone(value) : value))
        : placeholder
      ctx.fillText(fitText(ctx, shown, Math.max(dp(40), w - dp(8))), x, y + h / 2)
    }
    ctx.fillStyle = LINE
    ctx.fillRect(x, y + h - Math.max(1, dp(1)), w, Math.max(1, dp(1)))
    this.hit(x, y, w, h, 'pfield-' + id, () => {
      this.focus(id, numeric, false)
      return null
    })
    // Coordinates are inside the centered card. The DOM field is positioned in
    // panel space, so the card offset has to be baked in or the caret lands
    // above the line and the tap never hits the real input.
    this.boxes.push({
      id,
      x: x + this.loginPadX,
      y: y + this.loginPadY,
      w,
      h,
      multiline: false,
      secret,
      font: dp(18),
      weight: 400,
      pad: 0,
      placeholder,
      numeric,
    })
  }

  private agreementRow(ctx: CanvasRenderingContext2D, cy: number, center: boolean): void {
    const W = this.loginW
    const box = dp(24)
    ctx.font = fontRegular(dp(13))
    const prefix = '我已阅读并同意'
    const user = '《用户协议》'
    const privacy = '《隐私政策》'
    const width = box + ctx.measureText(prefix + user + privacy).width
    let x = center ? (W - width) / 2 : dp(60)
    this.checkBox(ctx, x, cy - box / 2, this.agreedLogin)
    this.hit(x, cy - box / 2, box + ctx.measureText(prefix).width, box, 'login-agree', () => {
      this.agreedLogin = !this.agreedLogin
      return null
    })
    x += box
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = GRAY5
    ctx.fillText(prefix, x, cy)
    x += ctx.measureText(prefix).width
    ctx.fillStyle = LINK
    ctx.fillText(user, x, cy)
    const userW = ctx.measureText(user).width
    this.hit(x, cy - box / 2, userW, box, 'login-user', () => {
      this.legalKey = 'agreement'
      this.push('legal')
      return null
    })
    x += userW
    ctx.fillText(privacy, x, cy)
    this.hit(x, cy - box / 2, ctx.measureText(privacy).width, box, 'login-privacy', () => {
      this.legalKey = 'privacy'
      this.push('legal')
      return null
    })
  }

  private checkBox(ctx: CanvasRenderingContext2D, x: number, y: number, on: boolean): void {
    const s = dp(16)
    const ox = x + dp(4)
    const oy = y + dp(4)
    ctx.beginPath()
    ctx.arc(ox + s / 2, oy + s / 2, s / 2 - 1, 0, Math.PI * 2)
    if (on) {
      ctx.fillStyle = BRAND
      ctx.fill()
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = Math.max(2, dp(1.6))
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.beginPath()
      ctx.moveTo(ox + s * 0.28, oy + s * 0.52)
      ctx.lineTo(ox + s * 0.44, oy + s * 0.68)
      ctx.lineTo(ox + s * 0.74, oy + s * 0.34)
      ctx.stroke()
    } else {
      ctx.strokeStyle = '#C4C4C7'
      ctx.lineWidth = Math.max(1, dp(1))
      ctx.stroke()
    }
  }

  private iconButton(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    label: string,
    style: 'fill' | 'stroke',
    icon: 'phone' | 'wechat',
    id: string,
    on: () => UiAction | null,
  ): void {
    const h = dp(56)
    round(ctx, x, y, w, h, h / 2)
    if (style === 'fill') {
      ctx.fillStyle = INK
      ctx.fill()
    } else {
      ctx.fillStyle = '#fff'
      ctx.fill()
      ctx.strokeStyle = '#E6E6F0'
      ctx.lineWidth = Math.max(1, dp(1))
      ctx.stroke()
    }
    const iconSize = dp(20)
    ctx.font = font(dp(16))
    const textW = ctx.measureText(label).width
    const gap = dp(8)
    const total = iconSize + gap + textW
    const ix = x + (w - total) / 2
    const iy = y + (h - iconSize) / 2
    if (icon === 'phone') drawPhoneIcon(ctx, ix, iy, iconSize, '#fff')
    else drawWechatIcon(ctx, ix, iy, iconSize)
    ctx.fillStyle = style === 'fill' ? '#fff' : INK
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, ix + iconSize + gap, y + h / 2)
    this.hit(x, y, w, h, id, on)
  }

  private loginButton(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    label: string,
    enabled: boolean,
    id: string,
    on: () => UiAction | null,
    filled = true,
  ): void {
    const h = dp(56)
    round(ctx, x, y, w, h, h / 2)
    if (!enabled) {
      ctx.fillStyle = '#F6F6F8'
      ctx.fill()
    } else if (filled) {
      ctx.fillStyle = INK
      ctx.fill()
    } else {
      ctx.fillStyle = '#fff'
      ctx.fill()
      ctx.strokeStyle = '#E6E6F0'
      ctx.lineWidth = Math.max(1, dp(1))
      ctx.stroke()
    }
    ctx.fillStyle = !enabled ? GRAY5 : filled ? '#fff' : INK
    ctx.font = font(dp(16))
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, x + w / 2, y + h / 2)
    this.hit(x, y, w, h, id, () => (enabled ? on() : null))
  }

  private lastBubble(ctx: CanvasRenderingContext2D, cx: number, buttonY: number): void {
    const w = dp(64)
    const cap = dp(22)
    const top = buttonY + dp(4) - dp(27)
    round(ctx, cx - w / 2, top, w, cap, cap / 2)
    ctx.fillStyle = BRAND
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(cx - dp(7), top + cap - dp(4))
    ctx.lineTo(cx, top + cap + dp(5))
    ctx.lineTo(cx + dp(7), top + cap - dp(4))
    ctx.fill()
    round(ctx, cx - w / 2, top, w, cap, cap / 2)
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.font = font(dp(12))
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('上次登录', cx, top + cap / 2)
  }

  private loginChoices(
    ctx: CanvasRenderingContext2D,
    y: number,
    capsule: string,
    onCapsule: () => UiAction | null,
    capsuleMark: boolean,
  ): void {
    const W = this.loginW
    const items: Array<{ label: string; id: string; mark: boolean; on: () => UiAction | null }> = [
      {
        label: '微信登录',
        id: 'login-opt-wechat',
        mark: this.lastMethod === 'wechat',
        on: () => {
          this.ensureAgree(() => this.push('login-wechat'))
          return null
        },
      },
      {
        label: '游客进入',
        id: 'login-opt-guest',
        mark: this.lastMethod === 'guest',
        on: () => {
          this.ensureAgree(() => this.submitGuest())
          return null
        },
      },
      { label: capsule, id: 'login-opt-text', mark: capsuleMark, on: onCapsule },
    ]
    ctx.font = fontRegular(dp(14))
    const gap = dp(18)
    const widths = items.map((item) => ctx.measureText(item.label).width)
    const total = widths.reduce((sum, w) => sum + w, 0) + gap * (items.length - 1)
    let x = (W - total) / 2
    const h = dp(32)
    items.forEach((item, i) => {
      const w = widths[i]
      ctx.fillStyle = INK
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillText(item.label, x, y + h / 2)
      this.hit(x - dp(4), y, w + dp(8), h, item.id, item.on)
      if (item.mark) this.lastBubble(ctx, x + w / 2, y)
      x += w + gap
    })
  }

  private roundChoice(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    icon: 'wechat' | 'guest',
    id: string,
    on: () => UiAction | null,
  ): void {
    ctx.beginPath()
    ctx.arc(x + size / 2, y + size / 2, size / 2 - 0.5, 0, Math.PI * 2)
    ctx.strokeStyle = '#E6E6F0'
    ctx.lineWidth = Math.max(1, dp(1))
    ctx.stroke()
    const inner = dp(20)
    if (icon === 'wechat') drawWechatIcon(ctx, x + (size - inner) / 2, y + (size - inner) / 2, inner)
    else drawGuestIcon(ctx, x + (size - inner) / 2, y + (size - inner) / 2, inner)
    this.hit(x, y, size, size, id, on)
  }

  private spin(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(((this.now % 900) / 900) * Math.PI * 2)
    ctx.strokeStyle = BRAND
    ctx.lineWidth = Math.max(2, dp(3))
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.arc(0, 0, r, 0, Math.PI * 1.35)
    ctx.stroke()
    ctx.restore()
  }

  private drawLoginOverlay(ctx: CanvasRenderingContext2D): void {
    const H = this.loginH
    ctx.fillStyle = 'rgba(0,0,0,0.45)'
    ctx.fillRect(-this.loginX, 0, this.frame.pw, H)
    this.hit(-this.loginX, 0, this.frame.pw, H, 'login-dim', () => {
      if (this.overlay === 'agree') this.pendingLogin = null
      this.overlay = ''
      return null
    })
    if (this.overlay === 'other') this.overlayOther(ctx)
    else this.overlayAgree(ctx)
  }

  private overlayOther(ctx: CanvasRenderingContext2D): void {
    const W = this.loginW
    const H = this.loginH
    const h = dp(280)
    const y = H - h - dp(24)
    round(ctx, dp(12), y, W - dp(24), h, dp(28))
    ctx.fillStyle = '#fff'
    ctx.fill()
    this.hit(dp(12), y, W - dp(24), h, 'login-sheet', () => null)
    ctx.fillStyle = INK
    ctx.font = font(dp(17))
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('选择其他方式登录', W / 2, y + dp(36))
    this.drawClose(ctx, W - dp(48), y + dp(24))
    this.hit(W - dp(72), y + dp(8), dp(56), dp(48), 'login-close', () => {
      this.overlay = ''
      return null
    })
    const size = dp(48)
    const cx = W / 2
    const oy = y + dp(88)
    ctx.beginPath()
    ctx.arc(cx, oy + size / 2, size / 2, 0, Math.PI * 2)
    ctx.strokeStyle = '#E6E6F0'
    ctx.lineWidth = Math.max(1, dp(1))
    ctx.stroke()
    drawGuestIcon(ctx, cx - dp(12), oy + dp(12), dp(24))
    ctx.fillStyle = GRAY5
    ctx.font = fontRegular(dp(13))
    ctx.textAlign = 'center'
    ctx.fillText('游客登录', cx, oy + size + dp(28))
    this.hit(cx - dp(40), oy, dp(80), size + dp(40), 'login-guest', () => {
      this.ensureAgree(() => this.submitGuest())
      return null
    })
    if (this.lastMethod === 'guest') this.lastBubble(ctx, cx, oy)
    this.agreementRow(ctx, y + h - dp(56), true)
  }

  private overlayAgree(ctx: CanvasRenderingContext2D): void {
    const W = this.loginW
    const H = this.loginH
    const h = dp(250)
    const y = H - h - dp(24)
    round(ctx, dp(12), y, W - dp(24), h, dp(28))
    ctx.fillStyle = '#fff'
    ctx.fill()
    this.hit(dp(12), y, W - dp(24), h, 'login-sheet', () => null)
    ctx.fillStyle = INK
    ctx.font = font(dp(17))
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('用户协议及隐私保护', W / 2, y + dp(36))
    this.agreementRow(ctx, y + dp(88), true)
    this.loginButton(ctx, dp(50), y + dp(120), W - dp(100), '同意并登录', true, 'login-accept', () => {
      this.agreedLogin = true
      const run = this.pendingLogin
      this.pendingLogin = null
      this.overlay = ''
      run?.()
      return null
    })
    ctx.fillStyle = '#8E8E93'
    ctx.font = fontRegular(dp(13))
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('不同意', W / 2, y + h - dp(36))
    this.hit(W / 2 - dp(60), y + h - dp(56), dp(120), dp(40), 'login-deny', () => {
      this.agreedLogin = false
      this.pendingLogin = null
      this.overlay = ''
      return null
    })
  }

  private drawClose(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    ctx.strokeStyle = '#8E8E93'
    ctx.lineWidth = Math.max(2, dp(1.6))
    ctx.lineCap = 'round'
    const s = dp(10)
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + s, y + s)
    ctx.moveTo(x + s, y)
    ctx.lineTo(x, y + s)
    ctx.stroke()
  }

  private ensureAgree(run: () => void): void {
    if (this.agreedLogin) {
      run()
      return
    }
    this.pendingLogin = run
    this.overlay = 'agree'
    this.blur()
  }

  private adopt(session: BoluoUser): void {
    if (session.userName) this.data.name = session.userName
    else if (session.guest) this.data.name = '波萝用户'
    if (session.userId) this.data.userId = session.userId
    this.data.mobile = session.mobile || ''
    if (session.avatar) this.data.avatar = session.avatar
    if (session.sex) this.data.sex = session.sex
    if (session.birthday) this.data.birthday = session.birthday
    this.data.wechatBound = !!session.openId
    this.save()
  }

  private finishLogin(session: BoluoUser, method: LoginMethod): void {
    this.seenToken = session.token
    this.adopt(session)
    if (method) this.remember(method)
    this.pendingLogin = null
    this.overlay = ''
    if (session.guest) {
      this.toast('登录成功')
      this.host?.close()
      return
    }
    this.home()
    this.toast(session.isCancel && session.cancelMsg ? session.cancelMsg : '登录成功')
  }

  private remember(method: LoginMethod): void {
    this.lastMethod = method
    try { localStorage.setItem(LAST_LOGIN, method) } catch { /* storage can be unavailable */ }
  }

  private requestCode(): void {
    if (this.loginBusy || this.codeUntil > this.now) return
    if (!/^1\d{10}$/.test(this.values.phone)) {
      this.toast('请输入正确的手机号')
      return
    }
    const mobile = this.values.phone
    this.loginBusy = true
    void sendVerifyCode(mobile).then((seconds) => {
      this.loginBusy = false
      this.codeShown = true
      this.codeUntil = this.now + seconds * 1000
      this.toast('验证码已发送至手机号')
    }).catch((err: unknown) => {
      this.loginBusy = false
      this.toast(this.failText(err))
    })
  }

  private submitMobile(): void {
    if (this.loginBusy) return
    if (!/^1\d{10}$/.test(this.values.phone)) {
      this.toast('请输入正确的手机号')
      return
    }
    if (this.values.code.length < 4) {
      this.toast('验证码有误，请重新输入')
      return
    }
    if (!this.agreedLogin) {
      this.ensureAgree(() => this.submitMobile())
      return
    }
    this.loginBusy = true
    void loginMobile(this.values.phone, this.values.code).then((session) => {
      this.loginBusy = false
      this.finishLogin(session, 'verify')
    }).catch((err: unknown) => {
      this.loginBusy = false
      this.toast(this.failText(err))
    })
  }

  private submitBind(): void {
    if (this.loginBusy || !this.bindOpenId) return
    if (!/^1\d{10}$/.test(this.values.phone)) {
      this.toast('请输入正确的手机号')
      return
    }
    if (this.values.code.length < 4) {
      this.toast('验证码有误，请重新输入')
      return
    }
    this.loginBusy = true
    void bindWechatPhone(this.values.phone, this.values.code, this.bindOpenId).then((session) => {
      this.loginBusy = false
      this.finishLogin(session, 'wechat')
    }).catch((err: unknown) => {
      this.loginBusy = false
      this.toast(this.failText(err))
    })
  }

  private submitPassword(): void {
    if (this.loginBusy) return
    if (!/^1\d{10}$/.test(this.values.phone)) {
      this.toast('请输入正确的手机号')
      return
    }
    if (!validPassword(this.values.pass)) {
      this.toast('密码为8-20位数字和字母')
      return
    }
    if (!this.agreedLogin) {
      this.ensureAgree(() => this.submitPassword())
      return
    }
    this.loginBusy = true
    void loginPassword(this.values.phone, this.values.pass).then((session) => {
      this.loginBusy = false
      this.finishLogin(session, 'password')
    }).catch((err: unknown) => {
      this.loginBusy = false
      this.toast(this.failText(err))
    })
  }

  private submitGuest(): void {
    if (this.loginBusy) return
    if (!this.agreedLogin) {
      this.ensureAgree(() => this.submitGuest())
      return
    }
    this.loginBusy = true
    void enterGuest().then((session) => {
      this.loginBusy = false
      if (!session) {
        this.toast('登录失败')
        return
      }
      this.finishLogin(session, 'guest')
    })
  }

  private openQr(): void {
    const gen = ++this.qrGen
    this.qrState = 'loading'
    this.qrImage = ''
    this.qrScene = 0
    this.qrMsg = ''
    this.pollFails = 0
    this.pollBusy = false
    void startWechat().then((qr) => {
      if (gen !== this.qrGen) return
      this.qrScene = qr.sceneId
      this.qrImage = qr.image
      this.qrUntil = this.now + qr.expireSec * 1000
      this.qrState = 'ready'
      this.pollAt = 0
    }).catch((err: unknown) => {
      if (gen !== this.qrGen) return
      this.qrState = 'error'
      this.qrMsg = this.failText(err)
    })
  }

  private pollQr(): void {
    if (this.view !== 'login-wechat' || this.qrState !== 'ready' || !this.qrScene) return
    if (this.now >= this.qrUntil) {
      this.qrState = 'expired'
      return
    }
    if (this.pollBusy || this.now - this.pollAt < 1000) return
    this.pollAt = this.now
    this.pollBusy = true
    const gen = this.qrGen
    const scene = this.qrScene
    void pollWechat(scene).then((hit) => {
      if (gen !== this.qrGen) return
      this.pollBusy = false
      if (hit.kind === 'wait') {
        this.pollFails = 0
        return
      }
      if (hit.kind === 'ok') {
        this.finishLogin(hit.user, 'wechat')
        return
      }
      if (hit.kind === 'bind') {
        this.bindOpenId = hit.openId
        this.push('login-bind')
        return
      }
      if (hit.kind === 'retry') {
        this.pollFails += 1
        if (this.pollFails >= 5) {
          this.qrState = 'error'
          this.qrMsg = hit.message
        }
        return
      }
      if (hit.message.includes('失效')) this.qrState = 'expired'
      else {
        this.qrState = 'error'
        this.qrMsg = hit.message
      }
    }).catch(() => {
      if (gen !== this.qrGen) return
      this.pollBusy = false
      this.pollFails += 1
      if (this.pollFails >= 5) {
        this.qrState = 'error'
        this.qrMsg = '网络连接失败，请检查网络'
      }
    })
  }

  private failText(err: unknown): string {
    if (err instanceof Error && err.message) return err.message
    return '网络连接失败，请检查网络'
  }

  private pageSettings(ctx: CanvasRenderingContext2D, y: number): number {
    this.card(ctx, 48, y, W - 96, 168)
    this.row(ctx, 48, y + 12, '账号与安全', '', true, () => {
      this.push('account')
      return null
    })
    y += 168 + 36
    const items: Array<[string, string]> = [
      ['用户协议', 'agreement'],
      ['隐私政策', 'privacy'],
      ['第三方信息共享清单', 'third'],
      ['个人信息收集清单', 'personal'],
    ]
    this.card(ctx, 48, y, W - 96, 24 + (items.length + 1) * 144)
    items.forEach((item, i) => {
      this.row(ctx, 48, y + 12 + i * 144, item[0], '', true, () => {
        this.legalKey = item[1]
        this.push('legal')
        return null
      })
    })
    this.row(ctx, 48, y + 12 + items.length * 144, '隐私权限设置', '', true, () => {
      this.push('privacy')
      return null
    })
    y += 24 + (items.length + 1) * 144 + 48
    this.card(ctx, 48, y, W - 96, 168)
    ctx.fillStyle = INK
    ctx.font = font(45)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('退出登录', W / 2, y + 84)
    this.hit(48, y, W - 96, 168, 'plogout', () => {
      this.host?.askLogout()
      return null
    })
    return y + 200
  }

  private pageAbout(ctx: CanvasRenderingContext2D, y: number): number {
    y += 48
    blit(ctx, '/ui/ref/app-logo.png', (W - 240) / 2, y, 240, 240)
    ctx.fillStyle = 'rgba(25,25,26,0.3)'
    ctx.font = font(39)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(`版本Version ${APP_VERSION}`, W / 2, y + 240 + 68)
    y += 240 + 48 + 40 + 84
    this.card(ctx, 48, y, W - 96, 24 + 288)
    this.row(ctx, 48, y + 12, '当前版本', APP_VERSION, false, () => null)
    this.row(ctx, 48, y + 12 + 144, '检查新版本', '', true, () => {
      this.toast('已是最新版本')
      return null
    })
    ctx.fillStyle = SUB
    ctx.font = font(36)
    ctx.textAlign = 'center'
    ctx.fillText('Copyright©2020-2026', W / 2, H - 220)
    ctx.fillText('天津全景声文化传媒有限公司版权所有', W / 2, H - 160)
    return H - 80
  }

  private pageFeedback(ctx: CanvasRenderingContext2D, y: number): number {
    this.card(ctx, 48, y, W - 96, 620)
    ctx.fillStyle = INK
    ctx.font = font(48)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText('问题描述', 108, y + 70)
    ctx.fillStyle = ERR
    ctx.fillText('*', 108 + textWidth('问题描述', 48) + 8, y + 70)
    ctx.fillStyle = 'rgba(25,25,26,0.4)'
    ctx.font = font(36)
    ctx.textAlign = 'right'
    ctx.fillText(`${this.values.feedback.length}/200`, W - 108, y + 70)
    this.fieldBox(ctx, 96, y + 130, W - 192, 420, 'feedback', '当前仅支持文字内容，请在此描述你的问题...', false, true)
    y += 656
    this.card(ctx, 48, y, W - 96, 280)
    const size = 192
    this.images.forEach((src, index) => {
      const ix = 108 + index * (size + 24)
      this.thumb(ctx, src, ix, y + 36, size)
      round(ctx, ix + size - 36, y + 24, 48, 48, 24)
      ctx.fillStyle = 'rgba(0,0,0,0.55)'
      ctx.fill()
      ctx.fillStyle = '#fff'
      ctx.font = font(36)
      ctx.textAlign = 'center'
      ctx.fillText('×', ix + size - 12, y + 48)
      this.hit(ix + size - 48, y + 12, 72, 72, 'pimg-x' + index, () => {
        this.images.splice(index, 1)
        this.imageRev += 1
        return null
      })
    })
    if (this.images.length < 4) {
      const ix = 108 + this.images.length * (size + 24)
      round(ctx, ix, y + 36, size, size, 36)
      ctx.fillStyle = '#F6F6F6'
      ctx.fill()
      ctx.fillStyle = SUB
      ctx.font = font(72)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('+', ix + size / 2, y + 36 + size / 2)
      this.hit(ix, y + 36, size, size, 'pimg-add', () => {
        this.pickImage((url) => {
          if (this.images.length >= 4) {
            this.toast('最多上传 4 张图片')
            return
          }
          this.images.push(url)
          this.imageRev += 1
        })
        return null
      })
    }
    ctx.fillStyle = 'rgba(25,25,26,0.4)'
    ctx.font = font(36)
    ctx.textAlign = 'left'
    ctx.fillText(`上传图片 ${this.images.length}/4`, 108, y + 250)
    y += 316
    this.card(ctx, 48, y, W - 96, 280)
    ctx.fillStyle = INK
    ctx.font = font(48)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText('联系方式', 108, y + 64)
    ctx.fillStyle = ERR
    ctx.fillText('*', 108 + textWidth('联系方式', 48) + 8, y + 64)
    this.fieldBox(ctx, 96, y + 110, W - 192, 120, 'contact', '请输入你的手机号', true, false)
    y += 328
    this.primary(ctx, 48, y, '提交', true, 'psend', () => {
      const content = this.values.feedback.trim()
      const contact = this.values.contact.trim()
      if (!content) {
        this.toast('请描述你的问题')
        return null
      }
      if (contact && !/^1\d{10}$/.test(contact)) {
        this.toast('请输入正确的手机号')
        return null
      }
      this.values.feedback = ''
      this.values.contact = ''
      this.images = []
      this.toast('反馈已提交')
      this.back()
      return null
    })
    return y + 200
  }

  private pageEdit(ctx: CanvasRenderingContext2D, y: number): number {
    y += 36
    const size = 300
    const x = (W - size) / 2
    this.avatar(ctx, x, y, size, 96)
    this.hit(x, y, size, size, 'pavatar', () => {
      this.pickAvatar()
      return null
    })
    ctx.fillStyle = LINK
    ctx.font = font(45)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('编辑头像', W / 2, y + size + 48)
    this.hit(W / 2 - 160, y + size + 12, 320, 80, 'pavatar2', () => {
      this.pickAvatar()
      return null
    })
    y += size + 120
    this.card(ctx, 48, y, W - 96, 168)
    this.row(ctx, 48, y + 12, 'ID', this.data.userId || '-', false, () => null)
    y += 168 + 36
    const birth = this.data.birthday ? this.data.birthday.replace(/-/g, '.') : '未知'
    this.card(ctx, 48, y, W - 96, 24 + 432)
    this.row(ctx, 48, y + 12, '昵称', this.data.name, true, () => {
      this.values.nick = this.data.name
      this.overlay = 'nick'
      this.focus('nick')
      return null
    })
    this.row(ctx, 48, y + 156, '性别', sexLabel(this.data.sex), true, () => {
      this.overlay = 'gender'
      return null
    })
    this.row(ctx, 48, y + 300, '生日', birth, true, () => {
      this.readBirthday()
      this.overlay = 'birthday'
      return null
    })
    return y + 24 + 432 + 80
  }

  private pageAccount(ctx: CanvasRenderingContext2D, y: number): number {
    y += 24
    this.card(ctx, 48, y, W - 96, 24 + 288)
    this.row(ctx, 48, y + 12, '手机号', maskMobile(this.data.mobile), true, () => {
      if (!this.data.mobile) this.push('phone')
      else this.overlay = 'phone-confirm'
      return null
    })
    this.row(ctx, 48, y + 156, '登录密码', this.data.passwordSet ? '已设置' : '未设置', true, () => {
      this.push(this.data.passwordSet ? 'password' : 'init-password')
      return null
    })
    y += 24 + 288 + 36
    this.card(ctx, 48, y, W - 96, 168)
    this.row(ctx, 48, y + 12, '微信账号', this.data.wechatBound ? '已绑定' : '未绑定', true, () => {
      if (this.data.wechatBound) this.overlay = 'unbind'
      else this.push('wechat')
      return null
    })
    y += 168 + 36
    this.card(ctx, 48, y, W - 96, 168)
    this.row(ctx, 48, y + 12, '账号注销', '', true, () => {
      this.push('cancel')
      return null
    })
    return y + 220
  }

  private pageLegal(ctx: CanvasRenderingContext2D, y: number): number {
    this.showLegal = true
    this.legalBox = { x: 48, y: this.clipY, w: W - 96, h: this.clipH - 36 }
    round(ctx, 48, y, W - 96, this.clipH - 36, 24)
    ctx.fillStyle = '#fff'
    ctx.fill()
    if (typeof document === 'undefined') {
      ctx.fillStyle = SUB
      ctx.font = font(36)
      ctx.textAlign = 'left'
      wrap(ctx, `${H5}${LEGAL[this.legalKey]?.path || ''}`, 96, y + 48, W - 192, 56)
    }
    return y + this.clipH
  }

  private pagePrivacy(ctx: CanvasRenderingContext2D, y: number): number {
    y += 24
    const on = this.data.locationOn
    this.card(ctx, 48, y, W - 96, 280)
    ctx.fillStyle = INK
    ctx.font = font(45)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText('位置服务', 108, y + 70)
    ctx.textAlign = 'right'
    if (on) {
      ctx.fillStyle = 'rgba(25,25,26,0.2)'
      ctx.fillText('已开启', W - 108, y + 70)
    } else {
      ctx.fillStyle = LINK
      ctx.fillText('去开启', W - 108, y + 70)
    }
    ctx.fillStyle = SUB
    ctx.font = font(33)
    ctx.textAlign = 'left'
    const body = on ? '已授权！根据真实天气及时间实时换声景' : '开启后，根据真实天气及时间实时换声景'
    wrap(ctx, body, 108, y + 120, W - 220, 48)
    ctx.fillStyle = SUB
    wrap(ctx, '（雨天→雨滴声、晴天→鸟鸣声 ）', 108, y + 180, W - 220, 48)
    if (!on) {
      this.hit(48, y, W - 96, 280, 'ploc', () => {
        this.enableLocation()
        return null
      })
    }
    return y + 340
  }

  private pagePhone(ctx: CanvasRenderingContext2D, y: number): number {
    y += 48
    this.fieldBox(ctx, 48, y, W - 96, 144, 'phone', '请输入手机号', true, false)
    y += 168
    const left = Math.ceil((this.codeUntil - this.now) / 1000)
    this.fieldBox(ctx, 48, y, W - 96 - 360, 144, 'code', '请输入验证码', true, false)
    const label = left > 0 ? `重新发送（${left}）` : '获取验证码'
    ctx.fillStyle = left > 0 ? SUB : LINK
    ctx.font = font(39)
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, W - 72, y + 72)
    this.hit(W - 420, y, 360, 144, 'pcode', () => {
      this.sendCode()
      return null
    })
    y += 200
    this.primary(ctx, 48, y, '确定', true, 'pphone', () => {
      this.submitPhone()
      return null
    })
    return y + 220
  }

  private pagePassword(ctx: CanvasRenderingContext2D, y: number): number {
    y += 24
    this.card(ctx, 48, y, W - 96, 24 + 288)
    this.row(ctx, 48, y + 12, '修改密码', '', true, () => {
      this.passMode = 'change'
      this.resetPass()
      this.push('change-password')
      return null
    })
    this.row(ctx, 48, y + 156, '忘记密码', '', true, () => {
      this.passMode = 'forgot'
      this.resetPass()
      this.push('change-password')
      return null
    })
    return y + 400
  }

  private pageInitPassword(ctx: CanvasRenderingContext2D, y: number): number {
    y += 36
    this.secretBox(ctx, 48, y, 'pass', '设置8-20位数字和字母密码')
    y += 180
    this.secretBox(ctx, 48, y, 'pass2', '重新确认8-20位密码')
    y += 220
    this.primary(ctx, 48, y, '确定', true, 'pinit', () => {
      if (!validPassword(this.values.pass)) {
        this.toast('请设置 8-20 位包含字母和数字的密码')
        return null
      }
      if (this.values.pass !== this.values.pass2) {
        this.toast('两次输入的密码不一致，请重新设置')
        return null
      }
      this.data.passwordSet = true
      this.save()
      this.values.pass = ''
      this.values.pass2 = ''
      this.toast('密码已设置')
      this.back()
      return null
    })
    return y + 220
  }

  private pageChangePassword(ctx: CanvasRenderingContext2D, y: number): number {
    y += 24
    this.card(ctx, 48, y, W - 96, 168)
    this.row(ctx, 48, y + 12, '手机号', maskMobile(this.data.mobile), false, () => null)
    y += 204
    const left = Math.ceil((this.codeUntil - this.now) / 1000)
    this.fieldBox(ctx, 48, y, W - 96 - 360, 144, 'code', '请输入验证码', true, false)
    ctx.fillStyle = left > 0 ? SUB : LINK
    ctx.font = font(39)
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    ctx.fillText(left > 0 ? `重新发送（${left}）` : '获取验证码', W - 72, y + 72)
    this.hit(W - 420, y, 360, 144, 'pcode2', () => {
      if (!/^1\d{10}$/.test(this.data.mobile)) {
        this.toast('请输入正确的手机号')
        return null
      }
      if (this.codeUntil > this.now) return null
      this.codeSent = true
      this.codeUntil = this.now + 60000
      return null
    })
    y += 180
    this.secretBox(ctx, 48, y, 'pass', '设置8-20位数字和字母新密码')
    y += 180
    this.secretBox(ctx, 48, y, 'pass2', '重新确认8-20位新密码')
    y += 220
    this.primary(ctx, 48, y, '确定', true, 'ppass', () => {
      if (!this.codeSent || this.values.code.length !== 4) {
        this.toast('验证码有误，请重新输入')
        return null
      }
      if (!validPassword(this.values.pass)) {
        this.toast('请设置 8-20 位包含字母和数字的密码')
        return null
      }
      if (this.values.pass !== this.values.pass2) {
        this.toast('两次输入的密码不一致，请重新设置')
        return null
      }
      this.data.passwordSet = true
      this.save()
      this.resetPass()
      this.toast(this.passMode === 'forgot' ? '重置成功' : '修改成功')
      this.back()
      return null
    })
    return y + 220
  }

  private pageCancel(ctx: CanvasRenderingContext2D, y: number): number {
    y += 24
    ctx.fillStyle = INK
    ctx.font = font(48)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText('波萝账号注销注意事项', 48, y + 30)
    ctx.fillStyle = ERR
    ctx.fillText('*', 48 + textWidth('波萝账号注销注意事项', 48) + 6, y + 30)
    y += 80
    const lines1 = linesOf(ctx, NOTICE_1, W - 240, 42)
    const lines2 = linesOf(ctx, NOTICE_2, W - 240, 42)
    const cardH = 72 + (lines1.length + lines2.length) * 64 + 24
    this.card(ctx, 48, y, W - 96, cardH)
    ctx.fillStyle = '#252734'
    ctx.font = font(42)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    let ty = y + 48
    for (const line of lines1) {
      ctx.fillText(line, 96, ty)
      ty += 64
    }
    ty += 16
    for (const line of lines2) {
      ctx.fillText(line, 96, ty)
      ty += 64
    }
    y += cardH + 48
    this.primary(ctx, 48, y, '取消', true, 'pcancel-back', () => {
      this.back()
      return null
    })
    y += 180
    const left = Math.max(0, Math.ceil((this.cancelUntil - this.now) / 1000))
    const ready = left <= 0
    const label = ready ? '我已知晓，确认注销' : `我已知晓，确认注销（${left}s）`
    this.card(ctx, 48, y, W - 96, 168)
    ctx.fillStyle = ready ? INK : 'rgba(25,25,26,0.4)'
    ctx.font = font(42)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, W / 2, y + 84)
    this.hit(48, y, W - 96, 168, 'pcancel-go', () => {
      if (!ready) return null
      this.wipe()
      return { type: 'cancel-account' }
    })
    return y + 220
  }

  private pageWechat(ctx: CanvasRenderingContext2D, y: number): number {
    const loading = this.now - this.wechatAt < 800
    const cx = W / 2
    const cy = y + 520
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.font = font(51)
    const mark = '微信'
    const rest = '绑定'
    const titleW = ctx.measureText(mark + rest).width
    let tx = cx - titleW / 2
    ctx.fillStyle = '#00A375'
    ctx.fillText(mark, tx, cy - 360)
    tx += ctx.measureText(mark).width
    ctx.fillStyle = INK
    ctx.fillText(rest, tx, cy - 360)
    ctx.textAlign = 'center'
    round(ctx, cx - 300, cy - 300, 600, 600, 12)
    ctx.fillStyle = '#fff'
    ctx.fill()
    ctx.strokeStyle = '#E6E7EB'
    ctx.lineWidth = 3
    ctx.stroke()
    if (loading) {
      ctx.fillStyle = '#00A375'
      ctx.font = font(42)
      ctx.fillText('加载中…', cx, cy)
    } else {
      round(ctx, cx - 300, cy - 300, 600, 600, 12)
      ctx.fillStyle = 'rgba(0,0,0,0.7)'
      ctx.fill()
      ctx.fillStyle = '#fff'
      ctx.font = font(42)
      ctx.fillText('二维码加载失败', cx, cy - 40)
      round(ctx, cx - 150, cy + 30, 300, 108, 54)
      ctx.fillStyle = '#fff'
      ctx.fill()
      ctx.fillStyle = INK
      ctx.font = font(39)
      ctx.fillText('刷新重试', cx, cy + 84)
      this.hit(cx - 150, cy + 30, 300, 108, 'pqr', () => {
        this.wechatAt = this.now
        this.toast('网络连接失败，请检查网络')
        return null
      })
    }
    return cy + 360
  }

  private drawOverlay(ctx: CanvasRenderingContext2D, top: number): void {
    const h = H - top
    ctx.fillStyle = 'rgba(0,0,0,0.45)'
    ctx.fillRect(0, top, W, h)
    this.hit(0, top, W, h, 'odim', () => {
      if (this.overlay === 'nick') this.askNickClose()
      else if (this.overlay === 'birthday') this.askBirthClose()
      else if (this.overlay === 'nick-save' || this.overlay === 'birth-save') return null
      else this.overlay = ''
      return null
    })
    if (this.overlay === 'nick') this.overlayNick(ctx)
    else if (this.overlay === 'gender') this.overlayGender(ctx)
    else if (this.overlay === 'birthday') this.overlayBirthday(ctx)
    else if (this.overlay === 'nick-save') this.confirmBox(ctx, '是否保存修改？', '', '保存', '放弃', () => this.commitNick(), () => { this.overlay = '' })
    else if (this.overlay === 'birth-save') this.confirmBox(ctx, '是否保存修改？', '', '保存', '放弃', () => this.commitBirth(), () => { this.overlay = '' })
    else if (this.overlay === 'unbind') this.confirmBox(ctx, '是否解绑微信账号？', '解绑后将无法使用 微信账号 登录波萝', '解除绑定', '取消', () => {
      this.data.wechatBound = false
      this.save()
      this.overlay = ''
      this.toast('解绑成功')
    }, () => { this.overlay = '' })
    else if (this.overlay === 'phone-confirm') this.confirmBox(ctx, '更换已经绑定的手机？', maskMobile(this.data.mobile), '更换', '取消', () => {
      this.overlay = ''
      this.values.phone = ''
      this.values.code = ''
      this.codeSent = false
      this.push('phone')
    }, () => { this.overlay = '' })
  }

  private overlayNick(ctx: CanvasRenderingContext2D): void {
    const y = H - 720
    this.sheet(ctx, 0, y, W, 760)
    ctx.fillStyle = INK
    ctx.font = font(48)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText('编辑昵称', 72, y + 90)
    ctx.fillStyle = LINK
    ctx.textAlign = 'right'
    ctx.fillText('确定', W - 72, y + 90)
    this.hit(W - 240, y + 36, 200, 108, 'onick', () => {
      this.commitNick()
      return null
    })
    this.fieldBox(ctx, 60, y + 180, W - 120, 144, 'nick', '请设置2-16位昵称', false, false)
    ctx.fillStyle = SUB
    ctx.font = font(33)
    ctx.textAlign = 'left'
    ctx.fillText('请输入2-16位字符', 72, y + 380)
  }

  private overlayGender(ctx: CanvasRenderingContext2D): void {
    const y = H - 640
    this.sheet(ctx, 48, y, W - 96, 560)
    ctx.fillStyle = INK
    ctx.font = font(48)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('选择性别', W / 2, y + 80)
    const options: Array<[number, string]> = [[1, '男'], [2, '女'], [0, '保密']]
    options.forEach((item, i) => {
      const ry = y + 150 + i * 120
      const selected = this.data.sex === item[0] || (item[0] === 0 && this.data.sex === 3)
      ctx.fillStyle = selected ? '#00A375' : INK
      ctx.font = font(45)
      ctx.textAlign = 'center'
      ctx.fillText(item[1], W / 2, ry + 40)
      this.hit(96, ry, W - 192, 110, 'ogender' + item[0], () => {
        this.data.sex = item[0]
        this.save()
        this.overlay = ''
        return null
      })
    })
  }

  private overlayBirthday(ctx: CanvasRenderingContext2D): void {
    const y = H - 860
    this.sheet(ctx, 48, y, W - 96, 780)
    ctx.fillStyle = INK
    ctx.font = font(48)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('选择日期', W / 2, y + 80)
    ctx.fillStyle = LINK
    ctx.textAlign = 'right'
    ctx.fillText('保存', W - 120, y + 80)
    this.hit(W - 280, y + 24, 200, 110, 'obirth-save', () => {
      this.overlay = 'birth-save'
      return null
    })
    this.stepper(ctx, y + 180, '年', this.birthY, (d) => { this.birthY = Math.min(new Date().getFullYear(), Math.max(1920, this.birthY + d)) })
    this.stepper(ctx, y + 340, '月', this.birthM, (d) => { this.birthM = ((this.birthM - 1 + d + 12) % 12) + 1 })
    this.stepper(ctx, y + 500, '日', this.birthD, (d) => { this.birthD = ((this.birthD - 1 + d + 31) % 31) + 1 })
  }

  private stepper(ctx: CanvasRenderingContext2D, y: number, unit: string, value: number, step: (d: number) => void): void {
    ctx.fillStyle = SUB
    ctx.font = font(36)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(unit, 140, y + 50)
    round(ctx, 280, y, 120, 100, 24)
    ctx.fillStyle = '#F6F6F6'
    ctx.fill()
    ctx.fillStyle = INK
    ctx.font = font(48)
    ctx.textAlign = 'center'
    ctx.fillText('－', 340, y + 50)
    this.hit(280, y, 120, 100, 'ostep-d' + unit, () => { step(-1); return null })
    ctx.fillStyle = INK
    ctx.font = font(54)
    ctx.fillText(String(value), W / 2, y + 50)
    round(ctx, W - 400, y, 120, 100, 24)
    ctx.fillStyle = '#F6F6F6'
    ctx.fill()
    ctx.fillStyle = INK
    ctx.font = font(48)
    ctx.fillText('＋', W - 340, y + 50)
    this.hit(W - 400, y, 120, 100, 'ostep-u' + unit, () => { step(1); return null })
  }

  private confirmBox(
    ctx: CanvasRenderingContext2D,
    title: string,
    body: string,
    primary: string,
    secondary: string,
    onPrimary: () => void,
    onSecondary: () => void,
  ): void {
    const h = body ? 620 : 480
    const y = (H - h) / 2
    this.sheet(ctx, 70, y, W - 140, h)
    ctx.fillStyle = INK
    ctx.font = font(54)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(title, W / 2, y + 120)
    if (body) {
      ctx.font = font(39)
      ctx.fillStyle = SUB
      wrap(ctx, body, 130, y + 190, W - 260, 56)
    }
    this.primary(ctx, 140, y + h - 280, primary, true, 'oconfirm', () => {
      onPrimary()
      return null
    })
    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    ctx.font = font(42)
    ctx.textAlign = 'center'
    ctx.fillText(secondary, W / 2, y + h - 70)
    this.hit(140, y + h - 120, W - 280, 90, 'ocancel', () => {
      onSecondary()
      return null
    })
  }

  private commitNick(): void {
    const name = this.values.nick.trim()
    if (name.length < 2 || name.length > 16) {
      this.toast('请输入2-16位字符')
      this.overlay = 'nick'
      return
    }
    this.data.name = name
    this.save()
    this.overlay = ''
    this.blur()
  }

  private askNickClose(): void {
    if (this.values.nick.trim() !== this.data.name) this.overlay = 'nick-save'
    else {
      this.overlay = ''
      this.blur()
    }
  }

  private readBirthday(): void {
    const parts = this.data.birthday.split('-').map((n) => Number(n))
    if (parts.length === 3 && validDate(parts[0], parts[1], parts[2])) {
      this.birthY = parts[0]
      this.birthM = parts[1]
      this.birthD = parts[2]
      return
    }
    this.birthY = 2000
    this.birthM = 1
    this.birthD = 1
  }

  private askBirthClose(): void {
    const next = `${this.birthY}-${pad2(this.birthM)}-${pad2(this.birthD)}`
    if (next !== this.data.birthday) this.overlay = 'birth-save'
    else this.overlay = ''
  }

  private commitBirth(): void {
    if (!validDate(this.birthY, this.birthM, this.birthD)) {
      this.toast('请输入有效生日')
      this.overlay = 'birthday'
      return
    }
    this.data.birthday = `${this.birthY}-${pad2(this.birthM)}-${pad2(this.birthD)}`
    this.save()
    this.overlay = ''
  }

  private sendCode(): void {
    if (!/^1\d{10}$/.test(this.values.phone)) {
      this.toast('请输入正确的手机号')
      return
    }
    if (this.codeUntil > this.now) return
    this.codeSent = true
    this.codeUntil = this.now + 60000
  }

  private submitPhone(): void {
    if (!/^1\d{10}$/.test(this.values.phone)) {
      this.toast('请输入正确的手机号')
      return
    }
    if (!this.codeSent || this.values.code.length !== 4) {
      this.toast('验证码有误，请重新输入')
      return
    }
    this.data.mobile = this.values.phone
    this.save()
    this.values.phone = ''
    this.values.code = ''
    this.codeSent = false
    this.codeUntil = 0
    this.toast('手机号已更新')
    this.back()
  }

  private resetPass(): void {
    this.values.pass = ''
    this.values.pass2 = ''
    this.values.code = ''
    this.codeSent = false
    this.codeUntil = 0
  }

  private enableLocation(): void {
    const geo = typeof navigator === 'undefined' ? undefined : navigator.geolocation
    const done = () => {
      this.data.locationOn = true
      this.save()
    }
    if (!geo) {
      done()
      return
    }
    geo.getCurrentPosition(done, () => { /* 保持未开启 */ })
  }

  private pickAvatar(): void {
    this.pickImage((url) => {
      this.data.avatar = url
      this.avatarRev += 1
      this.save()
      this.toast('头像已更新')
    })
  }

  private pickImage(onUrl: (url: string) => void): void {
    if (typeof document === 'undefined') {
      this.toast('无法读取所选图片')
      return
    }
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onerror = () => this.toast('无法读取所选图片')
      reader.onload = () => shrinkImage(String(reader.result || ''), (url) => onUrl(url))
      reader.readAsDataURL(file)
    }
    input.click()
  }

  private save(): void {
    try { localStorage.setItem(STORE, JSON.stringify(this.data)) } catch { /* quota or private mode */ }
  }

  private toast(text: string): void {
    this.host?.toast(text)
  }

  private hit(x: number, y: number, w: number, h: number, id: string, on: () => UiAction | null): void {
    const yy = (this.scrolling ? y - this.scroll : y) + this.loginPadY
    if (this.scrolling && (yy + h < this.clipY || yy > this.clipY + this.clipH)) return
    this.host?.hit(x + this.loginPadX, yy, w, h, id, on)
  }

  private card(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    round(ctx, x, y, w, h, 84)
    ctx.fillStyle = '#fff'
    ctx.fill()
  }

  private sheet(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    round(ctx, x, y, w, h, 48)
    ctx.fillStyle = '#fff'
    ctx.fill()
    this.hit(x, y, w, h, 'osheet', () => null)
  }

  private row(ctx: CanvasRenderingContext2D, x: number, y: number, label: string, value: string, arrow: boolean, on: () => UiAction | null): void {
    ctx.fillStyle = INK
    ctx.font = font(45)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, x + 60, y + 72)
    const arrowW = arrow ? 84 : 0
    if (value) {
      ctx.fillStyle = VALUE
      ctx.textAlign = 'right'
      ctx.fillText(fitText(ctx, value, W - 96 - 120 - arrowW), x + (W - 96) - 60 - arrowW, y + 72)
    }
    if (arrow) blit(ctx, '/ui/mine/detail.svg', x + (W - 96) - 120, y + 42, 60, 60)
    this.hit(x, y, W - 96, 144, 'prow-' + label, on)
  }

  private fieldBox(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    id: FieldId,
    placeholder: string,
    numeric: boolean,
    multiline: boolean,
    secret = false,
  ): void {
    round(ctx, x, y, w, h, multiline ? 36 : Math.min(42, h / 2))
    ctx.fillStyle = id === 'feedback' || id === 'nick' ? '#F6F6F6' : '#fff'
    ctx.fill()
    const value = this.values[id]
    const live = this.field === id && this.domReady()
    if (!live) {
      ctx.fillStyle = value ? INK : '#C4C4C7'
      ctx.font = font(42)
      ctx.textAlign = 'left'
      ctx.textBaseline = multiline ? 'top' : 'middle'
      const shown = value ? (secret ? '•'.repeat(Math.min(value.length, 18)) : value) : placeholder
      if (multiline) wrap(ctx, shown, x + 28, y + 28, w - 56, 58)
      else ctx.fillText(fitText(ctx, shown, w - 56), x + 36, y + h / 2)
    }
    this.hit(x, y, w, h, 'pfield-' + id, () => {
      this.focus(id, numeric, multiline)
      return null
    })
    const yy = this.scrolling ? y - this.scroll : y
    this.boxes.push({
      id,
      x,
      y: yy,
      w,
      h,
      multiline,
      secret,
      font: 42,
      weight: 500,
      pad: multiline ? 28 : 36,
      placeholder,
      numeric,
    })
  }

  private secretBox(ctx: CanvasRenderingContext2D, x: number, y: number, id: 'pass' | 'pass2', placeholder: string): void {
    const hidden = this.secret[id] !== false
    this.fieldBox(ctx, x, y, W - 96 - 180, 144, id, placeholder, false, false, hidden)
    ctx.fillStyle = LINK
    ctx.font = font(36)
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    ctx.fillText(hidden ? '显示' : '隐藏', x + (W - 96) - 24, y + 72)
    this.hit(x + W - 96 - 180, y, 180, 144, 'peye-' + id, () => {
      this.secret[id] = !hidden
      return null
    })
  }

  private primary(ctx: CanvasRenderingContext2D, x: number, y: number, label: string, enabled: boolean, id: string, on: () => UiAction | null): void {
    round(ctx, x, y, W - 96, 156, 78)
    ctx.fillStyle = enabled ? INK : '#E6E7EB'
    ctx.fill()
    ctx.fillStyle = enabled ? '#fff' : VALUE
    ctx.font = font(45)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, x + (W - 96) / 2, y + 78)
    this.hit(x, y, W - 96, 156, id, () => (enabled ? on() : null))
  }

  private avatar(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, fontPx: number): void {
    ctx.save()
    ctx.beginPath()
    ctx.arc(x + size / 2, y + size / 2, size * 0.46, 0, Math.PI * 2)
    ctx.clip()
    ctx.fillStyle = '#fff'
    ctx.fillRect(x, y, size, size)
    const photo = this.data.avatar ? imageOf(this.data.avatar, () => { this.avatarRev += 1 }) : null
    if (photo) ctx.drawImage(photo, x + size * 0.04, y + size * 0.04, size * 0.92, size * 0.92)
    else {
      ctx.fillStyle = INK
      ctx.font = `600 ${fontPx}px "PingFang SC",sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText((this.data.name || '波').slice(0, 1), x + size / 2, y + size / 2)
    }
    ctx.restore()
    blit(ctx, '/ui/ref/avatar-ring.png', x, y, size, size)
  }

  private thumb(ctx: CanvasRenderingContext2D, src: string, x: number, y: number, size: number): void {
    const photo = imageOf(src, () => { this.imageRev += 1 })
    ctx.save()
    round(ctx, x, y, size, size, 28)
    ctx.clip()
    if (photo) ctx.drawImage(photo, x, y, size, size)
    else {
      ctx.fillStyle = '#F6F6F6'
      ctx.fillRect(x, y, size, size)
    }
    ctx.restore()
  }

  private focus(id: FieldId, numeric = false, multiline = false): void {
    this.field = id
    if (typeof document === 'undefined' || !document.getElementById('ui')) {
      this.focusNative(id, numeric, multiline)
      return
    }
    const el = this.ensureField(id, multiline)
    this.bindField(el, id, numeric)
    const box = this.boxes.find((item) => item.id === id)
    if (box) this.dress(el, box)
    el.style.display = 'block'
    el.classList.add('on')
    focusField(el)
  }

  private focusNative(id: FieldId, numeric: boolean, multiline: boolean): void {
    const wx = (globalThis as unknown as { wx?: KeyboardApi; tt?: KeyboardApi }).wx
      || (globalThis as unknown as { tt?: KeyboardApi }).tt
    if (wx?.showKeyboard) {
      wx.showKeyboard({ defaultValue: this.values[id], maxLength: maxOf(id), multiple: multiline, confirmType: 'done' })
      wx.onKeyboardInput?.((res) => this.applyField(id, res.value || '', numeric))
      wx.onKeyboardConfirm?.((res) => {
        this.applyField(id, res.value || '', numeric)
        this.blur()
      })
      return
    }
    if (typeof prompt !== 'function') return
    const next = prompt('', this.values[id])
    if (next != null) this.applyField(id, next, numeric)
    this.field = ''
  }

  private applyField(id: FieldId, raw: string, numeric: boolean): void {
    let value = numeric ? raw.replace(/\D/g, '') : raw
    const max = maxOf(id)
    if ([...value].length > max) value = [...value].slice(0, max).join('')
    this.values[id] = value
    if (id === 'code' && value.length === 4 && this.view === 'phone') this.submitPhone()
    if (id === 'code' && value.length === 4 && this.view === 'login-phone') this.submitMobile()
    if (id === 'code' && value.length === 4 && this.view === 'login-bind') this.submitBind()
  }

  private blur(): void {
    this.field = ''
    if (typeof document !== 'undefined') {
      document.querySelectorAll<HTMLElement>('.boluo-field').forEach((el) => {
        el.classList.remove('on')
        if (document.activeElement === el) el.blur()
      })
    }
    const api = (globalThis as unknown as { wx?: KeyboardApi }).wx
    api?.hideKeyboard?.({})
  }

  private domReady(): boolean {
    return typeof document !== 'undefined' && !!document.getElementById('ui')
  }

  private placeField(host: Host): void {
    const hideAll = host.modal || (this.overlay !== '' && this.overlay !== 'nick')
    const shown = new Map<FieldId, Box>()
    if (!hideAll) {
      for (const box of this.boxes) {
        if (this.overlay === 'nick' && box.id !== 'nick') continue
        shown.set(box.id, box)
      }
    }
    const ids: FieldId[] = ['nick', 'feedback', 'contact', 'phone', 'code', 'pass', 'pass2']
    for (const id of ids) {
      const box = shown.get(id)
      const el = document.getElementById('boluo-field-' + id) as HTMLInputElement | HTMLTextAreaElement | null
      if (!box) {
        if (el) {
          el.classList.remove('on')
          if (document.activeElement === el) el.blur()
          el.style.display = 'none'
        }
        continue
      }
      const field = el ?? this.ensureField(id, box.multiline)
      this.bindField(field, id, box.numeric)
      this.dress(field, box)
      field.style.display = 'block'
      field.classList.toggle('on', document.activeElement === field)
      if (document.activeElement !== field && field.value !== this.values[id]) field.value = this.values[id]
    }
    document.getElementById('boluo-field')?.remove()
  }

  private pin(el: HTMLElement, x: number, y: number, w: number, h: number): void {
    const ui = document.getElementById('ui')
    if (!ui) return
    const rect = ui.getBoundingClientRect()
    const sx = rect.width / Math.max(1, this.frame.pw)
    const sy = rect.height / Math.max(1, this.frame.ph)
    el.style.left = `${rect.left + (this.frame.ox + x) * sx}px`
    el.style.top = `${rect.top + (this.frame.oy + y) * sy}px`
    el.style.width = `${w * sx}px`
    el.style.height = `${h * sy}px`
  }

  private dress(el: HTMLElement, box: Box): void {
    const ui = document.getElementById('ui')
    if (!ui) return
    const rect = ui.getBoundingClientRect()
    const sx = rect.width / Math.max(1, this.frame.pw)
    const sy = rect.height / Math.max(1, this.frame.ph)
    this.pin(el, box.x, box.y, box.w, box.h)
    // iOS zooms and throws the caret when a focused field is under 16px,
    // and with user-scalable=no that zoom is what swallows the keyboard.
    const cssFont = Math.max(16, box.font * sy)
    el.style.fontSize = `${cssFont}px`
    el.style.fontWeight = String(box.weight)
    if (box.multiline) {
      el.style.padding = `${28 * sy}px ${28 * sx}px`
      el.style.lineHeight = `${58 * sy}px`
    } else {
      el.style.padding = `0 0 0 ${box.pad * sx}px`
      el.style.lineHeight = `${box.h * sy}px`
    }
    if (!(el instanceof HTMLInputElement)) return
    const hidden = (box.id === 'pass' || box.id === 'pass2') && this.secret[box.id] !== false
    const next = hidden ? 'password' : (box.numeric ? 'tel' : 'text')
    if (document.activeElement !== el && el.type !== next) el.type = next
  }

  private bindField(el: HTMLInputElement | HTMLTextAreaElement, id: FieldId, numeric: boolean): void {
    el.maxLength = maxOf(id)
    el.placeholder = ''
    const box = this.boxes.find((item) => item.id === id)
    if (box) el.placeholder = box.placeholder
    if (el instanceof HTMLInputElement) el.inputMode = numeric ? 'numeric' : 'text'
    el.oninput = () => {
      this.applyField(id, el.value, numeric)
      if (el.value !== this.values[id]) {
        const pos = el.selectionStart
        el.value = this.values[id]
        if (pos != null) {
          const n = Math.min(pos, el.value.length)
          try { el.setSelectionRange(n, n) } catch { /* password fields reject a range */ }
        }
      }
    }
  }

  private ensureField(id: FieldId, multiline: boolean): HTMLInputElement | HTMLTextAreaElement {
    ensureFieldCss()
    const domId = 'boluo-field-' + id
    const current = document.getElementById(domId)
    if (current && ((multiline && current instanceof HTMLTextAreaElement) || (!multiline && current instanceof HTMLInputElement))) {
      return current as HTMLInputElement | HTMLTextAreaElement
    }
    current?.remove()
    const el = document.createElement(multiline ? 'textarea' : 'input')
    el.id = domId
    el.className = 'boluo-field'
    el.setAttribute('autocomplete', 'off')
    el.setAttribute('autocorrect', 'off')
    el.setAttribute('autocapitalize', 'off')
    el.setAttribute('spellcheck', 'false')
    el.setAttribute('enterkeyhint', 'done')
    if (el instanceof HTMLTextAreaElement) el.style.resize = 'none'
    el.addEventListener('touchstart', () => {
      if (document.activeElement !== el) focusField(el)
      else holdPage()
    }, { passive: true })
    el.addEventListener('focus', () => {
      this.field = id
      el.classList.add('on')
      holdPage()
    })
    el.addEventListener('blur', () => {
      el.classList.remove('on')
      if (this.field === id) this.field = ''
    })
    document.body.appendChild(el)
    return el
  }
}

interface KeyboardApi {
  showKeyboard(opts: { defaultValue?: string; maxLength?: number; multiple?: boolean; confirmType?: string }): void
  hideKeyboard?(opts: Record<string, never>): void
  onKeyboardInput?(cb: (res: { value?: string }) => void): void
  onKeyboardConfirm?(cb: (res: { value?: string }) => void): void
}

function maxOf(id: FieldId): number {
  if (id === 'nick') return 16
  if (id === 'feedback') return 200
  if (id === 'contact' || id === 'phone') return 11
  if (id === 'code') return 4
  return 20
}

function focusField(el: HTMLElement): void {
  const input = el as HTMLInputElement
  try { input.focus({ preventScroll: true }) } catch { input.focus() }
  holdPage()
}

function holdPage(): void {
  if (window.scrollX || window.scrollY) window.scrollTo(0, 0)
}

function ensureFieldCss(): void {
  if (document.getElementById('boluo-field-css')) return
  const style = document.createElement('style')
  style.id = 'boluo-field-css'
  style.textContent = [
    '.boluo-field{position:fixed;z-index:8;margin:0;border:none;outline:none;background:transparent;',
    'box-sizing:border-box;border-radius:0;-webkit-appearance:none;appearance:none;',
    'color:transparent;-webkit-text-fill-color:transparent;caret-color:transparent;',
    'font-family:"PingFang SC","Hiragino Sans GB",sans-serif;touch-action:manipulation;text-align:left}',
    '.boluo-field.on{color:#19191A;-webkit-text-fill-color:#19191A;caret-color:#19191A}',
    '.boluo-field::placeholder{color:transparent}',
    '.boluo-field.on::placeholder{color:#C4C4C7}',
  ].join('')
  document.head.appendChild(style)
  window.addEventListener('scroll', () => {
    const active = document.activeElement
    if (active instanceof HTMLElement && active.classList.contains('boluo-field')) holdPage()
  }, { passive: true })
}

function shrinkImage(src: string, done: (url: string) => void): void {
  const img = new Image()
  img.onload = () => {
    const size = 256
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const g = canvas.getContext('2d')
    if (!g) {
      done(src)
      return
    }
    const side = Math.min(img.width, img.height)
    g.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size)
    done(canvas.toDataURL('image/jpeg', 0.82))
  }
  img.onerror = () => done(src)
  img.src = src
}

function spacedPhone(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 11)
  if (digits.length <= 3) return digits
  if (digits.length <= 7) return `${digits.slice(0, 3)} ${digits.slice(3)}`
  return `${digits.slice(0, 3)} ${digits.slice(3, 7)} ${digits.slice(7)}`
}

function font(px: number): string {
  return `500 ${px}px "PingFang SC","PingFangSC-Medium","Hiragino Sans GB",sans-serif`
}

function fontRegular(px: number): string {
  return `400 ${px}px "PingFang SC","PingFangSC-Regular","Hiragino Sans GB",sans-serif`
}

function fontBold(px: number): string {
  return `600 ${px}px "PingFang SC","PingFangSC-Semibold","Hiragino Sans GB",sans-serif`
}

function drawPhoneIcon(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(size / 20, size / 20)
  ctx.fillStyle = color
  ctx.fill(new Path2D('M11.7 1.342C13.38 1.342 14.221 1.342 14.863 1.669C15.427 1.956 15.885 2.415 16.173 2.979C16.5 3.621 16.5 4.461 16.5 6.141V13.859C16.5 15.539 16.5 16.379 16.173 17.02C15.885 17.585 15.427 18.044 14.863 18.332C14.221 18.659 13.381 18.659 11.7 18.659H8.301C6.621 18.659 5.781 18.659 5.139 18.332C4.574 18.044 4.115 17.585 3.827 17.02C3.501 16.379 3.501 15.538 3.501 13.859V6.141C3.501 4.461 3.5 3.621 3.827 2.979C4.115 2.415 4.575 1.956 5.139 1.669C5.781 1.342 6.621 1.342 8.301 1.342H11.7ZM9.578 16.232C9.291 16.232 9.059 16.465 9.059 16.752C9.059 17.038 9.292 17.271 9.578 17.271H10.42C10.707 17.271 10.939 17.038 10.94 16.752C10.94 16.465 10.707 16.232 10.42 16.232H9.578ZM7.884 2.891C6.764 2.891 6.203 2.891 5.776 3.109C5.399 3.301 5.093 3.607 4.902 3.983C4.684 4.411 4.684 4.972 4.684 6.092V11.442C4.684 12.562 4.684 13.123 4.902 13.55C5.093 13.927 5.399 14.233 5.776 14.425C6.203 14.642 6.764 14.642 7.884 14.642H12.12C13.24 14.642 13.8 14.642 14.228 14.425C14.604 14.233 14.91 13.927 15.102 13.55C15.32 13.123 15.32 12.562 15.32 11.442V6.092C15.32 4.972 15.32 4.411 15.102 3.983C14.91 3.607 14.604 3.301 14.228 3.109C13.8 2.891 13.24 2.891 12.12 2.891H7.884Z'), 'evenodd')
  ctx.restore()
}

function drawWechatIcon(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(size / 20, size / 20)
  ctx.fillStyle = '#07C160'
  ctx.fill(new Path2D('M8.775 12.492C8.775 14.935 11.184 16.917 14.14 16.917C14.858 16.917 15.559 16.798 16.174 16.593C16.344 16.678 17.575 17.738 17.848 17.55C18.036 17.396 17.404 16.251 17.353 16.046C18.651 15.243 19.506 13.944 19.506 12.492C19.506 10.049 17.096 8.067 14.14 8.067C11.184 8.067 8.775 10.049 8.775 12.492ZM15.268 10.937C15.268 10.51 15.61 10.168 16.037 10.168C16.464 10.168 16.806 10.51 16.806 10.937C16.806 11.364 16.464 11.706 16.037 11.706C15.61 11.706 15.268 11.364 15.268 10.937ZM11.492 10.937C11.492 10.51 11.834 10.168 12.261 10.168C12.688 10.168 13.03 10.51 13.03 10.937C13.03 11.364 12.688 11.706 12.261 11.706C11.834 11.706 11.492 11.364 11.492 10.937Z'))
  ctx.fill(new Path2D('M8.293 12.458C8.293 9.793 10.924 7.64 14.154 7.64C14.325 7.64 14.495 7.64 14.649 7.657C14.29 4.718 11.266 2.429 7.592 2.429C3.68 2.429 0.501 5.043 0.501 8.272C0.501 10.186 1.629 11.895 3.355 12.954C3.287 13.21 2.466 14.731 2.706 14.936C3.064 15.175 4.688 13.774 4.91 13.672C5.73 13.945 6.636 14.099 7.592 14.099C7.934 14.099 8.276 14.082 8.618 14.031C8.413 13.552 8.293 13.022 8.293 12.458ZM10.07 5.163C10.634 5.163 11.095 5.624 11.095 6.188C11.112 6.752 10.651 7.213 10.07 7.213C9.506 7.213 9.045 6.752 9.045 6.188C9.045 5.624 9.506 5.163 10.07 5.163ZM5.098 7.213C4.534 7.213 4.073 6.752 4.073 6.188C4.073 5.624 4.534 5.163 5.098 5.163C5.662 5.163 6.123 5.624 6.123 6.188C6.123 6.752 5.662 7.213 5.098 7.213Z'))
  ctx.restore()
}

function drawGuestIcon(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.fillStyle = INK
  ctx.beginPath()
  ctx.arc(size / 2, size * 0.36, size * 0.18, 0, Math.PI * 2)
  ctx.fill()
  round(ctx, size * 0.22, size * 0.6, size * 0.56, size * 0.32, size * 0.16)
  ctx.fill()
  ctx.restore()
}

function round(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lineH: number): void {
  let line = ''
  let yy = y
  for (const ch of text) {
    const next = line + ch
    if (line && ctx.measureText(next).width > maxW) {
      ctx.fillText(line, x, yy)
      line = ch
      yy += lineH
    } else line = next
  }
  if (line) ctx.fillText(line, x, yy)
}

function linesOf(ctx: CanvasRenderingContext2D, text: string, maxW: number, size: number): string[] {
  ctx.font = font(size)
  const lines: string[] = []
  let line = ''
  for (const ch of text) {
    const next = line + ch
    if (line && ctx.measureText(next).width > maxW) {
      lines.push(line)
      line = ch
    } else line = next
  }
  if (line) lines.push(line)
  return lines
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text
  let value = text
  while (value && ctx.measureText(`${value}…`).width > maxW) value = value.slice(0, -1)
  return `${value}…`
}

function textWidth(text: string, size: number): number {
  if (typeof document === 'undefined') return text.length * size
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) return text.length * size
  ctx.font = font(size)
  return ctx.measureText(text).width
}

const sprites = new Map<string, HTMLImageElement>()
function sprite(src: string): HTMLImageElement | null {
  if (typeof Image === 'undefined') return null
  let image = sprites.get(src)
  if (!image) {
    image = new Image()
    image.src = src
    sprites.set(src, image)
  }
  return image.complete && image.naturalWidth > 0 ? image : null
}

function blit(ctx: CanvasRenderingContext2D, src: string, x: number, y: number, w: number, h: number): void {
  const image = sprite(src)
  if (image) ctx.drawImage(image, x, y, w, h)
}

const photos = new Map<string, HTMLImageElement>()
function imageOf(src: string, onLoad: () => void): HTMLImageElement | null {
  let image = photos.get(src)
  if (!image) {
    image = new Image()
    image.onload = onLoad
    image.src = src
    photos.set(src, image)
  }
  return image.complete && image.naturalWidth > 0 ? image : null
}
