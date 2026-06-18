import { describe, expect, test } from 'bun:test';
import {
  lifeChangedEventFingerprint,
  lifeChangedEventsMatch,
  validateLifeChangedEventPayload,
} from '../convex/lib/matchEvent';

const baseEvent = {
  type: 'lifeChanged',
  clientEventId: 'dev_1:1:event_1',
  matchId: 'match_1',
  playerId: 'player_1',
  ownerDeviceId: 'dev_1',
  delta: -1,
  previousLife: 40,
  nextLife: 39,
  localSequence: 1,
  createdAt: 1781750000000,
};

describe('lifeChanged event contract', () => {
  test('fingerprints are stable independent of object key insertion order', () => {
    const reordered = {
      createdAt: baseEvent.createdAt,
      localSequence: baseEvent.localSequence,
      nextLife: baseEvent.nextLife,
      previousLife: baseEvent.previousLife,
      delta: baseEvent.delta,
      ownerDeviceId: baseEvent.ownerDeviceId,
      playerId: baseEvent.playerId,
      matchId: baseEvent.matchId,
      clientEventId: baseEvent.clientEventId,
      type: baseEvent.type,
    };

    expect(lifeChangedEventFingerprint(baseEvent)).toBe(lifeChangedEventFingerprint(reordered));
    expect(lifeChangedEventsMatch(baseEvent, reordered)).toBe(true);
  });

  test('detects duplicate client event ids with different payloads', () => {
    const changed = {
      ...baseEvent,
      delta: -2,
      nextLife: 38,
    };

    expect(lifeChangedEventsMatch(baseEvent, changed)).toBe(false);
  });

  test('validates bounded integer deltas and client life math', () => {
    expect(validateLifeChangedEventPayload(baseEvent, 'match_1')).toBeUndefined();
    expect(
      validateLifeChangedEventPayload(
        {
          ...baseEvent,
          delta: 0,
        },
        'match_1',
      ),
    ).toBe('invalidDelta');
    expect(
      validateLifeChangedEventPayload(
        {
          ...baseEvent,
          nextLife: 12,
        },
        'match_1',
      ),
    ).toBe('invalidDelta');
    expect(
      validateLifeChangedEventPayload(
        {
          ...baseEvent,
          createdAt: 0,
        },
        'match_1',
      ),
    ).toBe('invalidDelta');
    expect(validateLifeChangedEventPayload(baseEvent, 'other_match')).toBe('invalidDelta');
  });
});
