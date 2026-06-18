import type {
  LifeChangedEvent,
  LocalMatch,
  LocalQueuedEvent,
  MatchPhase,
  RejectionReason,
} from '../storage/localMatchStoreCore';
import { isLocalOnlyMatch } from '../storage/localMatchStoreCore';

export type CanonicalPlayerSnapshot = {
  color?: string;
  displayName: string;
  life: number;
  ownerDeviceId: string;
  ownerUserId?: string;
  playerId: string;
  updatedAt: number;
};

export type CanonicalMatchSnapshot = {
  _id?: string;
  matchId?: string;
  localMatchId?: string;
  phase: MatchPhase;
  players: CanonicalPlayerSnapshot[];
  startingLife: number;
  updatedAt: number;
  version?: number;
};

export type SubmitLifeEventResult =
  | {
      accepted: true;
      canonicalMatch: CanonicalMatchSnapshot;
      clientEventId: string;
      eventId: string;
      matchVersion?: number;
      serverSequence: number;
    }
  | {
      accepted: false;
      canonicalMatch: CanonicalMatchSnapshot;
      clientEventId: string;
      reason: RejectionReason;
    };

export type MatchSyncApi = {
  submitLifeEvent: (args: { event: LifeChangedEvent; matchId: string }) => Promise<SubmitLifeEventResult>;
};

export type MatchOutboxStore = {
  loadLocalMatch: () => LocalMatch | undefined;
  markQueuedEventAcked: (args: {
    acknowledgedAt?: number;
    clientEventId: string;
    convexEventId?: string;
  }) => LocalQueuedEvent | undefined;
  markQueuedEventRejected: (args: {
    clientEventId: string;
    rejectedAt?: number;
    rejectionReason: RejectionReason;
  }) => LocalQueuedEvent | undefined;
  markQueuedEventRetry: (args: {
    clientEventId: string;
    lastAttemptAt?: number;
    nextAttemptAt: number;
  }) => LocalQueuedEvent | undefined;
  markQueuedEventSyncing: (args: {
    clientEventId: string;
    lastAttemptAt?: number;
  }) => LocalQueuedEvent | undefined;
  readOutboxIds: () => string[];
  readQueuedEvent: (clientEventId: string) => LocalQueuedEvent | undefined;
  saveLocalMatch: (match: LocalMatch) => void;
};

export type FlushMatchOutboxResult = {
  accepted: number;
  failedTransient: number;
  rejected: number;
  skipped: number;
  submitted: number;
};

export type FlushMatchOutboxOptions = {
  api: MatchSyncApi;
  limit?: number;
  now?: () => number;
  random?: () => number;
  store: MatchOutboxStore;
};

const DEFAULT_FLUSH_LIMIT = 10;
export async function flushMatchOutbox({
  api,
  limit = DEFAULT_FLUSH_LIMIT,
  now = Date.now,
  random = Math.random,
  store,
}: FlushMatchOutboxOptions): Promise<FlushMatchOutboxResult> {
  const result: FlushMatchOutboxResult = {
    accepted: 0,
    failedTransient: 0,
    rejected: 0,
    skipped: 0,
    submitted: 0,
  };
  const match = store.loadLocalMatch();

  if (!match || isLocalOnlyMatch(match)) {
    result.skipped = store.readOutboxIds().length;
    return result;
  }

  for (const clientEventId of store.readOutboxIds()) {
    if (result.submitted >= limit) break;

    const queuedEvent = store.readQueuedEvent(clientEventId);
    if (!isEligibleForFlush(queuedEvent, match, now())) {
      result.skipped += 1;
      break;
    }

    const syncingEvent = store.markQueuedEventSyncing({
      clientEventId,
      lastAttemptAt: now(),
    });
    if (!syncingEvent) {
      result.skipped += 1;
      continue;
    }

    try {
      result.submitted += 1;
      const response = await api.submitLifeEvent({
        event: syncingEvent.event,
        matchId: match.matchId,
      });
      if (response.clientEventId !== clientEventId) {
        throw new Error('Sync response clientEventId did not match the submitted event.');
      }

      if (response.accepted) {
        store.markQueuedEventAcked({
          acknowledgedAt: now(),
          clientEventId: response.clientEventId,
          convexEventId: response.eventId,
        });
        reconcileLocalMatchFromCanonical({
          canonicalMatch: response.canonicalMatch,
          currentMatch: match,
          store,
        });
        result.accepted += 1;
      } else {
        store.markQueuedEventRejected({
          clientEventId: response.clientEventId,
          rejectedAt: now(),
          rejectionReason: response.reason,
        });
        reconcileLocalMatchFromCanonical({
          canonicalMatch: response.canonicalMatch,
          currentMatch: match,
          store,
        });
        result.rejected += 1;
      }
    } catch {
      const failedEvent = store.readQueuedEvent(clientEventId) ?? syncingEvent;
      const failedAt = now();
      store.markQueuedEventRetry({
        clientEventId,
        lastAttemptAt: failedAt,
        nextAttemptAt: failedAt + retryDelayMs(failedEvent.attempts, random),
      });
      result.failedTransient += 1;
      break;
    }
  }

  return result;
}

