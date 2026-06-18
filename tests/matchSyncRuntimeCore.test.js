import { describe, expect, test } from 'bun:test';
import { createLocalMatchStore, localMatchStorageKeys } from '../src/storage/localMatchStoreCore.ts';
import { createMatchSyncRuntime } from '../src/sync/matchSyncRuntimeCore.ts';

describe('match sync runtime core', () => {
  test('stays local-only without a configured API', async () => {
    const { match, store } = createMatchStore({ matchId: 'local_1' });
    const nextMatch = store.recordLifeChange(match, 'p1', -1);
    const runtime = createMatchSyncRuntime({ store });
    const snapshots = [];

    runtime.subscribe((snapshot) => snapshots.push(snapshot));

    const result = await runtime.syncNow();

    expect(result).toMatchObject({
      reason: 'disabled',
      started: false,
    });
    expect(runtime.getSnapshot()).toMatchObject({
      enabled: false,
      outboxCount: 1,
      status: 'localOnly',
    });
    expect(store.loadLocalMatch().matchId).toBe('local_1');
    expect(store.readQueuedEvent(nextMatch.eventIds[0]).status).toBe('localOnly');
    expect(snapshots.at(-1)).toMatchObject({
      outboxCount: 1,
      status: 'localOnly',
    });
  });

  test('links local matches, flushes events, and reports synced status', async () => {
    const { match, store } = createMatchStore({ matchId: 'local_1' });
    const optimisticMatch = store.recordLifeChange(match, 'p1', -1);
    const clientEventId = optimisticMatch.eventIds[0];
    const statuses = [];
    const runtime = createMatchSyncRuntime({
      api: {
        createOrResume: async (args) => ({
          match: createCanonicalMatch({
            localMatchId: args.localMatchId,
            matchId: 'match_remote_1',
            p1Life: 40,
            sourceMatch: optimisticMatch,
            version: 0,
          }),
          serverTime: 5000,
        }),
        submitLifeEvent: async ({ event }) => ({
          accepted: true,
          canonicalMatch: createCanonicalMatch({
            localMatchId: 'local_1',
            matchId: 'match_remote_1',
            p1Life: 39,
            sourceMatch: optimisticMatch,
            version: 1,
          }),
          clientEventId: event.clientEventId,
          eventId: 'convex_event_1',
          serverSequence: 1,
        }),
      },
      now: () => 8000,
      store,
    });

    runtime.subscribe((snapshot) => statuses.push(snapshot.status));

    const result = await runtime.syncNow();

    expect(result).toMatchObject({
      started: true,
      snapshot: {
        enabled: true,
        lastSyncedAt: 8000,
        outboxCount: 0,
        status: 'synced',
      },
    });
    expect(statuses).toEqual(['idle', 'syncing', 'synced']);
    expect(store.loadLocalMatch()).toMatchObject({
      lastServerVersion: 1,
      matchId: 'match_remote_1',
    });
    expect(store.loadLocalMatch().players[0].life).toBe(39);
    expect(store.readQueuedEvent(clientEventId)).toMatchObject({
      acknowledgedAt: 8000,
      status: 'acked',
    });
  });

  test('reports errors without dropping queued events', async () => {
    const { match, store } = createMatchStore({ matchId: 'local_1' });
    const nextMatch = store.recordLifeChange(match, 'p1', -1);
    const runtime = createMatchSyncRuntime({
      api: {
        createOrResume: async () => {
          throw new Error('network unavailable');
        },
        submitLifeEvent: async () => {
          throw new Error('should not submit without a remote match');
        },
      },
      store,
    });

    const result = await runtime.syncNow();

    expect(result).toMatchObject({
      started: true,
      snapshot: {
        enabled: true,
        lastError: 'network unavailable',
        outboxCount: 1,
        status: 'error',
      },
    });
    expect(store.readOutboxIds()).toEqual([nextMatch.eventIds[0]]);
    expect(store.readQueuedEvent(nextMatch.eventIds[0]).status).toBe('localOnly');
  });

  test('coalesces overlapping sync requests without duplicate submissions', async () => {
    const { match, store } = createMatchStore({
      localMatchId: 'local_1',
      matchId: 'match_remote_1',
    });
    const optimisticMatch = store.recordLifeChange(match, 'p1', -1);
    let resolveSubmit;
    let submitCalls = 0;
    const submitGate = new Promise((resolve) => {
      resolveSubmit = resolve;
    });
    const runtime = createMatchSyncRuntime({
      api: {
        createOrResume: async () => {
          throw new Error('already linked matches should not be recreated');
        },
        submitLifeEvent: async ({ event }) => {
          submitCalls += 1;
          await submitGate;

          return {
            accepted: true,
            canonicalMatch: createCanonicalMatch({
              localMatchId: 'local_1',
              matchId: 'match_remote_1',
              p1Life: 39,
              sourceMatch: optimisticMatch,
              version: 1,
            }),
            clientEventId: event.clientEventId,
            eventId: 'convex_event_1',
            serverSequence: 1,
          };
        },
      },
      store,
    });

    const firstSync = runtime.syncNow();
    await Promise.resolve();
    const secondSync = runtime.syncNow();

    expect(submitCalls).toBe(1);

    resolveSubmit();
    await Promise.all([firstSync, secondSync]);
    await Promise.resolve();

    expect(submitCalls).toBe(1);
    expect(store.readOutboxIds()).toEqual([]);
    expect(runtime.getSnapshot()).toMatchObject({
      outboxCount: 0,
      status: 'synced',
    });
  });
});

function createMatchStore({ localMatchId, matchId }) {
  const resolvedLocalMatchId = localMatchId ?? matchId;
  const storage = createMemoryStorage({
    [localMatchStorageKeys.deviceId]: 'dev_existing',
  });
  const store = createTestStore(storage);
  const match = store.createLocalMatch({
    localMatchId: resolvedLocalMatchId,
    matchId,
    players: [createPlayer('p1'), createPlayer('p2')],
    prototype: 'classic',
    startingLife: 40,
  });

  store.saveLocalMatch(match);

  return { match, store };
}

function createCanonicalMatch({ localMatchId, matchId, p1Life, sourceMatch, version }) {
  return {
    _id: matchId,
    localMatchId,
    phase: 'active',
    players: sourceMatch.players.map((player) => ({
      ...player,
      life: player.playerId === 'p1' ? p1Life : player.life,
      updatedAt: 5000,
    })),
    startingLife: sourceMatch.startingLife,
    updatedAt: 5000,
    version,
  };
}

function createMemoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));

  return {
    getNumber(key) {
      const value = values.get(key);
      return typeof value === 'number' ? value : undefined;
    },
    getString(key) {
      const value = values.get(key);
      return typeof value === 'string' ? value : undefined;
    },
    set(key, value) {
      values.set(key, value);
    },
  };
}

function createPlayer(playerId) {
  return {
    color: '#facc15',
    displayName: playerId,
    life: 40,
    ownerDeviceId: 'dev_existing',
    playerId,
    updatedAt: 1000,
  };
}

function createTestStore(storage) {
  return createLocalMatchStore(storage, {
    now: () => 1000,
    random: () => 0.5,
    warn: () => undefined,
  });
}
