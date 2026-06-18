import * as localMatchStore from '../storage/localMatchStore';
import { createConvexHttpMatchApi } from './convexMatchApi';
import { createMatchSyncRuntime } from './matchSyncRuntimeCore';

export type { MatchSyncRuntimeSnapshot, MatchSyncRuntimeStatus } from './matchSyncRuntimeCore';

const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL?.trim();

export const matchSyncRuntime = createMatchSyncRuntime({
  createApi: convexUrl ? () => createConvexHttpMatchApi(convexUrl) : undefined,
  store: localMatchStore,
});
