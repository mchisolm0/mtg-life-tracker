import { createMMKV } from 'react-native-mmkv';

export type PrototypeKey = 'classic' | 'ink' | 'glass' | 'paper' | 'store';

export type Player = {
  id: string;
  name: string;
  life: number;
  color: string;
};

export type LifeEvent = {
  type: 'lifeChanged';
  clientEventId: string;
  matchId: string;
  playerId: string;
  delta: number;
  previousLife: number;
  nextLife: number;
  localSequence: number;
  ownerDeviceId: string;
  createdAt: number;
};

export type QueuedLifeEvent = {
  event: LifeEvent;
  status: 'pending';
};

export type LocalMatchSnapshot = {
  activeMatchId: string;
  prototype: PrototypeKey;
  players: Player[];
  events: LifeEvent[];
  outbox: QueuedLifeEvent[];
  updatedAt: number;
};

const storage = createMMKV({ id: 'mana-ledger.local-match' });

const keys = {
  activeMatchId: 'mana-ledger:activeMatchId',
  deviceId: 'mana-ledger:deviceId',
  match: (matchId: string) => `mana-ledger:match:${matchId}`,
  outbox: (matchId: string) => `mana-ledger:outbox:${matchId}`,
  sequence: 'mana-ledger:localSequence',
};

const DEFAULT_ACTIVE_MATCH_ID = 'local-default-match';

export function createLifeChangedEvent({
  delta,
  nextLife,
  playerId,
  previousLife,
}: {
  delta: number;
  nextLife: number;
  playerId: string;
  previousLife: number;
}): LifeEvent {
  const matchId = storage.getString(keys.activeMatchId) ?? DEFAULT_ACTIVE_MATCH_ID;
  const ownerDeviceId = getOrCreateDeviceId();
  const localSequence = nextLocalSequence();
  const createdAt = Date.now();
  const clientEventId = `${ownerDeviceId}:${localSequence}:${createdAt.toString(36)}`;

  return {
    type: 'lifeChanged',
    clientEventId,
    matchId,
    playerId,
    delta,
    previousLife,
    nextLife,
    localSequence,
    ownerDeviceId,
    createdAt,
  };
}

export function loadLocalMatch(): LocalMatchSnapshot | undefined {
  const activeMatchId = storage.getString(keys.activeMatchId) ?? DEFAULT_ACTIVE_MATCH_ID;
  const rawMatch = storage.getString(keys.match(activeMatchId));

  if (!rawMatch) return undefined;

  try {
    const parsed = JSON.parse(rawMatch) as LocalMatchSnapshot;
    return {
      ...parsed,
      activeMatchId,
      outbox: readJson<QueuedLifeEvent[]>(keys.outbox(activeMatchId), parsed.outbox ?? []),
    };
  } catch (error) {
    console.warn('Could not parse local MMKV match', error);
    return undefined;
  }
}

export function saveLocalMatch(snapshot: LocalMatchSnapshot) {
  storage.set(keys.activeMatchId, snapshot.activeMatchId);
  storage.set(keys.match(snapshot.activeMatchId), JSON.stringify(snapshot));
  storage.set(keys.outbox(snapshot.activeMatchId), JSON.stringify(snapshot.outbox));
}

export function createLocalMatchSnapshot({
  events,
  outbox,
  players,
  prototype,
}: Omit<LocalMatchSnapshot, 'activeMatchId' | 'updatedAt'>): LocalMatchSnapshot {
  return {
    activeMatchId: DEFAULT_ACTIVE_MATCH_ID,
    events,
    outbox,
    players,
    prototype,
    updatedAt: Date.now(),
  };
}

function readJson<T>(key: string, fallback: T): T {
  const raw = storage.getString(key);
  if (!raw) return fallback;

  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    console.warn(`Could not parse MMKV value for ${key}`, error);
    return fallback;
  }
}

function getOrCreateDeviceId() {
  const savedDeviceId = storage.getString(keys.deviceId);
  if (savedDeviceId) return savedDeviceId;

  const deviceId = createOpaqueId('dev');
  storage.set(keys.deviceId, deviceId);
  return deviceId;
}

function nextLocalSequence() {
  const sequence = (storage.getNumber(keys.sequence) ?? 0) + 1;
  storage.set(keys.sequence, sequence);
  return sequence;
}

function createOpaqueId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
