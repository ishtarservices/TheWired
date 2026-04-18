import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { ActiveCall, CallInvite, CallState, CallType } from "../../types/calling";

interface CallSliceState {
  /** Currently active call (outgoing or accepted incoming) */
  activeCall: ActiveCall | null;
  /** Incoming call that hasn't been answered yet */
  incomingCall: CallInvite | null;
  /** Recent call history */
  callHistory: Array<{
    partnerPubkey: string;
    callType: CallType;
    direction: "incoming" | "outgoing";
    startedAt: number;
    endedAt: number;
    duration: number;
    outcome: "completed" | "missed" | "declined" | "failed";
  }>;
  /** Gift-wrap IDs already processed as call events — prevents stale wraps
   *  from re-triggering rings on app restart or user switch. Persisted to IDB. */
  processedWrapIds: string[];
}

const initialState: CallSliceState = {
  activeCall: null,
  incomingCall: null,
  callHistory: [],
  processedWrapIds: [],
};

export const callSlice = createSlice({
  name: "call",
  initialState,
  reducers: {
    setIncomingCall(state, action: PayloadAction<CallInvite | null>) {
      state.incomingCall = action.payload;
    },

    startOutgoingCall(
      state,
      action: PayloadAction<{
        partnerPubkey: string;
        callType: CallType;
        roomId: string;
        roomSecretKey: string;
      }>,
    ) {
      state.activeCall = {
        ...action.payload,
        state: "ringing",
        startedAt: Date.now(),
        isMuted: false,
        isVideoEnabled: action.payload.callType === "video",
        isScreenSharing: false,
        isSfuFallback: false,
      };
    },

    acceptCall(state) {
      if (state.incomingCall) {
        state.activeCall = {
          partnerPubkey: state.incomingCall.callerPubkey,
          callType: state.incomingCall.callType,
          roomId: "", // Will be derived from roomSecretKey
          roomSecretKey: state.incomingCall.roomSecretKey,
          state: "connecting",
          startedAt: Date.now(),
          isMuted: false,
          isVideoEnabled: state.incomingCall.callType === "video",
          isScreenSharing: false,
          isSfuFallback: false,
        };
        state.incomingCall = null;
      }
    },

    rejectCall(state) {
      if (state.incomingCall) {
        state.callHistory.unshift({
          partnerPubkey: state.incomingCall.callerPubkey,
          callType: state.incomingCall.callType,
          direction: "incoming",
          startedAt: state.incomingCall.timestamp,
          endedAt: Date.now(),
          duration: 0,
          outcome: "declined",
        });
        state.incomingCall = null;
      }
    },

    setCallState(state, action: PayloadAction<CallState>) {
      if (state.activeCall) {
        state.activeCall.state = action.payload;
      }
    },

    setCallRoomId(state, action: PayloadAction<string>) {
      if (state.activeCall) {
        state.activeCall.roomId = action.payload;
      }
    },

    endCall(state, action: PayloadAction<"completed" | "missed" | "declined" | "failed" | undefined>) {
      if (state.activeCall) {
        const outcome = action.payload ?? "completed";
        state.callHistory.unshift({
          partnerPubkey: state.activeCall.partnerPubkey,
          callType: state.activeCall.callType,
          direction: "outgoing",
          startedAt: state.activeCall.startedAt,
          endedAt: Date.now(),
          duration: state.activeCall.state === "active"
            ? Date.now() - state.activeCall.startedAt
            : 0,
          outcome,
        });
        state.activeCall = null;
      }
      state.incomingCall = null;
    },

    toggleCallMute(state) {
      if (state.activeCall) {
        state.activeCall.isMuted = !state.activeCall.isMuted;
      }
    },

    toggleCallVideo(state) {
      if (state.activeCall) {
        state.activeCall.isVideoEnabled = !state.activeCall.isVideoEnabled;
      }
    },

    toggleCallScreenShare(state) {
      if (state.activeCall) {
        state.activeCall.isScreenSharing = !state.activeCall.isScreenSharing;
      }
    },

    setSfuFallback(state, action: PayloadAction<boolean>) {
      if (state.activeCall) {
        state.activeCall.isSfuFallback = action.payload;
      }
    },

    clearCallHistory(state) {
      state.callHistory = [];
    },

    addProcessedCallWrapId(state, action: PayloadAction<string>) {
      if (state.processedWrapIds.includes(action.payload)) return;
      state.processedWrapIds.push(action.payload);
      if (state.processedWrapIds.length > 3000) {
        state.processedWrapIds = state.processedWrapIds.slice(-2000);
      }
    },

    missedCall(state) {
      if (state.incomingCall) {
        state.callHistory.unshift({
          partnerPubkey: state.incomingCall.callerPubkey,
          callType: state.incomingCall.callType,
          direction: "incoming",
          startedAt: state.incomingCall.timestamp,
          endedAt: Date.now(),
          duration: 0,
          outcome: "missed",
        });
        state.incomingCall = null;
      }
    },
  },
});

export const {
  setIncomingCall,
  startOutgoingCall,
  acceptCall,
  rejectCall,
  setCallState,
  setCallRoomId,
  endCall,
  toggleCallMute,
  toggleCallVideo,
  toggleCallScreenShare,
  setSfuFallback,
  clearCallHistory,
  missedCall,
  addProcessedCallWrapId,
} = callSlice.actions;
