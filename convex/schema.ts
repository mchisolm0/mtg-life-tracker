import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

const matchPhase = v.union(v.literal('setup'), v.literal('active'), v.literal('ended'));

const player = v.object({
  color: v.optional(v.string()),
  displayName: v.string(),
  life: v.number(),
  ownerDeviceId: v.string(),
  ownerUserId: v.optional(v.string()),
  playerId: v.string(),
  updatedAt: v.number(),
});

export default defineSchema({
  matchEvents: defineTable({
    acceptedAt: v.number(),
    canonicalPlayerLife: v.number(),
    clientEventId: v.string(),
    createdAt: v.number(),
    delta: v.number(),
    localSequence: v.number(),
    matchId: v.id('matches'),
    matchVersion: v.number(),
    nextLife: v.number(),
    ownerDeviceId: v.string(),
    payloadFingerprint: v.string(),
    playerId: v.string(),
    previousLife: v.number(),
    serverSequence: v.number(),
    type: v.literal('lifeChanged'),
  })
    .index('by_clientEventId', ['clientEventId'])
    .index('by_matchId_serverSequence', ['matchId', 'serverSequence']),

  matches: defineTable({
    createdAt: v.number(),
    creatingDeviceId: v.string(),
    localMatchId: v.optional(v.string()),
    nextServerSequence: v.number(),
    phase: matchPhase,
    players: v.array(player),
    startingLife: v.number(),
    updatedAt: v.number(),
    version: v.number(),
  })
    .index('by_localMatchId', ['localMatchId'])
    .index('by_creatingDeviceId', ['creatingDeviceId']),
});
