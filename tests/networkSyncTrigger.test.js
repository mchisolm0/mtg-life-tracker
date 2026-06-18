import { describe, expect, test } from 'bun:test';
import {
  isNetworkReachableForSync,
  shouldRequestSyncForNetworkState,
} from '../src/sync/networkSyncTrigger.ts';

describe('network sync trigger', () => {
  test('treats connected networks as syncable when reachability is true or unknown', () => {
    expect(isNetworkReachableForSync({ isConnected: true, isInternetReachable: true })).toBe(true);
    expect(isNetworkReachableForSync({ isConnected: true })).toBe(true);
  });

  test('does not sync when disconnected or explicitly not internet-reachable', () => {
    expect(isNetworkReachableForSync({ isConnected: false, isInternetReachable: false })).toBe(false);
    expect(isNetworkReachableForSync({ isConnected: true, isInternetReachable: false })).toBe(false);
    expect(isNetworkReachableForSync({})).toBe(false);
  });

  test('requests sync only when connectivity transitions to reachable', () => {
    expect(
      shouldRequestSyncForNetworkState({ isConnected: true, isInternetReachable: true }, false),
    ).toBe(true);
    expect(
      shouldRequestSyncForNetworkState({ isConnected: true, isInternetReachable: true }, true),
    ).toBe(false);
    expect(
      shouldRequestSyncForNetworkState({ isConnected: true, isInternetReachable: false }, false),
    ).toBe(false);
  });
});
