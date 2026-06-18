import { describe, expect, test } from 'bun:test';
import { createLocalMatchStore } from '../src/storage/localMatchStoreCore.ts';
import { flushMatchOutbox, retryDelayMs } from '../src/sync/matchOutboxSync.ts';

describe('match outbox sync bootstrap', () => {
  test('submits pending events oldest first and marks accepted events acked', async () => {
    const { match, store } = createSyncedMatchStore();
    const firstMatch = store.recordLifeChange(match, 'p1', -1);
    const secondMatch = store.recordLifeChange(firstMatch, 'p1', -1);
    const submitted = [];

    const result = await flushMatchOutbox({
      api: {
        submitLifeEvent: async ({ event, matchId }) => {
          submitted.push(event.clientEventId);
          return {
            accepted: true,
            canonicalMatch: createCanonicalMatch(match, { p1Life: 40 - submitted.length }),
            clientEventId: event.clientEventId,
            eventId: `convex_${submitted.length}`,
            serverSequence: submitted.length,
          };
        },
      },
      now: () => 5000,
      store,
    });

    expect(result).toEqual({
      accepted: 2,
      failedTransient: 0,
      rejected: 0,
      rejectedEvents: [],
      skipped: 0,
      submitted: 2,
    });
    expect(submitted).toEqual(secondMatch.eventIds);
    expect(store.readOutboxIds()).toEqual([]);
    expect(store.readQueuedEvent(secondMatch.eventIds[0])).toMatchObject({
      acknowledgedAt: 5000,
      convexEventId: 'convex_1',
      status: 'acked',
    });
    expect(store.readQueuedEvent(secondMatch.eventIds[1])).toMatchObject({
      convexEventId: 'convex_2',
      status: 'acked',
    });
    expect(store.loadLocalMatch().players[0].life).toBe(38);
  });

  test('marks permanent server rejections and rebases from canonical match', async () => {
    const { match, store } = createSyncedMatchStore();
    const nextMatch = store.recordLifeChange(match, 'p1', 1);
    const clientEventId = nextMatch.eventIds[0];

    const result = await flushMatchOutbox({
      api: {
        submitLifeEvent: async ({ event }) => ({
          accepted: false,
          canonicalMatch: createCanonicalMatch(match, { p1Life: 40 }),
          clientEventId: event.clientEventId,
          reason: 'notOwner',
        }),
      },
      now: () => 6000,
      store,
    });

    expect(result.rejected).toBe(1);
    expect(result.rejectedEvents).toEqual([
      {
        clientEventId,
        reason: 'notOwner',
      },
    ]);
    expect(store.readOutboxIds()).toEqual([]);
    expect(store.readQueuedEvent(clientEventId)).toMatchObject({
      rejectedAt: 6000,
      rejectionReason: 'notOwner',
      status: 'rejected',
    });
    expect(store.loadLocalMatch().players[0].life).toBe(40);
  });

  test('moves transient failures to retry and stops flushing subsequent events', async () => {
    const { match, store } = createSyncedMatchStore();
    const firstMatch = store.recordLifeChange(match, 'p1', -1);
    const secondMatch = store.recordLifeChange(firstMatch, 'p1', -1);
    const firstEventId = secondMatch.eventIds[0];
    const secondEventId = secondMatch.eventIds[1];

    const result = await flushMatchOutbox({
      api: {
        submitLifeEvent: async () => {
          throw new Error('offline');
        },
      },
      now: () => 7000,
      random: () => 0,
      store,
    });

    expect(result).toEqual({
      accepted: 0,
      failedTransient: 1,
      rejected: 0,
      rejectedEvents: [],
      skipped: 0,
      submitted: 1,
    });
    expect(store.readOutboxIds()).toEqual([firstEventId, secondEventId]);
    expect(store.readQueuedEvent(firstEventId)).toMatchObject({
      attempts: 1,
      lastAttemptAt: 7000,
      nextAttemptAt: 8000,
      status: 'retry',
    });
    expect(store.readQueuedEvent(secondEventId).status).toBe('pending');
  });

  test('treats mismatched response ids as transient failures for the submitted event', async () => {
    const { match, store } = createSyncedMatchStore();
    const nextMatch = store.recordLifeChange(match, 'p1', -1);
    const clientEventId = nextMatch.eventIds[0];

    const result = await flushMatchOutbox({
      api: {
        submitLifeEvent: async () => ({
          accepted: true,
          canonicalMatch: createCanonicalMatch(match, { p1Life: 39 }),
          clientEventId: 'different-event',
          eventId: 'convex_1',
          serverSequence: 1,
        }),
      },
      now: () => 7000,
      random: () => 0,
      store,
    });

    expect(result.failedTransient).toBe(1);
    expect(store.readOutboxIds()).toEqual([clientEventId]);
    expect(store.readQueuedEvent(clientEventId)).toMatchObject({
      attempts: 1,
      status: 'retry',
    });
  });

  test('stops at a retry event whose retry window has not elapsed', async () => {
    const { match, store } = createSyncedMatchStore();
    const firstMatch = store.recordLifeChange(match, 'p1', -1);
    const secondMatch = store.recordLifeChange(firstMatch, 'p1', -1);
    const firstEventId = secondMatch.eventIds[0];
    const secondEventId = secondMatch.eventIds[1];
    let calls = 0;

    store.markQueuedEventRetry({
      clientEventId: firstEventId,
      nextAttemptAt: 9000,
    });

    const result = await flushMatchOutbox({
      api: {
        submitLifeEvent: async ({ event }) => {
          calls += 1;
          return {
            accepted: true,
            canonicalMatch: createCanonicalMatch(match, { p1Life: 39 }),
            clientEventId: event.clientEventId,
            eventId: 'convex_1',
            serverSequence: 1,
          };
        },
      },
      now: () => 8000,
      store,
    });

    expect(calls).toBe(0);
    expect(result.skipped).toBe(1);
    expect(store.readOutboxIds()).toEqual([firstEventId, secondEventId]);
    expect(store.readQueuedEvent(firstEventId).status).toBe('retry');
    expect(store.readQueuedEvent(secondEventId).status).toBe('pending');
  });

  test('rebases canonical matches while keeping remaining pending deltas optimistic', async () => {
    const { match, store } = createSyncedMatchStore();
    const firstMatch = store.recordLifeChange(match, 'p1', -1);
    const secondMatch = store.recordLifeChange(firstMatch, 'p1', -1);
    const firstEventId = secondMatch.eventIds[0];
    const secondEventId = secondMatch.eventIds[1];

    const result = await flushMatchOutbox({
      api: {
        submitLifeEvent: async ({ event }) => ({
          accepted: false,
          canonicalMatch: createCanonicalMatch(match, { p1Life: 40 }),
          clientEventId: event.clientEventId,
          reason: 'invalidDelta',
        }),
      },
      limit: 1,
      now: () => 8000,
      store,
    });

    expect(result.rejected).toBe(1);
    expect(result.rejectedEvents).toEqual([
      {
        clientEventId: firstEventId,
        reason: 'invalidDelta',
      },
    ]);
    expect(store.readOutboxIds()).toEqual([secondEventId]);
    expect(store.readQueuedEvent(firstEventId).status).toBe('rejected');
    expect(store.readQueuedEvent(secondEventId).status).toBe('pending');
    expect(store.loadLocalMatch().players[0].life).toBe(39);
  });

  test('leaves local-only matches queued until remote match creation is wired', async () => {
    const { match, store } = createSyncedMatchStore({ localMatchId: 'legacy_1', matchId: 'legacy_1' });
    const nextMatch = store.recordLifeChange(match, 'p1', -1);
    const clientEventId = nextMatch.eventIds[0];
    let calls = 0;

    const result = await flushMatchOutbox({
      api: {
        submitLifeEvent: async ({ event }) => {
          calls += 1;
          return {
            accepted: true,
            canonicalMatch: createCanonicalMatch(match, { p1Life: 39 }),
            clientEventId: event.clientEventId,
            eventId: 'convex_1',
            serverSequence: 1,
          };
        },
      },
      store,
    });

    expect(calls).toBe(0);
    expect(result.skipped).toBe(1);
    expect(store.readOutboxIds()).toEqual([clientEventId]);
    expect(store.readQueuedEvent(clientEventId).status).toBe('localOnly');
  });

  test('calculates capped exponential retry delays', () => {
    expect(retryDelayMs(1, () => 0)).toBe(1000);
    expect(retryDelayMs(2, () => 0)).toBe(2000);
    expect(retryDelayMs(2, () => 0.5)).toBe(2250);
    expect(retryDelayMs(10, () => 0.5)).toBe(30000);
  });
});

function createSyncedMatchStore({ localMatchId = 'local_1', matchId = 'match_remote_1' } = {}) {
  const storage = createMemoryStorage();
  const store = createTestStore(storage);
  const deviceId = store.getOrCreateDeviceId();
  const match = store.createLocalMatch({
    localMatchId,
    matchId,
    players: [createPlayer('p1', deviceId), createPlayer('p2', deviceId)],
    prototype: 'classic',
    startingLife: 40,
  });

  store.saveLocalMatch(match);

  return { match, storage, store };
}

function createCanonicalMatch(match, { p1Life }) {
  return {
    _id: match.matchId,
    localMatchId: match.localMatchId,
    phase: match.phase,
    players: match.players.map((player) => ({
      ...player,
      life: player.playerId === 'p1' ? p1Life : player.life,
    })),
    startingLife: match.startingLife,
    updatedAt: 5000,
    version: 1,
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
  let time = 1000;

  return createLocalMatchStore(storage, {
    now: () => {
      time += 10;
      return time;
    },
    random: () => 0.5,
    warn: () => undefined,
  });
}
