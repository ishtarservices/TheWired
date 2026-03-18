/**
 * RTCPeerConnection factory for 1:1 P2P DM calls.
 *
 * Manages the lifecycle of a peer connection including
 * ICE candidate gathering, offer/answer creation, and media tracks.
 */

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
];

export interface PeerConnectionCallbacks {
  onIceCandidate: (candidate: RTCIceCandidate) => void;
  onIceConnectionStateChange: (state: RTCIceConnectionState) => void;
  onTrack: (event: RTCTrackEvent) => void;
  onNegotiationNeeded: () => void;
  onIceGatheringComplete: () => void;
}

/** Active peer connection instance */
let activePeerConnection: RTCPeerConnection | null = null;

/**
 * Create a new RTCPeerConnection with default configuration.
 */
export function createPeerConnection(
  callbacks: PeerConnectionCallbacks,
  turnServers?: RTCIceServer[],
): RTCPeerConnection {
  // Close any existing connection
  closePeerConnection();

  const iceServers = [...DEFAULT_ICE_SERVERS, ...(turnServers ?? [])];

  const pc = new RTCPeerConnection({
    iceServers,
    iceCandidatePoolSize: 10,
  });

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      callbacks.onIceCandidate(event.candidate);
    }
  };

  pc.onicegatheringstatechange = () => {
    if (pc.iceGatheringState === "complete") {
      callbacks.onIceGatheringComplete();
    }
  };

  pc.oniceconnectionstatechange = () => {
    callbacks.onIceConnectionStateChange(pc.iceConnectionState);
  };

  pc.ontrack = (event) => {
    callbacks.onTrack(event);
  };

  pc.onnegotiationneeded = () => {
    callbacks.onNegotiationNeeded();
  };

  activePeerConnection = pc;
  return pc;
}

/**
 * Create an SDP offer.
 */
export async function createOffer(
  pc: RTCPeerConnection,
): Promise<RTCSessionDescriptionInit> {
  const offer = await pc.createOffer({
    offerToReceiveAudio: true,
    offerToReceiveVideo: true,
  });
  await pc.setLocalDescription(offer);
  return offer;
}

/**
 * Create an SDP answer.
 */
export async function createAnswer(
  pc: RTCPeerConnection,
): Promise<RTCSessionDescriptionInit> {
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  return answer;
}

/**
 * Set the remote SDP description (offer or answer).
 */
export async function setRemoteDescription(
  pc: RTCPeerConnection,
  description: RTCSessionDescriptionInit,
): Promise<void> {
  await pc.setRemoteDescription(new RTCSessionDescription(description));
}

/**
 * Add an ICE candidate received from the remote peer.
 */
export async function addIceCandidate(
  pc: RTCPeerConnection,
  candidate: RTCIceCandidateInit,
): Promise<void> {
  await pc.addIceCandidate(new RTCIceCandidate(candidate));
}

/**
 * Add local media tracks to the peer connection.
 */
export function addMediaTracks(
  pc: RTCPeerConnection,
  stream: MediaStream,
): void {
  for (const track of stream.getTracks()) {
    pc.addTrack(track, stream);
  }
}

/**
 * Replace a track in the peer connection (e.g., switching camera).
 */
export async function replaceTrack(
  pc: RTCPeerConnection,
  oldTrack: MediaStreamTrack,
  newTrack: MediaStreamTrack,
): Promise<void> {
  const sender = pc.getSenders().find((s) => s.track === oldTrack);
  if (sender) {
    await sender.replaceTrack(newTrack);
  }
}

/**
 * Close the active peer connection and clean up.
 */
export function closePeerConnection(): void {
  if (activePeerConnection) {
    activePeerConnection.close();
    activePeerConnection = null;
  }
}

/**
 * Get the active peer connection.
 */
export function getActivePeerConnection(): RTCPeerConnection | null {
  return activePeerConnection;
}

/**
 * Check if P2P connection is feasible by monitoring ICE state.
 * Returns true if ICE reaches "connected" or "completed" within timeout.
 */
export function waitForP2PConnection(
  pc: RTCPeerConnection,
  timeoutMs = 10000,
): Promise<boolean> {
  return new Promise((resolve) => {
    if (
      pc.iceConnectionState === "connected" ||
      pc.iceConnectionState === "completed"
    ) {
      resolve(true);
      return;
    }

    const timer = setTimeout(() => {
      resolve(false);
    }, timeoutMs);

    const handler = () => {
      if (
        pc.iceConnectionState === "connected" ||
        pc.iceConnectionState === "completed"
      ) {
        clearTimeout(timer);
        pc.removeEventListener("iceconnectionstatechange", handler);
        resolve(true);
      } else if (pc.iceConnectionState === "failed") {
        clearTimeout(timer);
        pc.removeEventListener("iceconnectionstatechange", handler);
        resolve(false);
      }
    };

    pc.addEventListener("iceconnectionstatechange", handler);
  });
}
