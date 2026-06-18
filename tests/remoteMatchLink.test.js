import { describe, expect, test } from 'bun:test';
import { createLocalMatchStore, localMatchStorageKeys } from '../src/storage/localMatchStoreCore.ts';
import { ensureRemoteMatchLink } from '../src/sync/remoteMatchLink.ts';

describe('remote match link bootstrap', () => {
  test('returns noMatch when there is no active local match', async () => {
    const store = createTestStore(createMemoryStorage());
    const result = await ensureRemoteMatchLink({
      api: {
        createOrResume: async () => {
          throw new Error('should not be called');
        },
      },
      store,
    });

    expect(result).toEqual({ status: 'noMatch' });
  });

  test('does not call createOrResume for already remote matches', async () => {
    const { match, store } = createMatchStore({ matchId: 'match_remote_1' });
    let calls = 0;

    const result = await ensureRemoteMatchLink({
      api: {
        createOrResume: async () => {
          calls += 1;
          throw new Error('should not be called');
        },
      },
      store,
    });

    expect(calls).toBe(0);
    expect(result).toEqual({ match, status: 'alreadyRemote' });
  });

  test('creates a remote match and relabels queued local-only events', async () => {
    const { match, store } = createMatchStore({ localMatchId: 'legacy_1', matchId: 'legacy_1' });
    const nextMatch = store.recordLifeChange(match, 'p1', -1);
    const clientEventId = nextMatch.eventIds[0];
    let request;

    const result = await ensureRemoteMatchLink({
      api: {
        createOrResume: async (args) => {
          request = args;
          return {
            match: {
              _id: 'match_remote_1',
              localMatchId: 'legacy_1',
              phase: 'active',
              players: nextMatch.players.map((player) => ({
                ...player,
                life: 40,
                updatedAt: 5000,
              })),
              startingLife: 40,
              updatedAt: 5000,
              version: 0,
            },
            serverTime: 5000,
          };
        },
      },
      store,
    });

    expect(request).toMatchObject({
      deviceId: 'dev_existing',
      localMatchId: 'legacy_1',
      players: [
        {
          color: '#facc15',
          displayName: 'p1',
          ownerDeviceId: 'dev_existing',
          playerId: 'p1',
        },
      ],
      startingLife: 40,
    });
    expect(result.status).toBe('linked');
    expect(result.match).toMatchObject({
      lastServerVersion: 0,
      localMatchId: 'legacy_1',
      matchId: 'match_remote_1',
    });
    expect(result.match.players[0].life).toBe(39);
    expect(store.readQueuedEvent(clientEventId)).toMatchObject({
      event: {
        matchId: 'match_remote_1',
      },
      status: 'pending',
    });
    expect(store.loadLocalMatch().matchId).toBe('match_remote_1');
  });
});

function createMatchStore({ localMatchId = 'local_1', matchId }) {
  const storage = createMemoryStorage({
    [localMatchStorageKeys.deviceId]: 'dev_existing',
  });
  const store = createTestStore(storage);
  const match = store.createLocalMatch({
    localMatchId,
    matchId,
    players: [createPlayer('p1', 'dev_existing')],
    prototype: 'classic',
    startingLife: 40,
  });

  store.saveLocalMatch(match);

  return { match, store };
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

function createPlayer(playerId, ownerDeviceId) {
  return {
    color: '#facc15',
    displayName: playerId,
    life: 40,
    ownerDeviceId,
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
