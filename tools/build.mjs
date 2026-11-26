import { build } from 'esbuild'
import { mkdirSync, copyFileSync, cpSync, writeFileSync, statSync, rmSync, existsSync, readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')

function loadEnvFile(file) {
  if (!existsSync(file)) return
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = value
  }
}

loadEnvFile(join(root, '.env'))

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
// The public product build only plays local music and effects. It does not
// embed a signing key or forward login.
const signKey = envName === 'product'
  ? ''
  : (process.env.BOLUO_SIGN_KEY || process.env.BOLUO_SIGN_KEY_DEV || '')
if (!signKey && envName !== 'product') {
  console.error('Missing sign key. Set BOLUO_SIGN_KEY or BOLUO_SIGN_KEY_DEV in the environment or .env')
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
  define: {
    BOLUO_ENV: JSON.stringify(envName),
    BOLUO_SIGN_KEY: JSON.stringify(signKey),
  },
})
writeFileSync(join(dist, 'boluo-env.json'), JSON.stringify({ env: envName, api: envApi[envName] }))

copyFileSync(join(root, 'public/index.html'), join(dist, 'index.html'))
cpSync(join(root, 'public/ui'), join(dist, 'ui'), { recursive: true })
const bootSrc = join(root, 'public/boot')
if (existsSync(bootSrc)) cpSync(bootSrc, join(dist, 'boot'), { recursive: true })
mkdirSync(join(dist, 'oil'), { recursive: true })
cpSync(join(root, 'public/oil'), join(dist, 'oil'), { recursive: true })
// Mesh bin is only for tooling; runtime embeds boluo1 in game.js.
try { rmSync(join(dist, 'oil', 'boluo1.mesh.bin')) } catch { /* optional */ }
mkdirSync(join(dist, 'chunks'), { recursive: true })
copyFileSync(join(root, 'public/chunks/far.json'), join(dist, 'chunks/far.json'))
const audioDir = join(root, 'public/audio')
if (existsSync(audioDir)) cpSync(audioDir, join(dist, 'audio'), { recursive: true })
const actorDir = join(root, 'public/actor')
if (existsSync(actorDir)) cpSync(actorDir, join(dist, 'actor'), { recursive: true })

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
  if (existsSync(join(dist, 'actor'))) cpSync(join(dist, 'actor'), join(dir, 'actor'), { recursive: true })
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
