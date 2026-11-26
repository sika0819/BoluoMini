declare const BOLUO_ENV: string
declare const BOLUO_SIGN_KEY: string

export type BoluoEnvName = 'dev' | 'test' | 'product'

const NAME: BoluoEnvName = BOLUO_ENV === 'test' || BOLUO_ENV === 'product' ? BOLUO_ENV : 'dev'

const TABLE: Record<BoluoEnvName, { api: string; boluo: string; h5: string; signKey: string; corsProxy: string }> = {
  dev: {
    api: 'https://wanos-common-dev.wanos.vip',
    boluo: 'https://boluo-dev.wanos.vip',
    h5: 'https://boluoh5-dev.wanos.vip',
    signKey: BOLUO_SIGN_KEY,
    corsProxy: '',
  },
  test: {
    api: 'https://wanos-common-test3.wanos.vip',
    boluo: 'https://boluo-test.wanos.vip',
    h5: 'https://boluoh5-test.wanos.vip',
    signKey: BOLUO_SIGN_KEY,
    corsProxy: '',
  },
  product: {
    api: 'https://wanos-common.wavworks.com',
    boluo: 'https://boluo.boluoapp.com',
    h5: 'https://boluoh5.boluoapp.com',
    signKey: BOLUO_SIGN_KEY,
    corsProxy: '',
  },
}

export const boluoEnvName = NAME
export const boluoEnv = TABLE[NAME]
export const h5Origin = boluoEnv.h5
