# Mana Ledger — MTG Life Tracker

React Native + Expo prototype for tracking life totals in games like Magic: The Gathering.

## What is built

- Expo SDK 56 / React Native 0.85 TypeScript app.
- Minimal four-player Commander-style game table.
- Screen-filling player panels with large invisible tap zones.
- Fast life controls: tap the top half of a panel for `+1`, bottom half for `-1`.
- Tiny center affordance: tap to cycle visual themes, long-press to reset the local match to 40 life.
- Local-first MVP persistence with `react-native-mmkv`.
- Accepted MVP sync architecture: MMKV local/offline store + Convex remote source of truth + optimistic life-change events.

## Run

This app uses native code through `react-native-mmkv`, so Expo Go is not a supported runtime. Use a development build.

```bash
bun install
bun run ios
bun run android
```

Start Metro for an installed development build:

```bash
bun start
```

Web is still useful for quick layout checks, but native simulator/device validation is required before merging changes that touch storage or runtime behavior.

```bash
bun run web
```

## Build scripts

```bash
bun run prebuild:clean
bun run build:ios:sim
bun run build:ios:dev
bun run build:android:dev
```

## Verify

```bash
bun run typecheck
bun run doctor
bun run export:web
```

For UI or runtime changes, capture a simulator/device screenshot or short screen recording and include it in the handoff or PR. Prefer a recording when validating gestures, MMKV persistence after restart, or offline/reconnect behavior.

## Sync architecture decision

The accepted MVP sync decision is documented in [`docs/mvp-sync-architecture.md`](docs/mvp-sync-architecture.md): MMKV is the local/offline store, Convex is the remote source of truth, life taps update optimistically, every life change uses a `clientEventId`, and only the owning player/device can modify that player's score.

## Research summary

### Convex

Convex is a strong candidate for realtime server-backed state, authenticated backend logic, tournament records, and server-authoritative sync. It supports Expo/React Native and has realtime query subscriptions, queued mutations during network blips, and optimistic updates.

Important caveat: Convex alone is not currently a full durable local-first/offline-first mobile database. The app should keep match state local-first and sync a durable event stream later.

Recommended Convex shape if chosen:

- Device records every match action locally with idempotent event IDs.
- App flushes unsynced events to Convex mutations when online.
- Convex stores canonical shared/tournament state and broadcasts realtime updates.
- Active match UI never depends on network availability.

### Other sync options

- **PowerSync + Supabase/Postgres**: strongest current fit for offline relational data and tournament operations.
- **Supabase Realtime Broadcast/Presence + local SQLite/AsyncStorage**: good for live match-room/player presence and fast life updates when online.
- **Legend-State + Supabase**: lightweight option for simpler synced state.
- **WatermelonDB/RxDB**: powerful but more custom backend/sync complexity.
- **Electric/TanStack DB and LiveStore**: promising, but less turnkey for production mobile offline writes today.
- **Realm Atlas Device Sync**: avoid for new sync work because it is deprecated/EOL.

## Suggested next architecture

For the active match engine:

1. Use MMKV as the local/offline store for active match state and the sync outbox.
2. Model match updates as append-only events, starting with `lifeChanged` for MVP.
3. Keep derived current totals in UI state for instant optimistic taps.
4. Flush a durable MMKV outbox to idempotent Convex mutations keyed by `clientEventId`.
5. Treat Convex as the canonical remote source of truth and reconcile local state from realtime snapshots.
6. Consider SQLite or a richer local database later if match history/querying outgrows MMKV.

## Tournament feature direction

Future store mode should cover:

- Event registration/check-in.
- Pairings, pods, table assignments.
- Round timer and table display.
- Player self-reporting.
- Judge/admin overrides.
- Standings and exports.
- Offline resilience for venues.
