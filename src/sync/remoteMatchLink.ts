import {
  isLocalOnlyMatch,
  type LocalMatch,
  type LocalPlayer,
  type RemoteMatchSnapshot,
} from '../storage/localMatchStoreCore';

export type CreateOrResumeRemoteMatchArgs = {
  deviceId: string;
  localMatchId: string;
  players: Array<Pick<LocalPlayer, 'color' | 'displayName' | 'ownerDeviceId' | 'ownerUserId' | 'playerId'>>;
  startingLife: number;
};

export type RemoteMatchLinkApi = {
  createOrResume: (args: CreateOrResumeRemoteMatchArgs) => Promise<{
    match: RemoteMatchSnapshot;
    serverTime: number;
  }>;
};

export type RemoteMatchLinkStore = {
  getOrCreateDeviceId: () => string;
  linkLocalMatchToRemote: (match: RemoteMatchSnapshot) => LocalMatch | undefined;
  loadLocalMatch: () => LocalMatch | undefined;
};

export type EnsureRemoteMatchLinkResult =
  | {
      match?: undefined;
      status: 'noMatch';
    }
  | {
      match: LocalMatch;
      status: 'alreadyRemote' | 'linked';
    };

export async function ensureRemoteMatchLink({
  api,
  store,
}: {
  api: RemoteMatchLinkApi;
  store: RemoteMatchLinkStore;
}): Promise<EnsureRemoteMatchLinkResult> {
  const match = store.loadLocalMatch();
  if (!match) {
    return { status: 'noMatch' };
  }

  if (!isLocalOnlyMatch(match)) {
    return { match, status: 'alreadyRemote' };
  }

  const localMatchId = match.localMatchId ?? match.matchId;
  const response = await api.createOrResume({
    deviceId: store.getOrCreateDeviceId(),
    localMatchId,
    players: match.players.map((player) => ({
      color: player.color,
      displayName: player.displayName,
      ownerDeviceId: player.ownerDeviceId,
      ownerUserId: player.ownerUserId,
      playerId: player.playerId,
    })),
    startingLife: match.startingLife,
  });
  const linkedMatch = store.linkLocalMatchToRemote(response.match);

  if (!linkedMatch) {
    throw new Error('Remote match link did not return a linked match.');
  }

  return {
    match: linkedMatch,
    status: 'linked',
  };
}
