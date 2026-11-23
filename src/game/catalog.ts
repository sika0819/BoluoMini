import type { SceneKind } from '../scene/island'

export interface BankItem {
  name: string
  label: string
  bytes: number
  group: 'music' | 'zone' | 'weather' | 'preset'
  /** Bundled clip. Present files are ready without a server. */
  src?: string
}

/** Clips unpacked from CustomSRP Wanos banks. Paths are package-local. */
export const CLIPS = {
  Music1_1: '/audio/Music1_1.mp3',
  Ocean_Calm_Quad: '/audio/Ocean_Calm_Quad.mp3',
  Rain_Light: '/audio/Rain_Light.mp3',
  Rain_Medium: '/audio/Rain_Medium.mp3',
  Rain_Heavy: '/audio/Rain_Heavy.mp3',
  Rain_Water: '/audio/Rain_Water.mp3',
  Wind_Light: '/audio/Wind_Light.mp3',
  Wind_Medium: '/audio/Wind_Medium.mp3',
  Wind_Heavy: '/audio/Wind_Heavy.mp3',
} as const

export function weatherClip(kind: 'rain' | 'wind', level: number): string {
  const tier = level >= 3 ? 'Heavy' : level >= 2 ? 'Medium' : 'Light'
  const key = `${kind === 'rain' ? 'Rain' : 'Wind'}_${tier}` as keyof typeof CLIPS
  return CLIPS[key]
}

