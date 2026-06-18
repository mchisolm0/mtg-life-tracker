export type PrototypeKey = 'classic' | 'ink' | 'glass' | 'paper' | 'store';

export type MatchPhase = 'setup' | 'active' | 'ended';

export type SyncStatus = 'localOnly' | 'pending' | 'syncing' | 'acked' | 'rejected' | 'retry';

export type RejectionReason =
  | 'notOwner'
  | 'matchEnded'
  | 'playerMissing'
  | 'invalidDelta'
  | 'duplicateClientEventId'
  | 'serverError';

export type LocalPlayer = {
  playerId: string;
  displayName: string;
  life: number;
  color: string;
  ownerDeviceId: string;
  ownerUserId?: string;
  updatedAt: number;
};

export type LifeChangedEvent = {
  type: 'lifeChanged';
  clientEventId: string;
  matchId: string;
  playerId: string;
  ownerDeviceId: string;
  delta: number;
  previousLife: number;
  nextLife: number;
  localSequence: number;
  createdAt: number;
};

export type LocalQueuedEvent = {
  schemaVersion: number;
  event: LifeChangedEvent;
  status: SyncStatus;
  attempts: number;
  lastAttemptAt?: number;
  nextAttemptAt?: number;
  acknowledgedAt?: number;
  convexEventId?: string;
  rejectedAt?: number;
  rejectionReason?: RejectionReason;
};

export type LocalMatch = {
  schemaVersion: number;
  matchId: string;
  localMatchId?: string;
  phase: MatchPhase;
  prototype: PrototypeKey;
  startingLife: number;
  players: LocalPlayer[];
  eventIds: string[];
  lastServerVersion?: number;
  updatedAt: number;
};

export type LocalMatchStorage = {
  getString: (key: string) => string | undefined;
  getNumber: (key: string) => number | undefined;
  set: (key: string, value: string | number | boolean) => void;
  delete?: (key: string) => void;
};

type LocalMatchStoreOptions = {
  now?: () => number;
  random?: () => number;
  warn?: (message: string, error?: unknown) => void;
};

type LegacyPlayer = {
  id?: string;
  name?: string;
  playerId?: string;
  displayName?: string;
  life?: number;
  color?: string;
  ownerDeviceId?: string;
  ownerUserId?: string;
  updatedAt?: number;
};

type LegacySnapshot = {
  activeMatchId?: string;
  matchId?: string;
  prototype?: PrototypeKey;
  startingLife?: number;
  players?: LegacyPlayer[];
  events?: LifeChangedEvent[];
  outbox?: LegacyQueuedLifeEvent[];
  updatedAt?: number;
};

type LegacyQueuedLifeEvent = {
  event?: LifeChangedEvent;
  status?: SyncStatus;
  attempts?: number;
};

export const LOCAL_MATCH_STORAGE_SCHEMA_VERSION = 2;
export const DEFAULT_STARTING_LIFE = 40;
export const DEFAULT_ACTIVE_MATCH_ID = 'local-default-match';
export const MAX_LIFE_DELTA = 100;

export const localMatchStorageKeys = {
  activeMatchId: 'mana-ledger:activeMatchId',
  deviceId: 'mana-ledger:deviceId',
  event: (clientEventId: string) => `mana-ledger:event:${clientEventId}`,
  match: (matchId: string) => `mana-ledger:match:${matchId}`,
  outbox: 'mana-ledger:outbox',
  legacyOutbox: (matchId: string) => `mana-ledger:outbox:${matchId}`,
  sequence: 'mana-ledger:localSequence',
};

