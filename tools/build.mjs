import { build } from 'esbuild'
import { mkdirSync, copyFileSync, cpSync, writeFileSync, statSync, rmSync, symlinkSync, existsSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
const envName = (process.argv.find((arg) => arg.startsWith('--env=')) || '--env=dev').slice('--env='.length)
const envApi = {
  dev: 'https://wanos-common-dev.wanos.vip',
  test: 'https://wanos-common-test3.wanos.vip',
  product: 'https://wanos-common.wavworks.com',
}
if (!envApi[envName]) {
  console.error('BOLUO_ENV must be dev, test, or product')
  process.exit(1)
}
rmSync(dist, { recursive: true, force: true })
mkdirSync(dist, { recursive: true })

await build({
  entryPoints: [join(root, 'src/main.ts')],
  outfile: join(dist, 'game.js'),
  bundle: true,
  format: 'iife',
  target: 'es2018',
  legalComments: 'none',
  minify: true,
  define: { BOLUO_ENV: JSON.stringify(envName) },
})
writeFileSync(join(dist, 'boluo-env.json'), JSON.stringify({ env: envName, api: envApi[envName] }))

copyFileSync(join(root, 'public/index.html'), join(dist, 'index.html'))
cpSync(join(root, 'public/ui'), join(dist, 'ui'), { recursive: true })
const ref = join(dist, 'ui', 'ref')
const tex = join(root, '..', 'BoluoProjectNew', 'CustomSRP', 'Assets', 'GameMain', 'UI', 'Textures')
const musicRes = join(root, '..', 'BoluoProjectNew', 'CustomSRP', 'Assets', 'GameMain', 'Resources', 'MusicForm')
const sceneRes = join(root, '..', 'BoluoProjectNew', 'AndroidProject', 'feature-scene', 'src', 'main')
const mineRes = join(root, '..', 'BoluoProjectNew', 'AndroidProject', 'feature-mine', 'src', 'main', 'res', 'drawable')
const link = (from, to) => {
  mkdirSync(dirname(to), { recursive: true })
  symlinkSync(from, to)
}
link(join(tex, 'Shared', 'panel-r147.png'), join(ref, 'panel.png'))
link(join(tex, 'Shared', 'dian.png'), join(ref, 'dian.png'))
link(join(tex, 'VolumeRow', 'track-plate.png'), join(ref, 'track.png'))
link(join(tex, 'VolumeRow', 'fill.png'), join(ref, 'fill.png'))
link(join(tex, 'MusicForm', 'music-dialogkapian.png'), join(ref, 'music-card.png'))
link(join(tex, 'MusicForm', 'yy_huadongtiao.png'), join(ref, 'yy_huadongtiao.png'))
for (const name of ['yy_danqu', 'yy_list', 'yy_suiji', 'MusicNotDownload', 'MusicError']) {
  link(join(musicRes, `${name}.png`), join(ref, `${name}.png`))
}
link(join(musicRes, 'Playing'), join(ref, 'playing'))
for (let i = 1; i <= 10; i++) link(join(tex, 'PresetItem', `zhanweitu${i}.png`), join(ref, `zhanweitu${i}.png`))
for (const name of ['bofangzhuangtai', 'statewaitdownload', 'stateerror', 'statedownloadsuccess', 'stateready']) {
  link(join(tex, 'PresetItem', `${name}.png`), join(ref, `${name}.png`))
}
link(join(tex, 'IslandMainForm', 'music-icon.png'), join(ref, 'music-icon.png'))
link(join(tex, 'HudIcon', 'timer-idle.png'), join(ref, 'timer-idle.png'))
link(join(tex, 'HudIcon', 'dial-spin.png'), join(ref, 'dial-spin.png'))
link(join(tex, 'HudIcon', 'top-rule.png'), join(ref, 'top-rule.png'))
link(join(tex, 'HudIcon', 'top-right-decor.png'), join(ref, 'top-right-decor.png'))
link(join(tex, 'HudIcon', 'volume-track.png'), join(ref, 'volume-track.png'))
link(join(tex, 'HudIcon', 'volume-track1.png'), join(ref, 'volume-fill.png'))
link(join(tex, 'HudIcon', 'effectvolumeyuan.png'), join(ref, 'volume-dot.png'))
link(join(tex, 'LoadingForm', 'background.png'), join(ref, 'loading-track.png'))
link(join(tex, 'LoadingForm', 'fill.png'), join(ref, 'loading-fill.png'))
link(join(tex, 'PresetForm', 'scroll-track.png'), join(ref, 'scroll-track.png'))
link(join(tex, 'PresetForm', 'scroll-track-active.png'), join(ref, 'scroll-track-active.png'))
for (const name of ['bgkuang', 'morendian', 'guanbi', 'shezhidingshib', 'shezhidingshiweidianliang']) {
  link(join(sceneRes, 'res', 'drawable', `${name}.png`), join(ref, `${name}.png`))
}
link(join(sceneRes, 'assets', 'timer', 'dingshi_wave_base.svg'), join(ref, 'wave-base.svg'))
link(join(sceneRes, 'assets', 'timer', 'dingshi_wave_active.svg'), join(ref, 'wave-active.svg'))
link(join(sceneRes, 'res', 'font', 'sf_pro_rounded_heavy.ttf'), join(ref, 'sf-pro-rounded-heavy.ttf'))
link(join(mineRes, 'mine_ic_avatar_ring.png'), join(ref, 'avatar-ring.png'))
link(join(mineRes, 'mine_ic_app_logo.png'), join(ref, 'app-logo.png'))
link(join(mineRes, 'mine_ic_guest_heart.png'), join(dist, 'ui', 'mine', 'guest-heart.png'))
const boot = join(dist, 'boot')
mkdirSync(boot, { recursive: true })
const videoDir = join(root, '..', 'BoluoProjectNew', 'CustomSRP', 'Assets', 'GameMain', 'UI', 'Video')
for (const name of ['loading.mp4', 'loading_landscape.mp4']) {
  symlinkSync(join(videoDir, name), join(boot, name))
}
mkdirSync(join(dist, 'oil'), { recursive: true })
cpSync(join(root, 'public/oil'), join(dist, 'oil'), { recursive: true })
// Mesh bin is only for tooling; runtime embeds boluo1 in game.js.
try { rmSync(join(dist, 'oil', 'boluo1.mesh.bin')) } catch { /* optional */ }
mkdirSync(join(dist, 'chunks'), { recursive: true })
copyFileSync(join(root, 'public/chunks/far.json'), join(dist, 'chunks/far.json'))
const audioDir = join(root, 'public/audio')
if (existsSync(audioDir)) cpSync(audioDir, join(dist, 'audio'), { recursive: true })

const gameJson = JSON.stringify({
  deviceOrientation: 'portrait',
  networkTimeout: { request: 10000, connectSocket: 10000, downloadFile: 10000 },
}, null, 2)

function emit(platform, extra) {
  const dir = join(dist, platform)
  mkdirSync(dir, { recursive: true })
  copyFileSync(join(dist, 'game.js'), join(dir, 'game.js'))
  cpSync(join(dist, 'ui'), join(dir, 'ui'), { recursive: true })
  cpSync(join(dist, 'oil'), join(dir, 'oil'), { recursive: true })
  if (existsSync(join(dist, 'audio'))) cpSync(join(dist, 'audio'), join(dir, 'audio'), { recursive: true })
  writeFileSync(join(dir, 'game.json'), gameJson)
  if (extra) writeFileSync(join(dir, 'project.config.json'), JSON.stringify(extra, null, 2))
}

emit('wechat', {
  miniprogramRoot: './',
  projectname: 'boluo-mini',
  appid: 'touristappid',
  compileType: 'game',
  setting: { es6: false, minified: true },
})
emit('douyin', {
  projectname: 'boluo-mini',
  appid: 'test',
  compileType: 'game',
})
emit('bilibili', null)

const bytes = statSync(join(dist, 'game.js')).size
const limit = 2 * 1024 * 1024
console.log(`env ${envName} ${envApi[envName]}`)
console.log(`main package game.js ${bytes} bytes (${(bytes / 1024).toFixed(1)} KB), budget ${limit} bytes`)
if (bytes > limit) {
  console.error('main package exceeds 2MB spawn budget')
  process.exit(1)
}
