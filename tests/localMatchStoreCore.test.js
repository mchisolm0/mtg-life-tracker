import { describe, expect, test } from 'bun:test';
import {
  LOCAL_MATCH_STORAGE_SCHEMA_VERSION,
  createLocalMatchStore,
  localMatchStorageKeys,
} from '../src/storage/localMatchStoreCore.ts';

describe('local match storage contract', () => {
  test('records life changes as event records and global outbox ids', () => {
    const storage = createMemoryStorage();
    const store = createTestStore(storage);
    const deviceId = store.getOrCreateDeviceId();
    const match = store.createLocalMatch({
      matchId: 'local_1',
      players: [createPlayer('p1', deviceId), createPlayer('p2', deviceId)],
      prototype: 'classic',
      startingLife: 40,
    });

    store.saveLocalMatch(match);

    const nextMatch = store.recordLifeChange(match, 'p1', -1);
    const clientEventId = nextMatch.eventIds[0];
    const queuedEvent = store.readQueuedEvent(clientEventId);
    const persistedMatch = JSON.parse(storage.getString(localMatchStorageKeys.match('local_1')));

    expect(nextMatch.players[0].life).toBe(39);
    expect(nextMatch.eventIds).toEqual([clientEventId]);
    expect(persistedMatch.eventIds).toEqual([clientEventId]);
    expect(store.readOutboxIds()).toEqual([clientEventId]);
    expect(storage.getNumber(localMatchStorageKeys.sequence)).toBe(1);
    expect(queuedEvent.status).toBe('pending');
    expect(queuedEvent.attempts).toBe(0);
    expect(queuedEvent.event).toMatchObject({
      delta: -1,
      matchId: 'local_1',
      nextLife: 39,
      ownerDeviceId: deviceId,
      playerId: 'p1',
      previousLife: 40,
      type: 'lifeChanged',
    });
  });

  test('rejects non-owned player changes before creating queued events', () => {
    const storage = createMemoryStorage();
    const store = createTestStore(storage);

    store.getOrCreateDeviceId();
    const match = store.createLocalMatch({
      matchId: 'local_1',
      players: [createPlayer('p1', 'dev_someone_else')],
      prototype: 'classic',
      startingLife: 40,
    });

    expect(() => store.recordLifeChange(match, 'p1', 1)).toThrow('owned by another device');
    expect(store.readOutboxIds()).toEqual([]);
    expect(storage.getNumber(localMatchStorageKeys.sequence)).toBeUndefined();
  });

  test('rejects deltas outside the Convex event contract bound', () => {
    const storage = createMemoryStorage();
    const store = createTestStore(storage);
    const deviceId = store.getOrCreateDeviceId();
    const match = store.createLocalMatch({
      matchId: 'local_1',
      players: [createPlayer('p1', deviceId)],
      prototype: 'classic',
      startingLife: 40,
    });

    expect(() => store.recordLifeChange(match, 'p1', 101)).toThrow('between -100 and 100');
    expect(store.readOutboxIds()).toEqual([]);
    expect(storage.getNumber(localMatchStorageKeys.sequence)).toBeUndefined();
  });

  test('resets persisted syncing events to pending on startup', () => {
    const storage = createMemoryStorage();
    const store = createTestStore(storage);
    const deviceId = store.getOrCreateDeviceId();
    const match = store.createLocalMatch({
      matchId: 'local_1',
      players: [createPlayer('p1', deviceId)],
      prototype: 'classic',
      startingLife: 40,
    });
    const nextMatch = store.recordLifeChange(match, 'p1', 1);
    const clientEventId = nextMatch.eventIds[0];
    const queuedEvent = store.readQueuedEvent(clientEventId);

    storage.set(
      localMatchStorageKeys.event(clientEventId),
      JSON.stringify({ ...queuedEvent, status: 'syncing' }),
    );
    storage.set(localMatchStorageKeys.outbox, JSON.stringify([]));

    const loadedMatch = store.loadLocalMatch();

    expect(loadedMatch.matchId).toBe('local_1');
    expect(store.readQueuedEvent(clientEventId).status).toBe('pending');
    expect(store.readOutboxIds()).toEqual([clientEventId]);
  });

  test('ack and reject transitions remove event ids from active outbox', () => {
    const storage = createMemoryStorage();
    const store = createTestStore(storage);
    const deviceId = store.getOrCreateDeviceId();
    const match = store.createLocalMatch({
      matchId: 'local_1',
      players: [createPlayer('p1', deviceId)],
      prototype: 'classic',
      startingLife: 40,
    });
    const firstMatch = store.recordLifeChange(match, 'p1', 1);
    const firstEventId = firstMatch.eventIds[0];

    const ackedEvent = store.markQueuedEventAcked({
      acknowledgedAt: 2000,
      clientEventId: firstEventId,
      convexEventId: 'convex_event_1',
    });

    expect(ackedEvent.status).toBe('acked');
    expect(ackedEvent.acknowledgedAt).toBe(2000);
    expect(ackedEvent.convexEventId).toBe('convex_event_1');
    expect(store.readOutboxIds()).toEqual([]);

    const secondMatch = store.recordLifeChange(firstMatch, 'p1', -2);
    const secondEventId = secondMatch.eventIds[1];
    const rejectedEvent = store.markQueuedEventRejected({
      clientEventId: secondEventId,
      rejectedAt: 3000,
      rejectionReason: 'invalidDelta',
    });

    expect(rejectedEvent.status).toBe('rejected');
    expect(rejectedEvent.rejectedAt).toBe(3000);
    expect(rejectedEvent.rejectionReason).toBe('invalidDelta');
    expect(store.readOutboxIds()).toEqual([]);
  });

  test('syncing and retry transitions preserve active outbox position', () => {
    const storage = createMemoryStorage();
    const store = createTestStore(storage);
    const deviceId = store.getOrCreateDeviceId();
    const match = store.createLocalMatch({
      matchId: 'local_1',
      players: [createPlayer('p1', deviceId)],
      prototype: 'classic',
      startingLife: 40,
    });
    const nextMatch = store.recordLifeChange(match, 'p1', 1);
    const clientEventId = nextMatch.eventIds[0];

    const syncingEvent = store.markQueuedEventSyncing({
      clientEventId,
      lastAttemptAt: 2000,
    });

    expect(syncingEvent.status).toBe('syncing');
    expect(syncingEvent.attempts).toBe(1);
    expect(syncingEvent.lastAttemptAt).toBe(2000);
    expect(store.readOutboxIds()).toEqual([clientEventId]);

    const retryEvent = store.markQueuedEventRetry({
      clientEventId,
      lastAttemptAt: 2000,
      nextAttemptAt: 3000,
    });

    expect(retryEvent.status).toBe('retry');
    expect(retryEvent.nextAttemptAt).toBe(3000);
    expect(store.readOutboxIds()).toEqual([clientEventId]);
  });

  test('migrates legacy embedded snapshots into match, event, and outbox records', () => {
    const storage = createMemoryStorage({
      [localMatchStorageKeys.activeMatchId]: 'legacy_1',
      [localMatchStorageKeys.deviceId]: 'dev_existing',
      [localMatchStorageKeys.sequence]: 1,
    });
    const eventA = createLegacyEvent({
      clientEventId: 'old-2',
      createdAt: 1100,
      delta: 1,
      localSequence: 2,
      nextLife: 40,
      previousLife: 39,
    });
    const eventB = createLegacyEvent({
      clientEventId: 'old-1',
      createdAt: 1000,
      delta: -1,
      localSequence: 1,
      nextLife: 39,
      previousLife: 40,
    });
    const eventC = createLegacyEvent({
      clientEventId: 'old-3',
      createdAt: 1200,
      delta: 1,
      localSequence: 3,
      nextLife: 40,
      previousLife: 39,
    });
    const legacySnapshot = {
      activeMatchId: 'legacy_1',
      events: [eventA, eventC],
      outbox: [{ event: eventA, status: 'pending' }],
      players: [{ color: '#abcdef', id: 'p1', life: 39, name: 'Alice' }],
      prototype: 'paper',
      startingLife: 40,
      updatedAt: 1200,
    };

    storage.set(localMatchStorageKeys.match('legacy_1'), JSON.stringify(legacySnapshot));
    storage.set(
      localMatchStorageKeys.legacyOutbox('legacy_1'),
      JSON.stringify([
        { event: eventB, status: 'pending' },
        { event: eventA, status: 'pending' },
      ]),
    );

    const store = createTestStore(storage);
    const migratedMatch = store.loadLocalMatch();

    expect(migratedMatch).toMatchObject({
      eventIds: ['old-1', 'old-2', 'old-3'],
      localMatchId: 'legacy_1',
      matchId: 'legacy_1',
      phase: 'active',
      prototype: 'paper',
      schemaVersion: LOCAL_MATCH_STORAGE_SCHEMA_VERSION,
      startingLife: 40,
      updatedAt: 1200,
    });
    expect(migratedMatch.players[0]).toMatchObject({
      color: '#abcdef',
      displayName: 'Alice',
      life: 39,
      ownerDeviceId: 'dev_existing',
      playerId: 'p1',
      updatedAt: 1200,
    });
    expect(store.readOutboxIds()).toEqual(['old-1', 'old-2']);
    expect(store.readQueuedEvent('old-1').status).toBe('pending');
    expect(store.readQueuedEvent('old-2').event.nextLife).toBe(40);
    expect(store.readQueuedEvent('old-3').status).toBe('acked');
    expect(storage.getNumber(localMatchStorageKeys.sequence)).toBe(3);
  });

  test('corrupt match JSON warns and does not crash', () => {
    const warnings = [];
    const storage = createMemoryStorage({
      [localMatchStorageKeys.activeMatchId]: 'broken',
      [localMatchStorageKeys.match('broken')]: '{not json',
    });
    const store = createLocalMatchStore(storage, {
      now: () => 1000,
      random: () => 0.5,
      warn: (message) => warnings.push(message),
    });

    expect(store.loadLocalMatch()).toBeUndefined();
    expect(warnings[0]).toContain('Could not parse local MMKV match');
  });
});

function createLegacyEvent(overrides) {
  return {
    clientEventId: overrides.clientEventId,
    createdAt: overrides.createdAt,
    delta: overrides.delta,
    localSequence: overrides.localSequence,
    matchId: 'legacy_1',
    nextLife: overrides.nextLife,
    ownerDeviceId: 'dev_existing',
    playerId: 'p1',
    previousLife: overrides.previousLife,
    type: 'lifeChanged',
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
