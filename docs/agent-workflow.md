# Agent Workflow

Use this workflow for implementation branches after the current branch is merged into `main`.

## Branch flow

1. Create a fresh implementation branch or worktree from the latest `main`.
2. Read `AGENTS.md` and the Expo SDK 56 docs before coding.
3. Implement one small vertical slice.
4. Run the relevant automated checks.
5. Capture visual proof for UI or runtime behavior changes.
6. Start a separate review thread against the implementation diff.
7. Have the implementation thread fix review findings until there are no blocking issues.
8. Open a PR, watch CI and review comments, and keep fixing in the implementation thread.
9. Merge only after checks pass and review findings are resolved.
10. Start the next task from updated `main`.

## Parallel lanes

- Setup/start page and dynamic local match layout can proceed separately from Convex backend work.
- Convex schema and idempotent event mutations can proceed before the client sync worker is complete.
- Sync engine work should wait for the event contract to settle, but type scaffolding can happen earlier.
- Visual refinement should stay separate from backend/sync changes unless a feature requires both.
- Tests and device validation can begin once the event contract and local storage shape are stable.

## Visual proof

For UI changes, include at least one simulator/device screenshot.

For behavior that depends on gestures, restart persistence, native storage, or offline/reconnect, prefer a short screen recording. The proof should show the changed behavior directly, not just the app launching.
