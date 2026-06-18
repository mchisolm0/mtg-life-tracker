import type { RejectionReason } from '../storage/localMatchStoreCore';
import { syncLocalMatch, type MatchSyncCoordinatorApi, type MatchSyncCoordinatorStore } from './matchSyncCoordinator';

export type MatchSyncRuntimeStatus = 'localOnly' | 'idle' | 'syncing' | 'synced' | 'queued' | 'error';

export type MatchSyncRuntimeSnapshot = {
  enabled: boolean;
  lastError?: string;
  lastRejection?: MatchSyncRuntimeRejection;
  lastSyncedAt?: number;
  outboxCount: number;
  status: MatchSyncRuntimeStatus;
};

export type MatchSyncRuntimeRejection = {
  clientEventId: string;
  reason: RejectionReason;
};

export type MatchSyncRuntimeResult =
  | {
      reason: 'disabled';
      snapshot: MatchSyncRuntimeSnapshot;
      started: false;
    }
  | {
      snapshot: MatchSyncRuntimeSnapshot;
      started: true;
    };

type MatchSyncRuntimeListener = (snapshot: MatchSyncRuntimeSnapshot) => void;

export type MatchSyncRuntimeOptions = {
  api?: MatchSyncCoordinatorApi;
  createApi?: () => MatchSyncCoordinatorApi;
  limit?: number;
  now?: () => number;
  random?: () => number;
  store: MatchSyncCoordinatorStore;
};

export function createMatchSyncRuntime({
  api,
  createApi,
  limit,
  now = Date.now,
  random,
  store,
}: MatchSyncRuntimeOptions) {
  const enabled = Boolean(api || createApi);
  const listeners = new Set<MatchSyncRuntimeListener>();
  let pendingSync = false;
  let inFlightSync: Promise<MatchSyncRuntimeResult> | undefined;
  let cachedApi = api;
  let snapshot: MatchSyncRuntimeSnapshot = {
    enabled,
    outboxCount: safeOutboxCount(store),
    status: enabled ? 'idle' : 'localOnly',
  };

  function getSnapshot() {
    return snapshot;
  }

  function subscribe(listener: MatchSyncRuntimeListener) {
    listeners.add(listener);
    listener(snapshot);

    return () => {
      listeners.delete(listener);
    };
  }

  async function syncNow(): Promise<MatchSyncRuntimeResult> {
    if (!enabled) {
      setSnapshot({
        enabled,
        outboxCount: safeOutboxCount(store),
        status: 'localOnly',
      });

      return {
        reason: 'disabled',
        snapshot,
        started: false,
      };
    }

    if (inFlightSync) {
      pendingSync = true;
      return inFlightSync;
    }

    inFlightSync = runSync();

    try {
      return await inFlightSync;
    } finally {
      inFlightSync = undefined;

      if (pendingSync) {
        pendingSync = false;
        void syncNow();
      }
    }
  }

  async function runSync(): Promise<MatchSyncRuntimeResult> {
    setSnapshot({
      ...snapshot,
      lastError: undefined,
      lastRejection: undefined,
      outboxCount: safeOutboxCount(store),
      status: 'syncing',
    });

    try {
      const syncApi = cachedApi ?? createApi?.();
      if (!syncApi) {
        throw new Error('Match sync API is not configured.');
      }

      cachedApi = syncApi;
      const syncResult = await syncLocalMatch({
        api: syncApi,
        limit,
        now,
        random,
        store,
      });

      const outboxCount = safeOutboxCount(store);
      setSnapshot({
        enabled,
        lastRejection: syncResult.outbox.rejectedEvents.at(-1),
        lastSyncedAt: now(),
        outboxCount,
        status: outboxCount > 0 ? 'queued' : 'synced',
      });
    } catch (error) {
      setSnapshot({
        ...snapshot,
        lastError: error instanceof Error ? error.message : 'Sync failed.',
        lastRejection: undefined,
        outboxCount: safeOutboxCount(store),
        status: 'error',
      });
    }

    return {
      snapshot,
      started: true,
    };
  }

  function setSnapshot(nextSnapshot: MatchSyncRuntimeSnapshot) {
    snapshot = nextSnapshot;
    for (const listener of listeners) {
      listener(snapshot);
    }
  }

  return {
    getSnapshot,
    subscribe,
    syncNow,
  };
}

function safeOutboxCount(store: MatchSyncCoordinatorStore) {
  try {
    return store.readOutboxIds().length;
  } catch {
    return 0;
  }
}
