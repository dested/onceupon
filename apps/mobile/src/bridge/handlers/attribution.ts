import { attributionToken as nativeAttributionToken } from '../../../modules/apple-attribution'
import { type Handler } from '../host'

export const attributionToken: Handler<'attribution.token'> = async () => ({
  token: await nativeAttributionToken(),
})
