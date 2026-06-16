import { createMMKV } from 'react-native-mmkv';

export type PrototypeKey = 'classic' | 'ink' | 'glass' | 'paper' | 'store';

export type Player = {
  id: string;
  name: string;
  life: number;
  color: string;
};

export type LifeEvent = {
  id: string;
  playerId: string;
  delta: number;
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
  match: (matchId: string) => `mana-ledger:match:${matchId}`,
  outbox: (matchId: string) => `mana-ledger:outbox:${matchId}`,
};

const DEFAULT_ACTIVE_MATCH_ID = 'local-default-match';

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
