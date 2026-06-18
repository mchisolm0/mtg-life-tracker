import { ConvexError, v, type Infer } from 'convex/values';
import { mutationGeneric as mutation, queryGeneric as query } from 'convex/server';
import {
  lifeChangedEventFingerprint,
  lifeChangedEventsMatch,
  type LifeChangedEventPayload,
  type RejectionReason,
  validateLifeChangedEventPayload,
} from './lib/matchEvent';

const playerInput = v.object({
  color: v.optional(v.string()),
  displayName: v.string(),
  ownerDeviceId: v.string(),
  ownerUserId: v.optional(v.string()),
  playerId: v.string(),
});

const lifeChangedEventInput = v.object({
  type: v.literal('lifeChanged'),
  clientEventId: v.string(),
  matchId: v.string(),
  playerId: v.string(),
  ownerDeviceId: v.string(),
  delta: v.number(),
  previousLife: v.number(),
  nextLife: v.number(),
  localSequence: v.number(),
  createdAt: v.number(),
});

type CanonicalPlayer = {
  color?: string;
  displayName: string;
  life: number;
  ownerDeviceId: string;
  ownerUserId?: string;
  playerId: string;
  updatedAt: number;
};

type CanonicalMatch = {
  _id: string;
  createdAt: number;
  creatingDeviceId: string;
  localMatchId?: string;
  nextServerSequence: number;
  phase: 'setup' | 'active' | 'ended';
  players: CanonicalPlayer[];
  startingLife: number;
  updatedAt: number;
  version: number;
};

type AcceptedLifeEvent = LifeChangedEventPayload & {
  _id: string;
  acceptedAt: number;
  canonicalPlayerLife: number;
  matchVersion: number;
  payloadFingerprint: string;
  serverSequence: number;
};
type PlayerInput = Infer<typeof playerInput>;

export const createOrResume = mutation({
  args: {
    deviceId: v.string(),
    localMatchId: v.optional(v.string()),
    players: v.array(playerInput),
    startingLife: v.number(),
  },
  handler: async (ctx, args) => {
    assertNonEmptyString(args.deviceId, 'deviceId');
    if (args.localMatchId !== undefined) {
      assertNonEmptyString(args.localMatchId, 'localMatchId');
    }
    assertStartingLife(args.startingLife);
    assertPlayerInputs(args.players);

    if (args.localMatchId) {
      const existing = await ctx.db
        .query('matches')
        .withIndex('by_localMatchId', (q) => q.eq('localMatchId', args.localMatchId))
        .unique();

      if (existing) {
        return {
          match: existing,
          serverTime: Date.now(),
        };
      }
    }

    const now = Date.now();
    const matchId = await ctx.db.insert('matches', {
      createdAt: now,
      creatingDeviceId: args.deviceId,
      localMatchId: args.localMatchId,
      nextServerSequence: 1,
      phase: 'active',
      players: args.players.map((player) => ({
        color: player.color,
        displayName: player.displayName,
        life: args.startingLife,
        ownerDeviceId: player.ownerDeviceId,
        ownerUserId: player.ownerUserId,
        playerId: player.playerId,
        updatedAt: now,
      })),
      startingLife: args.startingLife,
      updatedAt: now,
      version: 0,
    });

    return {
      match: await readMatchOrThrow(ctx, matchId),
      serverTime: now,
    };
  },
});

export const getActive = query({
  args: {
    matchId: v.id('matches'),
  },
  handler: async (ctx, args) => {
    const match = await readMatchOrThrow(ctx, args.matchId);
    const recentEvents = await ctx.db
      .query('matchEvents')
      .withIndex('by_matchId_serverSequence', (q) => q.eq('matchId', args.matchId))
      .order('desc')
      .take(50);

    return {
      match,
      recentEvents: recentEvents.reverse(),
    };
  },
});

