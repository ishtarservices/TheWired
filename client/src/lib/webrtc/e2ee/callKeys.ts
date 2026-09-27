import { deriveCallSenderKey } from "@ishtarservices/core";

/** The minimal provider surface `installCallKeys` needs (mockable). */
export interface SenderKeySink {
  setSenderKey(identity: string, keyBytes: Uint8Array, keyIndex: number): Promise<void>;
}

export interface CallKeyParams {
  roomId: string;
  roomSecretKeyHex: string;
  myPubkey: string;
  peerPubkey: string;
}

/**
 * 1:1 call keys — derived, zero signaling. Both peers hold the invite's
 * `roomSecretKey`; each side installs its own sender key under its own
 * identity and the peer's under theirs, index 0. Nothing rotates: the
 * membership of a 1:1 room is fixed for the life of the secret.
 */
export async function installCallKeys(sink: SenderKeySink, p: CallKeyParams): Promise<void> {
  const mine = deriveCallSenderKey(p.roomSecretKeyHex, p.roomId, p.myPubkey);
  const theirs = deriveCallSenderKey(p.roomSecretKeyHex, p.roomId, p.peerPubkey);
  await Promise.all([
    sink.setSenderKey(p.myPubkey, mine, 0),
    sink.setSenderKey(p.peerPubkey, theirs, 0),
  ]);
}
