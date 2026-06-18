import {
  flushMatchOutbox,
  type FlushMatchOutboxResult,
  type MatchOutboxStore,
  type MatchSyncApi as MatchOutboxApi,
} from './matchOutboxSync';
import {
  ensureRemoteMatchLink,
  type EnsureRemoteMatchLinkResult,
  type RemoteMatchLinkApi,
  type RemoteMatchLinkStore,
} from './remoteMatchLink';

export type MatchSyncCoordinatorApi = MatchOutboxApi & RemoteMatchLinkApi;

export type MatchSyncCoordinatorStore = MatchOutboxStore & RemoteMatchLinkStore;

export type SyncLocalMatchResult = {
  link: EnsureRemoteMatchLinkResult;
  outbox: FlushMatchOutboxResult;
};

export async function syncLocalMatch({
  api,
  limit,
  now,
  random,
  store,
}: {
  api: MatchSyncCoordinatorApi;
  limit?: number;
  now?: () => number;
  random?: () => number;
  store: MatchSyncCoordinatorStore;
}): Promise<SyncLocalMatchResult> {
  const link = await ensureRemoteMatchLink({ api, store });
  const outbox = await flushMatchOutbox({
    api,
    limit,
    now,
    random,
    store,
  });

  return {
    link,
    outbox,
  };
}