export const submitLifeEvent = mutation({
  args: {
    event: lifeChangedEventInput,
    matchId: v.id('matches'),
  },
  handler: async (ctx, args) => {
    const match = await readMatchOrThrow(ctx, args.matchId);
    const event = args.event;
    const validationReason = validateLifeChangedEventPayload(event, args.matchId);
    if (validationReason) {
      return rejectedResult(event.clientEventId, validationReason, match);
    }

    const existingEvent = await ctx.db
      .query('matchEvents')
      .withIndex('by_clientEventId', (q) => q.eq('clientEventId', event.clientEventId))
      .unique();

    if (existingEvent) {
      return duplicateEventResult(existingEvent, event, match);
    }

    if (match.phase === 'ended') {
      return rejectedResult(event.clientEventId, 'matchEnded', match);
    }

    const playerIndex = match.players.findIndex((player) => player.playerId === event.playerId);
    if (playerIndex < 0) {
      return rejectedResult(event.clientEventId, 'playerMissing', match);
    }

    const player = match.players[playerIndex];
    if (player.ownerDeviceId !== event.ownerDeviceId) {
      return rejectedResult(event.clientEventId, 'notOwner', match);
    }
    if (player.ownerUserId) {
      const identity = await ctx.auth.getUserIdentity();
      if (!identityMatchesOwner(identity, player.ownerUserId)) {
        return rejectedResult(event.clientEventId, 'notOwner', match);
      }
    }

    const now = Date.now();
    const serverSequence = match.nextServerSequence;
    const canonicalPlayerLife = player.life + event.delta;
    const matchVersion = match.version + 1;
    const updatedPlayers = match.players.map((candidate, index) =>
      index === playerIndex
        ? {
            ...candidate,
            life: canonicalPlayerLife,
            updatedAt: now,
          }
        : candidate,
    );

    const eventId = await ctx.db.insert('matchEvents', {
      acceptedAt: now,
      canonicalPlayerLife,
      clientEventId: event.clientEventId,
      createdAt: event.createdAt,
      delta: event.delta,
      localSequence: event.localSequence,
      matchId: args.matchId,
      matchVersion,
      nextLife: event.nextLife,
      ownerDeviceId: event.ownerDeviceId,
      payloadFingerprint: lifeChangedEventFingerprint(event),
      playerId: event.playerId,
      previousLife: event.previousLife,
      serverSequence,
      type: 'lifeChanged',
    });

    await ctx.db.patch(args.matchId, {
      nextServerSequence: serverSequence + 1,
      players: updatedPlayers,
      updatedAt: now,
      version: matchVersion,
    });

    return {
      accepted: true as const,
      canonicalMatch: await readMatchOrThrow(ctx, args.matchId),
      canonicalPlayerLife,
      clientEventId: event.clientEventId,
      eventId,
      matchVersion,
      serverSequence,
    };
  },
});

function duplicateEventResult(
  existingEvent: AcceptedLifeEvent,
  event: LifeChangedEventPayload,
  match: CanonicalMatch,
) {
  if (lifeChangedEventsMatch(existingEvent, event)) {
    return {
      accepted: true as const,
      canonicalMatch: match,
      canonicalPlayerLife: existingEvent.canonicalPlayerLife,
      clientEventId: existingEvent.clientEventId,
      eventId: existingEvent._id,
      matchVersion: existingEvent.matchVersion,
      serverSequence: existingEvent.serverSequence,
    };
  }

  return rejectedResult(event.clientEventId, 'duplicateClientEventId', match);
}

function rejectedResult(
  clientEventId: string,
  reason: RejectionReason,
  canonicalMatch: CanonicalMatch,
) {
  return {
    accepted: false as const,
    canonicalMatch,
    clientEventId,
    reason,
  };
}

async function readMatchOrThrow(
  ctx: { db: { get: (...args: any[]) => Promise<unknown> } },
  matchId: string,
) {
  const match = (await ctx.db.get(matchId)) as CanonicalMatch | null;
  if (!match) {
    throw new ConvexError({ code: 'matchMissing', matchId });
  }

  return match;
}

function assertPlayerInputs(players: PlayerInput[]) {
  if (players.length < 2 || players.length > 6) {
    throw new ConvexError({ code: 'invalidPlayerCount', count: players.length });
  }

  const playerIds = new Set<string>();

  for (const player of players) {
    assertNonEmptyString(player.playerId, 'playerId');
    assertNonEmptyString(player.displayName, 'displayName');
    assertNonEmptyString(player.ownerDeviceId, 'ownerDeviceId');

    if (playerIds.has(player.playerId)) {
      throw new ConvexError({ code: 'duplicatePlayerId', playerId: player.playerId });
    }

    playerIds.add(player.playerId);
  }
}

function assertStartingLife(startingLife: number) {
  if (!Number.isInteger(startingLife) || startingLife < 1 || startingLife > 999) {
    throw new ConvexError({ code: 'invalidStartingLife', startingLife });
  }
}

function assertNonEmptyString(value: string, field: string) {
  if (!value.trim()) {
    throw new ConvexError({ code: 'emptyString', field });
  }
}

function identityMatchesOwner(identity: unknown, ownerUserId: string) {
  if (!identity || typeof identity !== 'object') return false;

  const candidate = identity as {
    subject?: unknown;
    tokenIdentifier?: unknown;
  };

  return candidate.tokenIdentifier === ownerUserId || candidate.subject === ownerUserId;
}
