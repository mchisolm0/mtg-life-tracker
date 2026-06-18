import { describe, expect, test } from 'bun:test';
import { getFunctionName } from 'convex/server';
import { createConvexHttpMatchApi, createConvexMatchApi } from '../src/sync/convexMatchApi.ts';

describe('Convex match API adapter', () => {
  test('maps sync calls to the expected Convex mutations', async () => {
    const calls = [];
    const api = createConvexMatchApi({
      mutation: async (reference, args) => {
        const name = getFunctionName(reference);
        calls.push({ args, name });

        if (name === 'matches:createOrResume') {
          return {
            match: createCanonicalMatch(),
            serverTime: 5000,
          };
        }

        if (name === 'matches:submitLifeEvent') {
          return {
            accepted: true,
            canonicalMatch: createCanonicalMatch({ p1Life: 39, version: 1 }),
            clientEventId: args.event.clientEventId,
            eventId: 'event_remote_1',
            serverSequence: 1,
          };
        }

        throw new Error(`Unexpected mutation ${name}`);
      },
    });

    const created = await api.createOrResume({
      deviceId: 'dev_1',
      localMatchId: 'local_1',
      players: [createPlayer('p1'), createPlayer('p2')],
      startingLife: 40,
    });
    const submitted = await api.submitLifeEvent({
      event: createLifeEvent(),
      matchId: 'match_remote_1',
    });

    expect(created.match._id).toBe('match_remote_1');
    expect(submitted).toMatchObject({
      accepted: true,
      clientEventId: 'event_1',
      eventId: 'event_remote_1',
    });
    expect(calls).toEqual([
      {
        args: {
          deviceId: 'dev_1',
          localMatchId: 'local_1',
          players: [createPlayer('p1'), createPlayer('p2')],
          startingLife: 40,
        },
        name: 'matches:createOrResume',
      },
      {
        args: {
          event: createLifeEvent(),
          matchId: 'match_remote_1',
        },
        name: 'matches:submitLifeEvent',
      },
    ]);
  });

  test('rejects blank Convex deployment URLs before creating an HTTP client', () => {
    expect(() => createConvexHttpMatchApi('  ')).toThrow('Convex deployment URL is required');
  });
});

function createCanonicalMatch({ p1Life = 40, version = 0 } = {}) {
  return {
    _id: 'match_remote_1',
    localMatchId: 'local_1',
    phase: 'active',
    players: [
      { ...createPlayer('p1'), life: p1Life, updatedAt: 5000 },
      { ...createPlayer('p2'), life: 40, updatedAt: 5000 },
    ],
    startingLife: 40,
    updatedAt: 5000,
    version,
  };
}

function createLifeEvent() {
  return {
    type: 'lifeChanged',
    clientEventId: 'event_1',
    matchId: 'match_remote_1',
    playerId: 'p1',
    ownerDeviceId: 'dev_1',
    delta: -1,
    previousLife: 40,
    nextLife: 39,
    localSequence: 1,
    createdAt: 1000,
  };
}

function createPlayer(playerId) {
  return {
    color: '#facc15',
    displayName: playerId,
    ownerDeviceId: 'dev_1',
    playerId,
  };
}
