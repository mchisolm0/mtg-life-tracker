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
  startingLife: number;
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
export const DEFAULT_STARTING_LIFE = 40;

export function createLifeChangedEvent({
  delta,
  matchId,
  nextLife,
  playerId,
  previousLife,
}: {
  delta: number;
  matchId?: string;
  nextLife: number;
  playerId: string;
  previousLife: number;
}): LifeEvent {
  const activeMatchId = matchId ?? storage.getString(keys.activeMatchId) ?? DEFAULT_ACTIVE_MATCH_ID;
  const ownerDeviceId = getOrCreateDeviceId();
  const localSequence = nextLocalSequence();
  const createdAt = Date.now();
  const clientEventId = `${ownerDeviceId}:${localSequence}:${createdAt.toString(36)}`;

  return {
    type: 'lifeChanged',
    clientEventId,
    matchId: activeMatchId,
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
      startingLife: parsed.startingLife ?? DEFAULT_STARTING_LIFE,
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
  activeMatchId = DEFAULT_ACTIVE_MATCH_ID,
  events,
  outbox,
  players,
  prototype,
  startingLife = DEFAULT_STARTING_LIFE,
}: Omit<LocalMatchSnapshot, 'activeMatchId' | 'updatedAt'> & {
  activeMatchId?: string;
}): LocalMatchSnapshot {
  return {
    activeMatchId,
    events,
    outbox,
    players,
    prototype,
    startingLife,
    updatedAt: Date.now(),
  };
}

export function createLocalMatchId() {
  return createOpaqueId('local');
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
