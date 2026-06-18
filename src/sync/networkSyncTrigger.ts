import type { NetworkState } from 'expo-network';

type SyncNetworkState = Pick<NetworkState, 'isConnected' | 'isInternetReachable'>;

export function isNetworkReachableForSync(state: SyncNetworkState) {
  return state.isConnected === true && state.isInternetReachable !== false;
}

export function shouldRequestSyncForNetworkState(state: SyncNetworkState, wasReachable: boolean) {
  return isNetworkReachableForSync(state) && !wasReachable;
}