export function retryDelayMs(attempts: number, random = Math.random) {
  const attemptIndex = Math.max(0, attempts - 1);
  const baseDelay = Math.min(30_000, 1_000 * 2 ** attemptIndex);
  const jitter = Math.floor(baseDelay * 0.25 * random());

  return Math.min(30_000, baseDelay + jitter);
}

export function reconcileLocalMatchFromCanonical({
  canonicalMatch,
  currentMatch,
  store,
}: {
  canonicalMatch: CanonicalMatchSnapshot;
  currentMatch: LocalMatch;
  store: Pick<MatchOutboxStore, 'readOutboxIds' | 'readQueuedEvent' | 'saveLocalMatch'>;
}) {
  const localPlayersById = new Map(currentMatch.players.map((player) => [player.playerId, player]));
  const reconciledMatch: LocalMatch = {
    ...currentMatch,
    lastServerVersion: canonicalMatch.version ?? currentMatch.lastServerVersion,
    localMatchId: currentMatch.localMatchId ?? canonicalMatch.localMatchId,
    matchId: canonicalMatch._id ?? canonicalMatch.matchId ?? currentMatch.matchId,
    phase: canonicalMatch.phase,
    players: canonicalMatch.players.map((player) => {
      const localPlayer = localPlayersById.get(player.playerId);

      return {
        color: player.color ?? localPlayer?.color ?? '#facc15',
        displayName: player.displayName,
        life: player.life,
        ownerDeviceId: player.ownerDeviceId,
        ownerUserId: player.ownerUserId,
        playerId: player.playerId,
        updatedAt: player.updatedAt,
      };
    }),
    startingLife: canonicalMatch.startingLife,
    updatedAt: canonicalMatch.updatedAt,
  };

  for (const clientEventId of store.readOutboxIds()) {
    const queuedEvent = store.readQueuedEvent(clientEventId);
    if (!queuedEvent || queuedEvent.event.matchId !== currentMatch.matchId) continue;
    if (!isOptimisticOverlayStatus(queuedEvent.status)) continue;

    const playerIndex = reconciledMatch.players.findIndex(
      (player) => player.playerId === queuedEvent.event.playerId,
    );
    if (playerIndex < 0) continue;

    const player = reconciledMatch.players[playerIndex];
    reconciledMatch.players[playerIndex] = {
      ...player,
      life: player.life + queuedEvent.event.delta,
      updatedAt: Math.max(player.updatedAt, queuedEvent.event.createdAt),
    };
  }

  store.saveLocalMatch(reconciledMatch);

  return reconciledMatch;
}

function isEligibleForFlush(
  queuedEvent: LocalQueuedEvent | undefined,
  match: LocalMatch,
  currentTime: number,
) {
  if (!queuedEvent) return false;
  if (queuedEvent.event.matchId !== match.matchId) return false;
  if (queuedEvent.status === 'pending') return true;
  if (queuedEvent.status !== 'retry') return false;

  return !queuedEvent.nextAttemptAt || queuedEvent.nextAttemptAt <= currentTime;
}

function isOptimisticOverlayStatus(status: LocalQueuedEvent['status']) {
  return status === 'localOnly' || status === 'pending' || status === 'retry' || status === 'syncing';
}
