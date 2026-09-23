import * as Network from 'expo-network'
import { type Handler } from '../host'

export const netState: Handler<'net.state'> = async () => {
  const state = await Network.getNetworkStateAsync()
  // Treat "unknown" (undefined) as online; only an explicit false means offline.
  return { online: state.isInternetReachable !== false }
}