export const BANKS: BankItem[] = [
  { name: 'Music1_1', label: '寂静回波', bytes: 1605165, group: 'music', src: CLIPS.Music1_1 },
  { name: 'Music1_2', label: '深空呢喃', bytes: 1392045, group: 'music', src: '/audio/Music1_2.mp3' },
  { name: 'Music1_3', label: '星河漫行', bytes: 1487661, group: 'music', src: '/audio/Music1_3.mp3' },
  { name: 'Music1_4', label: '虚空之寂', bytes: 1769133, group: 'music', src: '/audio/Music1_4.mp3' },
  { name: 'Music1_5', label: '烟波载月', bytes: 1519149, group: 'music', src: '/audio/Music1_5.mp3' },
  { name: 'Music1_6', label: '月光之岸', bytes: 2456493, group: 'music', src: '/audio/Music1_6.mp3' },
  { name: 'Music1_7', label: '云间回响', bytes: 1217709, group: 'music', src: '/audio/Music1_7.mp3' },
  { name: 'Music2_1', label: '橙色傍晚很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长', bytes: 1523757, group: 'music', src: '/audio/Music2_1.mp3' },
  { name: 'Music2_2', label: '浮生慢行', bytes: 2421549, group: 'music', src: '/audio/Music2_2.mp3' },
  { name: 'Music2_3', label: '轻轻走过的小路', bytes: 1481133, group: 'music', src: '/audio/Music2_3.mp3' },
  { name: 'Music2_4', label: '森林的轻吟', bytes: 1705773, group: 'music', src: '/audio/Music2_4.mp3' },
  { name: 'Music2_5', label: '森林鸟语', bytes: 1526061, group: 'music', src: '/audio/Music2_5.mp3' },
  { name: 'Music2_6', label: '柔缓流动', bytes: 1548717, group: 'music', src: '/audio/Music2_6.mp3' },
  { name: 'Music2_7', label: '慵懒的阳光', bytes: 1366701, group: 'music', src: '/audio/Music2_7.mp3' },
  { name: 'Music3_1', label: '浮光掠影', bytes: 2001453, group: 'music', src: '/audio/Music3_1.mp3' },
  { name: 'Music3_2', label: '红尘寄月', bytes: 2108589, group: 'music', src: '/audio/Music3_2.mp3' },
  { name: 'Music3_3', label: '静谧时光', bytes: 2789037, group: 'music', src: '/audio/Music3_3.mp3' },
  { name: 'Music3_4', label: '慢水流年', bytes: 1549101, group: 'music', src: '/audio/Music3_4.mp3' },
  { name: 'Music3_5', label: '听风入梦', bytes: 1519917, group: 'music', src: '/audio/Music3_5.mp3' },
  { name: 'Music3_6', label: '夏夜漫游', bytes: 1694253, group: 'music', src: '/audio/Music3_6.mp3' },
  { name: 'Music3_7', label: '星空', bytes: 1272237, group: 'music', src: '/audio/Music3_7.mp3' },
  { name: 'Music3_8', label: '一念之间', bytes: 2612397, group: 'music', src: '/audio/Music3_8.mp3' },
  { name: 'Music3_9', label: '云上小憩', bytes: 1303341, group: 'music', src: '/audio/Music3_9.mp3' },
  { name: 'Music3_10', label: '闲庭信步', bytes: 2729133, group: 'music', src: '/audio/Music3_10.mp3' },
  { name: 'Music4_1', label: '灯火渐息', bytes: 2817453, group: 'music', src: '/audio/Music4_1.mp3' },
  { name: 'Music4_2', label: '微光洛影', bytes: 1933101, group: 'music', src: '/audio/Music4_2.mp3' },
  { name: 'Music4_3', label: '孤舟寒江', bytes: 1531053, group: 'music', src: '/audio/Music4_3.mp3' },
  { name: 'Music4_4', label: '灰蓝清晨', bytes: 1314477, group: 'music', src: '/audio/Music4_4.mp3' },
  { name: 'Music4_5', label: '落尘之夜', bytes: 2801709, group: 'music', src: '/audio/Music4_5.mp3' },
  { name: 'Music4_6', label: '无人回应的信', bytes: 1416237, group: 'music', src: '/audio/Music4_6.mp3' },
  { name: 'Music4_7', label: '月下独白', bytes: 1891629, group: 'music', src: '/audio/Music4_7.mp3' },
  { name: 'Music5_1', label: '风起云涌', bytes: 1509549, group: 'music', src: '/audio/Music5_1.mp3' },
  { name: 'Music5_2', label: '锦色年华', bytes: 1821357, group: 'music', src: '/audio/Music5_2.mp3' },
  { name: 'Music5_3', label: '洛水之畔', bytes: 1855917, group: 'music', src: '/audio/Music5_3.mp3' },
  { name: 'Music5_4', label: '千里暮归', bytes: 2812845, group: 'music', src: '/audio/Music5_4.mp3' },
  { name: 'Music5_5', label: '青石之间', bytes: 1921197, group: 'music', src: '/audio/Music5_5.mp3' },
  { name: 'Music5_6', label: '笙歌旧梦', bytes: 1424301, group: 'music', src: '/audio/Music5_6.mp3' },
  { name: 'Music5_7', label: '水墨天涯', bytes: 2120109, group: 'music', src: '/audio/Music5_7.mp3' },
  { name: 'Music5_8', label: '微风拂面', bytes: 1766829, group: 'music', src: '/audio/Music5_8.mp3' },
  { name: 'Music6_1', label: '春日序曲', bytes: 859437, group: 'music', src: '/audio/Music6_1.mp3' },
  { name: 'Music6_2', label: '海面上的光', bytes: 1150509, group: 'music', src: '/audio/Music6_2.mp3' },
  { name: 'Music6_3', label: '极光雪憩', bytes: 1049901, group: 'music', src: '/audio/Music6_3.mp3' },
  { name: 'Music6_4', label: '蓝色沙漠', bytes: 1016109, group: 'music', src: '/audio/Music6_4.mp3' },
  { name: 'Music6_5', label: '林息仙迹', bytes: 1018413, group: 'music', src: '/audio/Music6_5.mp3' },
  { name: 'Music6_6', label: '无际之海', bytes: 998829, group: 'music', src: '/audio/Music6_6.mp3' },
  { name: 'Music6_7', label: '真空圣境', bytes: 0, group: 'music' },
  { name: 'Ocean_Calm_Quad', label: '平静海面', bytes: 1446381, group: 'zone', src: CLIPS.Ocean_Calm_Quad },
  { name: 'River_Quad', label: '河流', bytes: 1449549, group: 'zone', src: '/audio/River_Quad.mp3' },
  { name: 'River_ADD', label: '溪流', bytes: 1445805, group: 'zone', src: '/audio/River_ADD.mp3' },
  { name: 'Waterfall_Big_Quad', label: '大瀑布', bytes: 1445805, group: 'zone', src: '/audio/Waterfall_Big_Quad.mp3' },
  { name: 'Waterfall_Small_Quad', label: '小瀑布', bytes: 1444077, group: 'zone', src: '/audio/Waterfall_Small_Quad.mp3' },
  { name: 'Lake_Quad', label: '湖面', bytes: 1449549, group: 'zone', src: '/audio/Lake_Quad.mp3' },
  { name: 'Ocean_Ebb_tide_LR', label: '退潮', bytes: 1446381, group: 'zone', src: '/audio/Ocean_Ebb_tide_LR.mp3' },
  { name: 'Ocean_Rising_tide_LR', label: '涨潮', bytes: 1446381, group: 'zone', src: '/audio/Ocean_Rising_tide_LR.mp3' },
  { name: 'Campfire', label: '篝火', bytes: 576621, group: 'zone', src: '/audio/Campfire.mp3' },
  { name: 'Rain', label: '雨', bytes: 1451565, group: 'weather', src: CLIPS.Rain_Medium },
  { name: 'Rain_Water', label: '雨打水面', bytes: 1445229, group: 'weather', src: CLIPS.Rain_Water },
  { name: 'Wind', label: '风', bytes: 1443213, group: 'weather', src: CLIPS.Wind_Medium },
  { name: 'Preset_01', label: '清晨起床', bytes: 0, group: 'preset' },
  { name: 'Preset_02', label: '独自旅行', bytes: 0, group: 'preset' },
  { name: 'Preset_03', label: '午后放松', bytes: 0, group: 'preset' },
  { name: 'Preset_04', label: '委屈泛滥', bytes: 0, group: 'preset' },
  { name: 'Preset_05', label: '专注工作', bytes: 0, group: 'preset' },
  { name: 'Preset_06', label: '放空发呆', bytes: 0, group: 'preset' },
  { name: 'Preset_07', label: '灵感唤醒', bytes: 0, group: 'preset' },
  { name: 'Preset_08', label: '假日躺平', bytes: 0, group: 'preset' },
  { name: 'Preset_09', label: '学习冲刺', bytes: 0, group: 'preset' },
  { name: 'Preset_10', label: '准备入睡', bytes: 0, group: 'preset' },
]

