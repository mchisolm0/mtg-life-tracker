import { describe, expect, test } from 'bun:test';
import { createLocalMatchStore, localMatchStorageKeys } from '../src/storage/localMatchStoreCore.ts';
import { syncLocalMatch } from '../src/sync/matchSyncCoordinator.ts';

describe('match sync coordinator', () => {
  test('links a local match before flushing queued events', async () => {
    const { match, store } = createMatchStore({
      localMatchId: 'local_1',
      matchId: 'local_1',
    });
    const optimisticMatch = store.recordLifeChange(match, 'p1', -1);
    const clientEventId = optimisticMatch.eventIds[0];
    const calls = [];

    const result = await syncLocalMatch({
      api: {
        createOrResume: async (args) => {
          calls.push(['createOrResume', args.localMatchId]);
          return {
            match: createCanonicalMatch({
              localMatchId: args.localMatchId,
              matchId: 'match_remote_1',
              sourceMatch: optimisticMatch,
              p1Life: 40,
              version: 0,
            }),
            serverTime: 5000,
          };
        },
        submitLifeEvent: async ({ event, matchId }) => {
          calls.push(['submitLifeEvent', matchId, event.matchId]);
          return {
            accepted: true,
            canonicalMatch: createCanonicalMatch({
              localMatchId: 'local_1',
              matchId: 'match_remote_1',
              sourceMatch: optimisticMatch,
              p1Life: 39,
              version: 1,
            }),
            clientEventId: event.clientEventId,
            eventId: 'convex_event_1',
            serverSequence: 1,
          };
        },
      },
      now: () => 8000,
      store,
    });

    expect(result.link.status).toBe('linked');
    expect(result.outbox).toEqual({
      accepted: 1,
      failedTransient: 0,
      rejected: 0,
      skipped: 0,
      submitted: 1,
    });
    expect(calls).toEqual([
      ['createOrResume', 'local_1'],
      ['submitLifeEvent', 'match_remote_1', 'match_remote_1'],
    ]);
    expect(store.loadLocalMatch()).toMatchObject({
      lastServerVersion: 1,
      localMatchId: 'local_1',
      matchId: 'match_remote_1',
    });
    expect(store.loadLocalMatch().players[0].life).toBe(39);
    expect(store.readOutboxIds()).toEqual([]);
    expect(store.readQueuedEvent(clientEventId)).toMatchObject({
      acknowledgedAt: 8000,
      convexEventId: 'convex_event_1',
      status: 'acked',
    });
  });

  test('flushes already linked matches without creating a remote match', async () => {
    const { match, store } = createMatchStore({
      localMatchId: 'local_1',
      matchId: 'match_remote_1',
    });
    const optimisticMatch = store.recordLifeChange(match, 'p1', -1);
    const clientEventId = optimisticMatch.eventIds[0];
    let createCalls = 0;

    const result = await syncLocalMatch({
      api: {
        createOrResume: async () => {
          createCalls += 1;
          throw new Error('should not create an already remote match');
        },
        submitLifeEvent: async ({ event }) => ({
          accepted: true,
          canonicalMatch: createCanonicalMatch({
            localMatchId: 'local_1',
            matchId: 'match_remote_1',
            sourceMatch: optimisticMatch,
            p1Life: 39,
            version: 1,
          }),
          clientEventId: event.clientEventId,
          eventId: 'convex_event_1',
          serverSequence: 1,
        }),
      },
      now: () => 9000,
      store,
    });

    expect(createCalls).toBe(0);
    expect(result.link.status).toBe('alreadyRemote');
    expect(result.outbox.accepted).toBe(1);
    expect(store.readOutboxIds()).toEqual([]);
    expect(store.readQueuedEvent(clientEventId)).toMatchObject({
      acknowledgedAt: 9000,
      status: 'acked',
    });
  });
});

function createMatchStore({ localMatchId, matchId }) {
  const storage = createMemoryStorage({
    [localMatchStorageKeys.deviceId]: 'dev_existing',
  });
  const store = createTestStore(storage);
  const match = store.createLocalMatch({
    localMatchId,
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
