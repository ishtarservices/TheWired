// One E2EE session per LiveKit room connection: the worker + key provider
// LiveKit needs at `new Room(...)`, plus the key source for the room kind.
// `livekitClient.ts` owns the lifecycle and forwards membership events; the
// session never touches the Room object, so it is testable without the SDK.
import { isE2EESupported } from "livekit-client";
import { NostrKeyProvider } from "./NostrKeyProvider";
import { createE2EEWorker } from "./e2eeWorker";
import { installCallKeys } from "./callKeys";
import { ChannelKeyManager } from "./channelKeys";
import { registerMediaKeyReceiver } from "./mediaKeyInbox";
import { sendMediaKey } from "./mediaKeySender";
import { createLogger } from "@/lib/debug/logger";

const log = createLogger("e2ee");

export type E2EEContext =
  | { kind: "call"; roomId: string; roomSecretKeyHex: string; peerPubkey: string }
  | { kind: "channel"; roomName: string };

/** This WebView has neither insertable streams nor RTCRtpScriptTransform. */
export class E2EEUnsupportedError extends Error {
  constructor() {
    super("End-to-end encrypted calls aren't supported on this device");
    this.name = "E2EEUnsupportedError";
  }
}

export interface E2EESession {
  readonly ctx: E2EEContext;
  readonly provider: NostrKeyProvider;
  readonly worker: Worker;
  /** Keys known before connect (1:1 calls: both derived keys). */
  installInitialKeys(): Promise<void>;
  /** Room connected; `members` = remote identities already present. */
  start(members: Iterable<string>): Promise<void>;
  onParticipantJoined(identity: string): Promise<void>;
  onParticipantLeft(identity: string): void;
  onReconnected(): Promise<void>;
  dispose(): void;
}

export interface E2EESessionDeps {
  /** Test injection; production uses the real worker / gift-wrap sender. */
  worker?: Worker;
  provider?: NostrKeyProvider;
  send?: typeof sendMediaKey;
  supported?: boolean;
}

/** Whether frame-level E2EE can run in this WebView. */
export function e2eeSupported(): boolean {
  return isE2EESupported();
}

export function createE2EESession(
  ctx: E2EEContext,
  myPubkey: string,
  deps: E2EESessionDeps = {},
): E2EESession {
  if (!(deps.supported ?? isE2EESupported())) throw new E2EEUnsupportedError();
  const provider = deps.provider ?? new NostrKeyProvider();
  const worker = deps.worker ?? createE2EEWorker();
  let disposed = false;

  if (ctx.kind === "call") {
    return {
      ctx,
      provider,
      worker,
      async installInitialKeys() {
        await installCallKeys(provider, {
          roomId: ctx.roomId,
          roomSecretKeyHex: ctx.roomSecretKeyHex,
          myPubkey,
          peerPubkey: ctx.peerPubkey,
        });
        log.info(`call keys installed room=${ctx.roomId.slice(0, 8)}`);
      },
      async start() {},
      async onParticipantJoined() {},
      onParticipantLeft() {},
      async onReconnected() {
        // The worker keeps both keys; re-assert ours so the encoder index is
        // current after a full reconnect.
        if (disposed) return;
        await installCallKeys(provider, {
          roomId: ctx.roomId,
          roomSecretKeyHex: ctx.roomSecretKeyHex,
          myPubkey,
          peerPubkey: ctx.peerPubkey,
        });
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        worker.terminate();
      },
    };
  }

  const manager = new ChannelKeyManager({
    roomName: ctx.roomName,
    myPubkey,
    sink: provider,
    send: deps.send ?? sendMediaKey,
    warn: (m, d) => log.warn(m, d),
    info: (m, d) => log.info(m, d),
  });
  // Listen from the moment the session exists: a peer sees our
  // ParticipantConnected while we are still inside `room.connect()` and sends
  // its key right away; the manager installs remote keys before `start()`.
  let unregister: (() => void) | null = registerMediaKeyReceiver((sender, env) => {
    const outcome = manager.onRemoteKey(sender, env);
    if (outcome !== "installed") log.warn(`media key from ${sender.slice(0, 8)} dropped: ${outcome}`);
  });

  return {
    ctx,
    provider,
    worker,
    async installInitialKeys() {},
    async start(members) {
      if (disposed) return;
      await manager.start(members);
    },
    onParticipantJoined: (identity) => manager.onParticipantJoined(identity),
    onParticipantLeft: (identity) => manager.onParticipantLeft(identity),
    onReconnected: () => manager.onReconnected(),
    dispose() {
      if (disposed) return;
      disposed = true;
      unregister?.();
      unregister = null;
      manager.dispose();
      worker.terminate();
    },
  };
}