export function createLocalMatchStore(storage: LocalMatchStorage, options: LocalMatchStoreOptions = {}) {
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  const warn = options.warn ?? ((message: string, error?: unknown) => console.warn(message, error));

  function getOrCreateDeviceId() {
    const savedDeviceId = storage.getString(localMatchStorageKeys.deviceId);
    if (savedDeviceId) return savedDeviceId;

    const deviceId = createOpaqueId('dev');
    storage.set(localMatchStorageKeys.deviceId, deviceId);
    return deviceId;
  }

  function createLocalMatchId() {
    return createOpaqueId('local');
  }

  function createLifeChangedEvent({
    delta,
    matchId,
    nextLife,
    ownerDeviceId = getOrCreateDeviceId(),
    playerId,
    previousLife,
  }: {
    delta: number;
    matchId: string;
    nextLife: number;
    ownerDeviceId?: string;
    playerId: string;
    previousLife: number;
  }): LifeChangedEvent {
    if (!Number.isInteger(delta) || delta === 0) {
      throw new Error('Life change delta must be a non-zero integer.');
    }
    if (Math.abs(delta) > MAX_LIFE_DELTA) {
      throw new Error(`Life change delta must be between -${MAX_LIFE_DELTA} and ${MAX_LIFE_DELTA}.`);
    }

    const localSequence = nextLocalSequence();
    const createdAt = now();
    const clientEventId = `${ownerDeviceId}:${localSequence}:${createOpaqueId('evt')}`;

    return {
      type: 'lifeChanged',
      clientEventId,
      matchId,
      playerId,
      ownerDeviceId,
      delta,
      previousLife,
      nextLife,
      localSequence,
      createdAt,
    };
  }

  function createLocalMatch({
    localMatchId,
    matchId = createLocalMatchId(),
    phase = 'active',
    players,
    prototype,
    startingLife = DEFAULT_STARTING_LIFE,
  }: {
    localMatchId?: string;
    matchId?: string;
    phase?: MatchPhase;
    players: LocalPlayer[];
    prototype: PrototypeKey;
    startingLife?: number;
  }): LocalMatch {
    const updatedAt = now();
    const normalizedPlayers = players.map((player) => ({
      ...player,
      updatedAt: player.updatedAt || updatedAt,
    }));

    return {
      schemaVersion: LOCAL_MATCH_STORAGE_SCHEMA_VERSION,
      matchId,
      localMatchId: localMatchId ?? matchId,
      phase,
      prototype,
      startingLife,
      players: normalizedPlayers,
      eventIds: [],
      updatedAt,
    };
  }

  function loadLocalMatch(): LocalMatch | undefined {
    const activeMatchId = storage.getString(localMatchStorageKeys.activeMatchId) ?? DEFAULT_ACTIVE_MATCH_ID;
    const rawMatch = storage.getString(localMatchStorageKeys.match(activeMatchId));

    if (!rawMatch) return undefined;

    try {
      const parsed = JSON.parse(rawMatch) as unknown;

      if (isCurrentLocalMatch(parsed)) {
        const match = normalizeCurrentMatch(parsed);
        normalizeQueuedEventsForStartup(match);
        saveLocalMatch(match);
        return match;
      }

      const migrated = migrateLegacySnapshot(parsed as LegacySnapshot, activeMatchId);
      if (!migrated) return undefined;

      saveLocalMatch(migrated);
      return migrated;
    } catch (error) {
      warn('Could not parse local MMKV match', error);
      return undefined;
    }
  }

  function saveLocalMatch(match: LocalMatch) {
    storage.set(localMatchStorageKeys.activeMatchId, match.matchId);
    storage.set(localMatchStorageKeys.match(match.matchId), JSON.stringify(match));
  }

  function recordLifeChange(match: LocalMatch, playerId: string, delta: number): LocalMatch {
    const player = match.players.find((candidate) => candidate.playerId === playerId);
    if (!player) {
      throw new Error(`Cannot change life for missing player ${playerId}.`);
    }

    const currentDeviceId = getOrCreateDeviceId();
    if (player.ownerDeviceId !== currentDeviceId) {
      throw new Error(`Cannot change life for player ${playerId} owned by another device.`);
    }

    const nextLife = player.life + delta;
    const updatedAt = now();
    const event = createLifeChangedEvent({
      delta,
      matchId: match.matchId,
      nextLife,
      ownerDeviceId: currentDeviceId,
      playerId,
      previousLife: player.life,
    });

    const queuedEvent: LocalQueuedEvent = {
      schemaVersion: LOCAL_MATCH_STORAGE_SCHEMA_VERSION,
      event,
      status: 'pending',
      attempts: 0,
    };
    const nextMatch: LocalMatch = {
      ...match,
      players: match.players.map((candidate) =>
        candidate.playerId === playerId ? { ...candidate, life: nextLife, updatedAt } : candidate,
      ),
      eventIds: appendUnique(match.eventIds, event.clientEventId),
      updatedAt,
    };

    writeQueuedEvent(queuedEvent);
    appendOutboxId(event.clientEventId);
    saveLocalMatch(nextMatch);

    return nextMatch;
  }

  function readQueuedEvent(clientEventId: string): LocalQueuedEvent | undefined {
    return readJson<LocalQueuedEvent | undefined>(
      localMatchStorageKeys.event(clientEventId),
      undefined,
      'Could not parse local queued event',
    );
  }

  function readOutboxIds() {
    return readJson<string[]>(localMatchStorageKeys.outbox, [], 'Could not parse local outbox').filter(
      (candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0,
    );
  }

  function markQueuedEventAcked({
    acknowledgedAt = now(),
    clientEventId,
    convexEventId,
  }: {
    acknowledgedAt?: number;
    clientEventId: string;
    convexEventId?: string;
  }) {
    const queuedEvent = readQueuedEvent(clientEventId);
    if (!queuedEvent) return undefined;

    const nextQueuedEvent: LocalQueuedEvent = {
      ...queuedEvent,
      acknowledgedAt,
      convexEventId,
      status: 'acked',
    };

    writeQueuedEvent(nextQueuedEvent);
    removeOutboxId(clientEventId);

    return nextQueuedEvent;
  }

  function markQueuedEventSyncing({
    clientEventId,
    lastAttemptAt = now(),
  }: {
    clientEventId: string;
    lastAttemptAt?: number;
  }) {
    const queuedEvent = readQueuedEvent(clientEventId);
    if (!queuedEvent) return undefined;

    const nextQueuedEvent: LocalQueuedEvent = {
      ...queuedEvent,
      attempts: queuedEvent.attempts + 1,
      lastAttemptAt,
      nextAttemptAt: undefined,
      status: 'syncing',
    };

    writeQueuedEvent(nextQueuedEvent);

    return nextQueuedEvent;
  }

  function markQueuedEventRetry({
    clientEventId,
    lastAttemptAt = now(),
    nextAttemptAt,
  }: {
    clientEventId: string;
    lastAttemptAt?: number;
    nextAttemptAt: number;
  }) {
    const queuedEvent = readQueuedEvent(clientEventId);
    if (!queuedEvent) return undefined;

    const nextQueuedEvent: LocalQueuedEvent = {
      ...queuedEvent,
      lastAttemptAt,
      nextAttemptAt,
      status: 'retry',
    };

    writeQueuedEvent(nextQueuedEvent);
    appendOutboxId(clientEventId);

    return nextQueuedEvent;
  }

  function markQueuedEventRejected({
    clientEventId,
    rejectedAt = now(),
    rejectionReason,
  }: {
    clientEventId: string;
    rejectedAt?: number;
    rejectionReason: RejectionReason;
  }) {
    const queuedEvent = readQueuedEvent(clientEventId);
    if (!queuedEvent) return undefined;

    const nextQueuedEvent: LocalQueuedEvent = {
      ...queuedEvent,
      rejectedAt,
      rejectionReason,
      status: 'rejected',
    };

    writeQueuedEvent(nextQueuedEvent);
    removeOutboxId(clientEventId);

    return nextQueuedEvent;
  }

  function migrateLegacySnapshot(parsed: LegacySnapshot, activeMatchId: string) {
    const legacyPlayers = Array.isArray(parsed.players) ? parsed.players : [];
    if (legacyPlayers.length === 0) return undefined;

    const deviceId = getOrCreateDeviceId();
    const updatedAt = numberOr(parsed.updatedAt, now());
    const matchId = stringOr(parsed.matchId, stringOr(parsed.activeMatchId, activeMatchId));
    const prototype = isPrototypeKey(parsed.prototype) ? parsed.prototype : 'classic';
    const startingLife = numberOr(parsed.startingLife, DEFAULT_STARTING_LIFE);
    const players = legacyPlayers.map((player, index) => normalizeLegacyPlayer(player, index, deviceId, updatedAt));
    const legacyOutbox = readLegacyOutbox(matchId, parsed.outbox);
    const legacyOutboxEvents = legacyOutbox.map((queuedEvent) => queuedEvent.event).filter(isLifeChangedEvent);
    const embeddedEvents = Array.isArray(parsed.events) ? parsed.events.filter(isLifeChangedEvent) : [];
    const eventsById = new Map<string, LifeChangedEvent>();

    for (const event of [...embeddedEvents, ...legacyOutboxEvents]) {
      const normalizedEvent = normalizeLegacyEvent(event, matchId, deviceId);
      if (normalizedEvent) {
        eventsById.set(normalizedEvent.clientEventId, normalizedEvent);
      }
    }

    const orderedEvents = [...eventsById.values()].sort(compareEvents);
    const eventIds = orderedEvents.map((event) => event.clientEventId);
    const legacyOutboxIds = legacyOutboxEvents
      .map((event) => normalizeLegacyEvent(event, matchId, deviceId)?.clientEventId)
      .filter((clientEventId): clientEventId is string => Boolean(clientEventId));
    const outboxIds = [...new Set(legacyOutboxIds)];
    const outboxIdSet = new Set(outboxIds);
    const maxLocalSequence = orderedEvents.reduce(
      (highest, event) => Math.max(highest, event.localSequence),
      storage.getNumber(localMatchStorageKeys.sequence) ?? 0,
    );

    for (const event of orderedEvents) {
      writeQueuedEvent({
        schemaVersion: LOCAL_MATCH_STORAGE_SCHEMA_VERSION,
        event,
        status: outboxIdSet.has(event.clientEventId) ? 'pending' : 'acked',
        attempts: 0,
      });
    }

    writeOutboxIds(outboxIds);
    storage.set(localMatchStorageKeys.sequence, maxLocalSequence);

    return {
      schemaVersion: LOCAL_MATCH_STORAGE_SCHEMA_VERSION,
      matchId,
      localMatchId: matchId,
      phase: 'active',
      prototype,
      startingLife,
      players,
      eventIds,
      updatedAt,
    } satisfies LocalMatch;
  }

  function normalizeCurrentMatch(match: LocalMatch) {
    const updatedAt = numberOr(match.updatedAt, now());
    const deviceId = getOrCreateDeviceId();

    return {
      schemaVersion: LOCAL_MATCH_STORAGE_SCHEMA_VERSION,
      matchId: match.matchId,
      localMatchId: match.localMatchId,
      phase: isMatchPhase(match.phase) ? match.phase : 'active',
      prototype: isPrototypeKey(match.prototype) ? match.prototype : 'classic',
      startingLife: numberOr(match.startingLife, DEFAULT_STARTING_LIFE),
      players: match.players.map((player, index) => normalizeLegacyPlayer(player, index, deviceId, updatedAt)),
      eventIds: match.eventIds.filter((eventId): eventId is string => typeof eventId === 'string'),
      lastServerVersion: match.lastServerVersion,
      updatedAt,
    } satisfies LocalMatch;
  }

  function normalizeQueuedEventsForStartup(match: LocalMatch) {
    const outboxIds = readOutboxIds();
    const outboxSet = new Set(outboxIds);
    let outboxChanged = false;

    for (const clientEventId of match.eventIds) {
      const queuedEvent = readQueuedEvent(clientEventId);
      if (!queuedEvent) continue;

      const status = queuedEvent.status === 'syncing' ? 'pending' : queuedEvent.status;
      const nextQueuedEvent =
        status === queuedEvent.status
          ? queuedEvent
          : {
              ...queuedEvent,
              status,
            };

      if (nextQueuedEvent !== queuedEvent) {
        writeQueuedEvent(nextQueuedEvent);
      }

      if (isOutboxStatus(status) && !outboxSet.has(clientEventId)) {
        outboxIds.push(clientEventId);
        outboxSet.add(clientEventId);
        outboxChanged = true;
      }
    }

    if (outboxChanged) {
      writeOutboxIds(outboxIds);
    }
  }

  function readLegacyOutbox(matchId: string, embeddedOutbox: LegacyQueuedLifeEvent[] | undefined) {
    const fallback = Array.isArray(embeddedOutbox) ? embeddedOutbox : [];

    return readJson<LegacyQueuedLifeEvent[]>(
      localMatchStorageKeys.legacyOutbox(matchId),
      fallback,
      'Could not parse legacy local outbox',
    ).filter((queuedEvent) => queuedEvent && typeof queuedEvent === 'object');
  }

  function writeQueuedEvent(queuedEvent: LocalQueuedEvent) {
    storage.set(localMatchStorageKeys.event(queuedEvent.event.clientEventId), JSON.stringify(queuedEvent));
  }

  function appendOutboxId(clientEventId: string) {
    writeOutboxIds(appendUnique(readOutboxIds(), clientEventId));
  }

  function removeOutboxId(clientEventId: string) {
    writeOutboxIds(readOutboxIds().filter((candidate) => candidate !== clientEventId));
  }

  function writeOutboxIds(clientEventIds: string[]) {
    storage.set(localMatchStorageKeys.outbox, JSON.stringify([...new Set(clientEventIds)]));
  }

  function nextLocalSequence() {
    const sequence = (storage.getNumber(localMatchStorageKeys.sequence) ?? 0) + 1;
    storage.set(localMatchStorageKeys.sequence, sequence);
    return sequence;
  }

  function readJson<T>(key: string, fallback: T, message: string): T {
    const raw = storage.getString(key);
    if (!raw) return fallback;

    try {
      return JSON.parse(raw) as T;
    } catch (error) {
      warn(`${message}: ${key}`, error);
      return fallback;
    }
  }

  function createOpaqueId(prefix: string) {
    const randomSuffix = random().toString(36).slice(2, 10) || '00000000';
    return `${prefix}_${now().toString(36)}_${randomSuffix}`;
  }

  return {
    createLifeChangedEvent,
    createLocalMatch,
    createLocalMatchId,
    getOrCreateDeviceId,
    loadLocalMatch,
    markQueuedEventAcked,
    markQueuedEventRetry,
    markQueuedEventRejected,
    markQueuedEventSyncing,
    readOutboxIds,
    readQueuedEvent,
    recordLifeChange,
    saveLocalMatch,
  };
}

function appendUnique<T>(items: T[], item: T) {
  return items.includes(item) ? items : [...items, item];
}

function compareEvents(first: LifeChangedEvent, second: LifeChangedEvent) {
  if (first.localSequence !== second.localSequence) {
    return first.localSequence - second.localSequence;
  }

  return first.createdAt - second.createdAt;
}

function isCurrentLocalMatch(value: unknown): value is LocalMatch {
  if (!value || typeof value !== 'object') return false;

  const candidate = value as LocalMatch;
  return (
    candidate.schemaVersion === LOCAL_MATCH_STORAGE_SCHEMA_VERSION &&
    typeof candidate.matchId === 'string' &&
    Array.isArray(candidate.players) &&
    Array.isArray(candidate.eventIds)
  );
}

function isLifeChangedEvent(value: unknown): value is LifeChangedEvent {
  if (!value || typeof value !== 'object') return false;

  const candidate = value as LifeChangedEvent;
  return (
    candidate.type === 'lifeChanged' &&
    typeof candidate.clientEventId === 'string' &&
    typeof candidate.playerId === 'string'
  );
}

function isMatchPhase(value: unknown): value is MatchPhase {
  return value === 'setup' || value === 'active' || value === 'ended';
}

function isOutboxStatus(status: SyncStatus) {
  return status === 'localOnly' || status === 'pending' || status === 'retry';
}

function isPrototypeKey(value: unknown): value is PrototypeKey {
  return value === 'classic' || value === 'ink' || value === 'glass' || value === 'paper' || value === 'store';
}

function normalizeLegacyEvent(
  event: LifeChangedEvent,
  fallbackMatchId: string,
  fallbackOwnerDeviceId: string,
): LifeChangedEvent | undefined {
  if (!event.clientEventId || !event.playerId) return undefined;

  const delta = numberOr(event.delta, event.nextLife - event.previousLife);
  const previousLife = numberOr(event.previousLife, 0);
  const nextLife = numberOr(event.nextLife, previousLife + delta);

  return {
    type: 'lifeChanged',
    clientEventId: event.clientEventId,
    matchId: stringOr(event.matchId, fallbackMatchId),
    playerId: event.playerId,
    ownerDeviceId: stringOr(event.ownerDeviceId, fallbackOwnerDeviceId),
    delta,
    previousLife,
    nextLife,
    localSequence: numberOr(event.localSequence, 1),
    createdAt: numberOr(event.createdAt, Date.now()),
  };
}

function normalizeLegacyPlayer(
  player: LegacyPlayer,
  index: number,
  fallbackOwnerDeviceId: string,
  fallbackUpdatedAt: number,
): LocalPlayer {
  return {
    playerId: stringOr(player.playerId, stringOr(player.id, `p${index + 1}`)),
    displayName: stringOr(player.displayName, stringOr(player.name, `Player ${index + 1}`)),
    life: numberOr(player.life, DEFAULT_STARTING_LIFE),
    color: stringOr(player.color, '#facc15'),
    ownerDeviceId: stringOr(player.ownerDeviceId, fallbackOwnerDeviceId),
    ownerUserId: player.ownerUserId,
    updatedAt: numberOr(player.updatedAt, fallbackUpdatedAt),
  };
}

function numberOr(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function stringOr(value: unknown, fallback: string) {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}
