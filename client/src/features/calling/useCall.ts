import { useCallback } from "react";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { acceptCall as acceptCallAction } from "@/store/slices/callSlice";
import {
  selectActiveCall,
  selectIncomingCall,
  selectIsInCall,
} from "@/features/voice/voiceSelectors";
import {
  initiateCall,
  answerCall,
  rejectCall,
  hangupCall,
} from "./callService";
import type { CallType } from "@/types/calling";

/**
 * Hook for managing 1:1 DM calls.
 */
export function useCall() {
  const dispatch = useAppDispatch();
  const activeCall = useAppSelector(selectActiveCall);
  const incomingCall = useAppSelector(selectIncomingCall);
  const isInCall = useAppSelector(selectIsInCall);

  const startCall = useCallback(
    async (partnerPubkey: string, callType: CallType) => {
      try {
        await initiateCall(partnerPubkey, callType);
      } catch (err) {
        console.error("[call] Failed to initiate:", err);
        throw err;
      }
    },
    [],
  );

  const answer = useCallback(async () => {
    dispatch(acceptCallAction());
    try {
      await answerCall();
    } catch (err) {
      console.error("[call] Failed to answer:", err);
    }
  }, [dispatch]);

  const reject = useCallback(async () => {
    // The service captures the invite, THEN dispatches the clearing reducer
    // (#37) — dispatching here first meant the decline was never sent.
    try {
      await rejectCall();
    } catch (err) {
      console.error("[call] Failed to reject:", err);
    }
  }, []);

  const hangup = useCallback(async () => {
    try {
      await hangupCall();
    } catch (err) {
      console.error("[call] Failed to hangup:", err);
    }
  }, []);

  return {
    activeCall,
    incomingCall,
    isInCall,
    startCall,
    answer,
    reject,
    hangup,
  };
}
