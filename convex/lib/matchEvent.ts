export type RejectionReason =
  | 'duplicateClientEventId'
  | 'invalidDelta'
  | 'matchEnded'
  | 'notOwner'
  | 'playerMissing';

export type LifeChangedEventPayload = {
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

const MAX_LIFE_DELTA = 100;

export function validateLifeChangedEventPayload(
  event: LifeChangedEventPayload,
  expectedMatchId: string,
): RejectionReason | undefined {
  if (
    event.type !== 'lifeChanged' ||
    !event.clientEventId ||
    !event.matchId ||
    !event.playerId ||
    !event.ownerDeviceId ||
    event.matchId !== expectedMatchId
  ) {
    return 'invalidDelta';
  }

  if (!Number.isInteger(event.delta) || event.delta === 0 || Math.abs(event.delta) > MAX_LIFE_DELTA) {
    return 'invalidDelta';
  }

  if (
    !Number.isInteger(event.previousLife) ||
    !Number.isInteger(event.nextLife) ||
    event.previousLife + event.delta !== event.nextLife
  ) {
    return 'invalidDelta';
  }

  if (
    !Number.isInteger(event.localSequence) ||
    event.localSequence < 1 ||
    !Number.isInteger(event.createdAt) ||
    event.createdAt < 1
  ) {
    return 'invalidDelta';
  }

  return undefined;
}

export function lifeChangedEventFingerprint(event: LifeChangedEventPayload) {
  return JSON.stringify({
    clientEventId: event.clientEventId,
    createdAt: event.createdAt,
    delta: event.delta,
    localSequence: event.localSequence,
    matchId: event.matchId,
    nextLife: event.nextLife,
    ownerDeviceId: event.ownerDeviceId,
    playerId: event.playerId,
    previousLife: event.previousLife,
    type: event.type,
  });
}

export function lifeChangedEventsMatch(
  left: LifeChangedEventPayload,
  right: LifeChangedEventPayload,
) {
  return lifeChangedEventFingerprint(left) === lifeChangedEventFingerprint(right);
}
