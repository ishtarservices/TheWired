import { useCallback } from "react";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { setPickerOpen } from "@/store/slices/listenTogetherSlice";
import {
  startListenTogetherSession,
  endListenTogetherSession,
  joinListenTogetherSession,
  leaveListenTogetherSession,
  dismissInvite as dismissInviteService,
  transferDJ as transferDJService,
  requestDJ as requestDJService,
  voteSkip as voteSkipService,
  sendReaction as sendReactionService,
} from "./listenTogetherService";

export function useListenTogether() {
  const dispatch = useAppDispatch();
  const lt = useAppSelector((s) => s.listenTogether);

  const startSession = useCallback(
    (roomId: string, context: "space" | "dm") => {
      startListenTogetherSession(roomId, context);
    },
    [],
  );

  const endSessionCb = useCallback(() => {
    endListenTogetherSession();
  }, []);

  const joinSessionCb = useCallback(() => {
    joinListenTogetherSession();
  }, []);

  const leaveSessionCb = useCallback(() => {
    leaveListenTogetherSession();
  }, []);

  const dismissInviteCb = useCallback(() => {
    dismissInviteService();
  }, []);

  const transferDJ = useCallback((targetPubkey: string) => {
    transferDJService(targetPubkey);
  }, []);

  const requestDJCb = useCallback(() => {
    requestDJService();
  }, []);

  const voteSkipCb = useCallback(() => {
    voteSkipService();
  }, []);

  const react = useCallback((emoji: string) => {
    sendReactionService(emoji);
  }, []);

  const togglePicker = useCallback(() => {
    dispatch(setPickerOpen(!lt.pickerOpen));
  }, [dispatch, lt.pickerOpen]);

  const openPicker = useCallback(() => {
    dispatch(setPickerOpen(true));
  }, [dispatch]);

  const closePicker = useCallback(() => {
    dispatch(setPickerOpen(false));
  }, [dispatch]);

  return {
    active: lt.active,
    context: lt.context,
    isLocalDJ: lt.isLocalDJ,
    djPubkey: lt.djPubkey,
    listeners: lt.listeners,
    listenerCount: lt.listeners.length,
    currentTrackId: lt.currentTrackId,
    isPlaying: lt.isPlaying,
    sharedQueue: lt.sharedQueue,
    sharedQueueIndex: lt.sharedQueueIndex,
    skipVotes: lt.skipVotes,
    reactions: lt.reactions,
    pickerOpen: lt.pickerOpen,
    pendingInvite: lt.pendingInvite,
    dismissed: lt.dismissed,
    startSession,
    endSession: endSessionCb,
    joinSession: joinSessionCb,
    leaveSession: leaveSessionCb,
    dismissInvite: dismissInviteCb,
    transferDJ,
    requestDJ: requestDJCb,
    voteSkip: voteSkipCb,
    react,
    togglePicker,
    openPicker,
    closePicker,
  };
}
