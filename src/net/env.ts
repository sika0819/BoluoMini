declare const BOLUO_ENV: string

export type BoluoEnvName = 'dev' | 'test' | 'product'

const NAME: BoluoEnvName = BOLUO_ENV === 'test' || BOLUO_ENV === 'product' ? BOLUO_ENV : 'dev'

const TABLE: Record<BoluoEnvName, { api: string; h5: string; signKey: string }> = {
  dev: {
    api: 'https://wanos-common-dev.wanos.vip',
    h5: 'https://boluoh5-dev.wanos.vip',
    signKey: 'REDACTED',
  },
  test: {
    api: 'https://wanos-common-test3.wanos.vip',
    h5: 'https://boluoh5-test.wanos.vip',
    signKey: 'REDACTED',
  },
  product: {
    api: 'https://wanos-common.wavworks.com',
    h5: 'https://boluoh5.boluoapp.com',
    signKey: 'REDACTED',
  },
}

export const boluoEnvName = NAME
export const boluoEnv = TABLE[NAME]
export const h5Origin = boluoEnv.h5