export const TRACKS = BANKS.filter((b) => b.group === 'music')

export interface AlbumDef {
  name: string
  banks: string[]
}

/** Album order from StreamingAssets/WanosAudio/MusicLists.json. */
export const ALBUMS: AlbumDef[] = [
  { name: '归息123', banks: ['Music1_1', 'Music1_2', 'Music1_3', 'Music1_4', 'Music1_5', 'Music1_6', 'Music1_7'] },
  { name: '隙光', banks: ['Music2_1', 'Music2_2', 'Music2_3', 'Music2_4', 'Music2_5', 'Music2_6', 'Music2_7'] },
  { name: '枕畔', banks: ['Music3_1', 'Music3_2', 'Music3_3', 'Music3_4', 'Music3_5', 'Music3_6', 'Music3_7', 'Music3_8', 'Music3_9', 'Music3_10'] },
  { name: '共凝', banks: ['Music4_1', 'Music4_2', 'Music4_3', 'Music4_4', 'Music4_5', 'Music4_6', 'Music4_7'] },
  { name: '归云', banks: ['Music5_1', 'Music5_2', 'Music5_3', 'Music5_4', 'Music5_5', 'Music5_6', 'Music5_7', 'Music5_8'] },
  { name: '破茧', banks: ['Music6_1', 'Music6_2', 'Music6_3', 'Music6_4', 'Music6_5', 'Music6_6', 'Music6_7'] },
]

export type WeatherKind = 'clear' | 'cloud' | 'rain' | 'fog' | 'wind'

export interface PresetDef {
  id: string
  label: string
  desc: string
  bank: string
  scene: SceneKind
  sun: number[]
  sunColor: number[]
  fog: number[]
  fogDensity: number
  weather: WeatherKind
  weatherLevel: number
  hours: number
}

