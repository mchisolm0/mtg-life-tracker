import { ConvexHttpClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';
import type { LifeChangedEvent, RemoteMatchSnapshot } from '../storage/localMatchStoreCore';
import type { MatchSyncApi, SubmitLifeEventResult } from './matchOutboxSync';
import type { CreateOrResumeRemoteMatchArgs, RemoteMatchLinkApi } from './remoteMatchLink';

export type CreateOrResumeRemoteMatchResult = {
  match: RemoteMatchSnapshot;
  serverTime: number;
};

export type SubmitLifeEventArgs = {
  event: LifeChangedEvent;
  matchId: string;
};

export type ConvexMatchApi = MatchSyncApi & RemoteMatchLinkApi;

export type ConvexMatchMutationClient = Pick<ConvexHttpClient, 'mutation'>;

export const createOrResumeMatchMutation = makeFunctionReference<
  'mutation',
  CreateOrResumeRemoteMatchArgs,
  CreateOrResumeRemoteMatchResult
>('matches:createOrResume');

export const submitLifeEventMutation = makeFunctionReference<
  'mutation',
  SubmitLifeEventArgs,
  SubmitLifeEventResult
>('matches:submitLifeEvent');

export function createConvexMatchApi(client: ConvexMatchMutationClient): ConvexMatchApi {
  return {
    createOrResume: (args) => client.mutation(createOrResumeMatchMutation, args),
    submitLifeEvent: (args) => client.mutation(submitLifeEventMutation, args),
  };
}

export function createConvexHttpMatchApi(
  convexUrl: string,
  options?: ConstructorParameters<typeof ConvexHttpClient>[1],
) {
  return createConvexMatchApi(new ConvexHttpClient(assertConvexUrl(convexUrl), options));
}

function assertConvexUrl(convexUrl: string) {
  const trimmedUrl = convexUrl.trim();
  if (!trimmedUrl) {
    throw new Error('Convex deployment URL is required to create the match sync API.');
  }

  return trimmedUrl;
}
