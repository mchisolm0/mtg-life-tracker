# Mana Ledger — MTG Life Tracker

React Native + Expo prototype for tracking life totals in games like Magic: The Gathering.

## What is built

- Expo SDK 56 / React Native 0.85 TypeScript app.
- Five toggleable visual prototypes:
  1. **Arena Command** — high-contrast table dashboard.
  2. **Neon Stack** — arcade-inspired glowing controls.
  3. **Spellbook** — warm parchment/fantasy style.
  4. **Quiet Match** — minimal, battery-friendly UI.
  5. **Store Ops** — tournament/store operation concept.
- Four-player Commander-style starting state.
- Fast life controls: `-5`, `-1`, `+1`, `+5`.
- Poison and commander damage counters.
- Local-first MVP persistence with `@react-native-async-storage/async-storage`.
- Local event log for life changes as the future sync primitive.

## Run

```bash
bun install
bun run ios
bun run web
```

If Metro port `8081` is already taken, run:

```bash
bunx expo start --web --port 8083
bunx expo start --ios --port 8082
```

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

1. Promote the current AsyncStorage event log to SQLite (`expo-sqlite`) once match history/querying grows.
2. Model match updates as append-only events: `matchCreated`, `lifeChanged`, `poisonChanged`, `commanderDamageChanged`, `matchEnded`.
3. Keep derived current totals in UI state for instant taps.
4. Add a durable outbox table for sync retries.
5. Pick backend path after testing:
   - Convex + custom event outbox if Convex developer experience wins.
   - PowerSync + Supabase/Postgres if offline tournament operations become the dominant requirement.

## Tournament feature direction

Future store mode should cover:

- Event registration/check-in.
- Pairings, pods, table assignments.
- Round timer and table display.
- Player self-reporting.
- Judge/admin overrides.
- Standings and exports.
- Offline resilience for venues.