/** Ten presets = ten scenes (TargetPos windows on the shared CustomSRP island). */
export const PRESETS: PresetDef[] = [
  {
    id: 'p01', label: '清晨起床', desc: '新的一天从海边苏醒', bank: 'Preset_01', scene: 'p01',
    sun: [0.45, 0.4, 0.25], sunColor: [1, 0.78, 0.52], fog: [0.86, 0.7, 0.55], fogDensity: 0.016,
    weather: 'cloud', weatherLevel: 1, hours: 7.5,
  },
  {
    id: 'p02', label: '独自旅行', desc: '一个人待会儿也挺好', bank: 'Preset_02', scene: 'p02',
    sun: [0.35, 0.55, 0.2], sunColor: [1, 0.9, 0.72], fog: [0.72, 0.8, 0.78], fogDensity: 0.014,
    weather: 'cloud', weatherLevel: 1, hours: 7.5,
  },
  {
    id: 'p03', label: '午后放松', desc: '躺下来让思绪慢慢飘远', bank: 'Preset_03', scene: 'p03',
    sun: [0.2, 0.85, 0.25], sunColor: [1, 0.94, 0.78], fog: [0.78, 0.82, 0.86], fogDensity: 0.02,
    weather: 'fog', weatherLevel: 1, hours: 13,
  },
  {
    id: 'p04', label: '委屈泛滥', desc: '你没说的委屈我都听得见', bank: 'Preset_04', scene: 'p04',
    sun: [-0.25, 0.22, 0.35], sunColor: [0.55, 0.62, 0.9], fog: [0.28, 0.32, 0.45], fogDensity: 0.03,
    weather: 'rain', weatherLevel: 1, hours: 22.5,
  },
  {
    id: 'p05', label: '专注工作', desc: '让自然的节奏帮你聚焦', bank: 'Preset_05', scene: 'p05',
    sun: [0.3, 0.55, 0.35], sunColor: [0.88, 0.94, 1], fog: [0.7, 0.78, 0.86], fogDensity: 0.018,
    weather: 'fog', weatherLevel: 1, hours: 7.5,
  },
  {
    id: 'p06', label: '放空发呆', desc: '什么都不想就这样躺着', bank: 'Preset_06', scene: 'p06',
    sun: [-0.4, 0.18, 0.2], sunColor: [0.45, 0.5, 0.72], fog: [0.22, 0.24, 0.36], fogDensity: 0.034,
    weather: 'rain', weatherLevel: 3, hours: 23,
  },
  {
    id: 'p07', label: '灵感唤醒', desc: '把思绪交给节奏', bank: 'Preset_07', scene: 'p07',
    sun: [0.4, 0.45, 0.3], sunColor: [0.75, 0.95, 1], fog: [0.68, 0.86, 0.9], fogDensity: 0.015,
    weather: 'cloud', weatherLevel: 1, hours: 7.5,
  },
  {
    id: 'p08', label: '假日躺平', desc: '就这样躺着听风的声音', bank: 'Preset_08', scene: 'p08',
    sun: [0.15, 0.95, 0.2], sunColor: [1, 0.97, 0.88], fog: [0.62, 0.74, 0.82], fogDensity: 0.012,
    weather: 'cloud', weatherLevel: 1, hours: 12,
  },
  {
    id: 'p09', label: '学习冲刺', desc: '让脑中杂音慢慢被风吹走', bank: 'Preset_09', scene: 'p09',
    sun: [0.38, 0.5, 0.22], sunColor: [1, 0.88, 0.7], fog: [0.74, 0.8, 0.76], fogDensity: 0.015,
    weather: 'cloud', weatherLevel: 1, hours: 7.5,
  },
  {
    id: 'p10', label: '准备入睡', desc: '闭上眼深山会守护你的梦', bank: 'Preset_10', scene: 'p10',
    sun: [-0.5, 0.2, 0.15], sunColor: [0.7, 0.45, 0.35], fog: [0.32, 0.26, 0.34], fogDensity: 0.028,
    weather: 'cloud', weatherLevel: 1, hours: 20,
  },
]

/** Streamed at boot. Not packed into the mini-game package. */
export const BOOT_VIDEO = {
  portrait: '/boot/loading.mp4',
  landscape: '/boot/loading_landscape.mp4',
}
