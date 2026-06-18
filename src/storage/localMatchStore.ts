import { createMMKV } from 'react-native-mmkv';
import { createLocalMatchStore } from './localMatchStoreCore';

export * from './localMatchStoreCore';

const storage = createMMKV({ id: 'mana-ledger.local-match' });
const localMatchStore = createLocalMatchStore(storage);

export const createLifeChangedEvent = localMatchStore.createLifeChangedEvent;
export const createLocalMatch = localMatchStore.createLocalMatch;
export const createLocalMatchId = localMatchStore.createLocalMatchId;
export const getOrCreateDeviceId = localMatchStore.getOrCreateDeviceId;
export const loadLocalMatch = localMatchStore.loadLocalMatch;
export const markQueuedEventAcked = localMatchStore.markQueuedEventAcked;
export const markQueuedEventRejected = localMatchStore.markQueuedEventRejected;
export const readOutboxIds = localMatchStore.readOutboxIds;
export const readQueuedEvent = localMatchStore.readQueuedEvent;
export const recordLifeChange = localMatchStore.recordLifeChange;
export const saveLocalMatch = localMatchStore.saveLocalMatch;
