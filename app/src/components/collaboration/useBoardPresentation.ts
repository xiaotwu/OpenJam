import { useCallback, useEffect, useRef, useState } from 'react';
import type { BoardViewport, PresentationMessage, PresenterViewport } from '../../lib/boardPresentation';

interface PresentationOptions {
  connected: boolean;
  canPresent: boolean;
  epoch?: number;
  view: BoardViewport | null;
  presenters: ReadonlyMap<string, PresenterViewport>;
  send: (message: PresentationMessage) => void;
  apply: (view: BoardViewport) => void;
}

export function useBoardPresentation({ connected, canPresent, epoch, view, presenters, send, apply }: PresentationOptions) {
  const [presentingEpoch, setPresentingEpoch] = useState<number>();
  const [followingId, setFollowingId] = useState<string>();
  const currentView = useRef(view);
  const presenting = connected && canPresent && epoch !== undefined && presentingEpoch === epoch;
  const followedView = followingId ? presenters.get(followingId) : undefined;

  useEffect(() => {
    if (!connected || !canPresent) setPresentingEpoch(undefined);
  }, [connected, canPresent]);

  useEffect(() => {
    if (followingId && (!connected || !followedView)) setFollowingId(undefined);
    if (connected && followedView) apply(followedView);
  }, [apply, connected, followedView, followingId]);

  useEffect(() => {
    currentView.current = view;
    if (presenting && view) send({ active: true, ...view });
  }, [presenting, send, view]);

  useEffect(() => {
    if (!presenting) return;
    const timer = window.setInterval(() => {
      if (currentView.current) send({ active: true, ...currentView.current });
    }, 1500);
    return () => {
      window.clearInterval(timer);
      send({ active: false });
    };
  }, [presenting, send]);

  const togglePresenting = useCallback(() => {
    if (!connected || !canPresent || epoch === undefined) return;
    setFollowingId(undefined);
    setPresentingEpoch(presenting ? undefined : epoch);
  }, [canPresent, connected, epoch, presenting]);

  const follow = useCallback((userId: string) => {
    if (!connected || !presenters.has(userId)) return;
    setPresentingEpoch(undefined);
    setFollowingId(userId);
  }, [connected, presenters]);

  const stopFollowing = useCallback(() => setFollowingId(undefined), []);

  return { presenting, followingId: connected && followedView ? followingId : undefined, togglePresenting, follow, stopFollowing };
}
