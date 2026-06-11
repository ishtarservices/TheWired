import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { nip19 } from "nostr-tools";
import { X, ArrowLeft, Users, AlertCircle, Server } from "lucide-react";
import { Modal } from "../../components/ui/Modal";
import { Button } from "../../components/ui/Button";
import { Spinner } from "../../components/ui/Spinner";
import { Avatar } from "../../components/ui/Avatar";
import { useSpace } from "./useSpace";
import { useAppSelector, useAppDispatch } from "../../store/hooks";
import { setSidebarMode } from "../../store/slices/uiSlice";
import { relayManager } from "../../lib/nostr/relayManager";
import { verifyBridge } from "../../lib/nostr/verifyWorkerBridge";
import { probeRelayNip11 } from "../../lib/nostr/relayInfo";
import { signAndPublish } from "../../lib/nostr/publish";
import { buildJoinRequest } from "../../lib/nostr/eventBuilder";
import { EVENT_KINDS } from "../../types/nostr";
import type { NostrEvent } from "../../types/nostr";
import type { Space } from "../../types/space";
import { hostToRelayUrl, parseGroupAddress, relayUrlToHost } from "./spaceType";
import { parseGroupMetadata } from "./nip29SpaceSync";

interface ImportSpaceModalProps {
  open: boolean;
  onClose: () => void;
  /** Pre-fill + auto-look-up an address (e.g. when routed here from the
   *  "Join a Space" flow after a group address was pasted there). */
  initialInput?: string;
}

type Step = "input" | "preview" | "joining" | "success";

interface GroupTarget {
  host: string;
  groupId: string;
  relayUrl: string;
  /** Relay's NIP-11 signing key — pinned as the trusted author of group state. */
  relayPubkey?: string;
}

interface GroupPreview {
  name: string;
  about?: string;
  picture?: string;
  isPrivate: boolean;
  adminPubkeys: string[];
  memberPubkeys: string[];
  /** True only when the group's admin/member lists were proven to be signed by
   *  the relay's pinned NIP-11 key. When false, the trust anchors are dropped on
   *  import (#41) so a forged 39001/39002 from a malicious relay can't seed who
   *  the admins are. */
  verified: boolean;
}

/** A 39000-2 event is trustworthy only if it is schnorr-valid AND authored by the
 *  relay's NIP-11 pubkey (NIP-29 relay-generated state). Exported for testing. */
export async function isRelayAuthored(event: NostrEvent | null, relayPubkey: string | undefined): Promise<boolean> {
  if (!event || !relayPubkey || event.pubkey !== relayPubkey) return false;
  try {
    return await verifyBridge.verify(event);
  } catch {
    return false;
  }
}

/** Parse `<host>'<groupId>`, an `naddr`, or a `nostr:naddr` into a group target. */
function parseGroupInput(raw: string): GroupTarget | null {
  const input = raw.trim().replace(/^nostr:/, "");

  if (input.startsWith("naddr1")) {
    try {
      const decoded = nip19.decode(input);
      if (decoded.type !== "naddr") return null;
      const { identifier, relays } = decoded.data;
      const relayUrl = relays?.[0];
      if (!identifier || !relayUrl) return null;
      return { host: relayUrlToHost(relayUrl), groupId: identifier, relayUrl };
    } catch {
      return null;
    }
  }

  const ref = parseGroupAddress(input);
  if (!ref) return null;
  return { host: ref.host, groupId: ref.groupId, relayUrl: hostToRelayUrl(ref.host) };
}

/** One-shot fetch of a group's 39000/39001/39002 from a relay (preview). */
function fetchGroupPreview(target: GroupTarget, relayPubkey: string | undefined, timeoutMs = 6000): Promise<GroupPreview | null> {
  return new Promise((resolve) => {
    relayManager.connect(target.relayUrl, "read");

    let metadata: NostrEvent | null = null;
    let admins: NostrEvent | null = null;
    let members: NostrEvent | null = null;
    let settled = false;

    const finish = async () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      relayManager.closeSubscription(subId);
      if (!metadata && !members) {
        resolve(null);
        return;
      }
      // Display fields (name/about/picture) are sanitized by parseGroupMetadata and
      // safe to show even unverified. But the admin/member lists become the space's
      // long-lived trust anchors, so they are ONLY taken from relay-key-signed
      // events (#41).
      const meta = metadata ? parseGroupMetadata(metadata) : {};
      const [adminsOk, membersOk] = await Promise.all([
        isRelayAuthored(admins, relayPubkey),
        isRelayAuthored(members, relayPubkey),
      ]);
      resolve({
        name: meta.name ?? "Group",
        about: meta.about,
        picture: meta.picture,
        isPrivate: meta.isPrivate ?? false,
        adminPubkeys: adminsOk && admins ? pubkeysOf(admins) : [],
        memberPubkeys: membersOk && members ? pubkeysOf(members) : [],
        verified: adminsOk,
      });
    };

    const subId = relayManager.subscribe({
      filters: [
        {
          kinds: [
            EVENT_KINDS.GROUP_METADATA,
            EVENT_KINDS.GROUP_ADMINS,
            EVENT_KINDS.GROUP_MEMBERS,
          ],
          "#d": [target.groupId],
          limit: 3,
        },
      ],
      relayUrls: [target.relayUrl],
      onEvent: (event) => {
        if (event.kind === EVENT_KINDS.GROUP_METADATA) metadata = event;
        else if (event.kind === EVENT_KINDS.GROUP_ADMINS) admins = event;
        else if (event.kind === EVENT_KINDS.GROUP_MEMBERS) members = event;
        // Resolve early once all three are in.
        if (metadata && admins && members) finish();
      },
      onEOSE: finish,
    });

    const timer = setTimeout(finish, timeoutMs);
  });
}

function pubkeysOf(event: NostrEvent): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const tag of event.tags) {
    if (tag[0] === "p" && tag[1] && !seen.has(tag[1])) {
      seen.add(tag[1]);
      out.push(tag[1]);
    }
  }
  return out;
}

export function ImportSpaceModal({ open, onClose, initialInput }: ImportSpaceModalProps) {
  const { joinSpace } = useSpace();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const myPubkey = useAppSelector((s) => s.identity.pubkey);
  const spaces = useAppSelector((s) => s.spaces.list);

  const [step, setStep] = useState<Step>("input");
  const [input, setInput] = useState("");
  const [target, setTarget] = useState<GroupTarget | null>(null);
  const [preview, setPreview] = useState<GroupPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const reset = () => {
    setStep("input");
    setInput("");
    setTarget(null);
    setPreview(null);
    setError(null);
    setLoading(false);
  };

  const handleClose = () => {
    // Lift any AUTH suppression we applied while previewing this relay.
    if (target) relayManager.allowAuth(target.relayUrl);
    reset();
    onClose();
  };

  const handleLookup = async (raw?: string) => {
    const source = typeof raw === "string" ? raw : input;
    const parsed = parseGroupInput(source);
    if (!parsed) {
      setError("Couldn't read that. Paste a group address like relay.example.com'groupid, or an naddr.");
      return;
    }
    setError(null);
    setLoading(true);
    // AUTH-privacy: don't auto-answer this relay's NIP-42 challenge while we're
    // only previewing — unless the user already has a space hosted there.
    if (!spaces.some((s) => s.hostRelay === parsed.relayUrl)) {
      relayManager.suppressAuth(parsed.relayUrl);
    }
    try {
      // Probe NIP-11 FIRST for the relay's signing key, then fetch group state so
      // the admin/member lists can be verified against it (#41).
      const info = await probeRelayNip11(parsed.relayUrl);
      const result = await fetchGroupPreview(parsed, info?.pubkey);
      if (!result) {
        setError("No group found on that relay. Check the address, or the relay may be unreachable.");
        return;
      }
      setTarget({ ...parsed, relayPubkey: info?.pubkey });
      setPreview(result);
      setStep("preview");
    } finally {
      setLoading(false);
    }
  };

  // When routed here with an address (e.g. from the Join-a-Space flow after a
  // group address was pasted there), pre-fill the field and look it up.
  const didAutoLookup = useRef(false);
  useEffect(() => {
    if (open && initialInput && !didAutoLookup.current) {
      didAutoLookup.current = true;
      setInput(initialInput);
      void handleLookup(initialInput);
    }
    if (!open) didAutoLookup.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialInput]);

  const handleImport = async () => {
    if (!target || !preview || !myPubkey) return;
    setStep("joining");
    setError(null);

    // The user has opted into this relay — allow AUTH again and answer any
    // challenge received during preview (needed for private-group reads).
    relayManager.allowAuth(target.relayUrl);

    // Best-effort: ask the relay to add us (open groups auto-admit; closed
    // groups may hold the request pending).
    try {
      relayManager.connect(target.relayUrl, "read+write");
      relayManager.replayAuth();
      await signAndPublish(buildJoinRequest(myPubkey, target.groupId), [target.relayUrl]);
    } catch {
      // Non-fatal — we still add the group locally; the user can retry sending.
    }

    const space: Space = {
      id: target.groupId,
      name: preview.name,
      about: preview.about,
      picture: preview.picture,
      mode: "read-write",
      creatorPubkey: preview.adminPubkeys[0] ?? "",
      adminPubkeys: preview.adminPubkeys,
      memberPubkeys: [...new Set([...preview.memberPubkeys, myPubkey])],
      feedPubkeys: [],
      hostRelay: target.relayUrl,
      isPrivate: preview.isPrivate,
      createdAt: Math.floor(Date.now() / 1000),
      spaceType: "nip29-native",
      channelSource: "synthesized",
      groupRef: { host: target.host, groupId: target.groupId },
      relayPubkey: target.relayPubkey,
    };

    joinSpace(space);
    dispatch(setSidebarMode("spaces"));
    navigate("/");
    setStep("success");
    setTimeout(handleClose, 1200);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && input.trim()) handleLookup();
  };

  return (
    <Modal open={open} onClose={handleClose}>
      <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl card-glass p-8 shadow-2xl">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {step === "preview" && (
              <button
                onClick={() => { setStep("input"); setError(null); }}
                className="rounded-full p-1 text-soft hover:bg-card-hover hover:text-heading transition-colors"
              >
                <ArrowLeft size={16} />
              </button>
            )}
            <h2 className="text-lg font-bold text-heading">
              {step === "success" ? "Imported!" : "Import a NIP-29 group"}
            </h2>
          </div>
          <button
            onClick={handleClose}
            className="rounded-full p-1 text-soft hover:bg-card-hover hover:text-heading transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {step === "input" && (
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-soft">
                Group address
              </label>
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="relay.example.com'groupid  or  naddr1…"
                autoFocus
                className="w-full rounded-xl border border-border bg-field px-3 py-2 text-sm text-heading placeholder-muted transition-colors focus:border-primary focus:outline-none"
              />
              <p className="mt-1 text-[11px] text-muted">
                Bring a group you have in another Nostr app (0xchat, Chachi, Flotilla). Its chat,
                members and metadata come from the relay.
              </p>
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2">
                <AlertCircle size={14} className="mt-0.5 shrink-0 text-red-400" />
                <p className="text-xs text-red-300">{error}</p>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="md" onClick={handleClose}>
                Cancel
              </Button>
              <Button variant="accent" size="md" onClick={() => handleLookup()} disabled={!input.trim() || loading}>
                {loading ? <Spinner size="sm" /> : "Look Up"}
              </Button>
            </div>
          </div>
        )}

        {step === "preview" && preview && target && (
          <div className="space-y-4">
            <div className="flex items-center gap-4 rounded-xl border border-border bg-surface p-4">
              <Avatar src={preview.picture} alt={preview.name} size="lg" />
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-sm font-bold text-heading">{preview.name}</h3>
                {preview.about && (
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted">{preview.about}</p>
                )}
                <div className="mt-1.5 flex items-center gap-3 text-muted">
                  <span className="flex items-center gap-1 text-[11px]">
                    <Users size={11} />
                    {preview.memberPubkeys.length} member{preview.memberPubkeys.length !== 1 ? "s" : ""}
                  </span>
                  <span className="flex items-center gap-1 truncate text-[11px]">
                    <Server size={11} />
                    {target.host}
                  </span>
                </div>
              </div>
            </div>

            {preview.isPrivate && (
              <p className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300">
                This group is private — reading its history may require the relay to approve you.
              </p>
            )}

            {!preview.verified && (
              <p className="flex items-start gap-1.5 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300">
                <AlertCircle size={13} className="mt-px shrink-0" />
                This relay doesn't publish a verifiable signing key, so its admin list
                couldn't be confirmed. You can still join, but moderation roles won't be
                trusted until the relay's identity is verified.
              </p>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="md" onClick={handleClose}>
                Cancel
              </Button>
              <Button variant="primary" size="md" onClick={handleImport}>
                Import &amp; Join
              </Button>
            </div>
          </div>
        )}

        {step === "joining" && (
          <div className="flex flex-col items-center py-8">
            <Spinner size="lg" />
            <p className="mt-3 text-sm text-soft">Joining group…</p>
          </div>
        )}

        {step === "success" && (
          <div className="flex flex-col items-center py-8">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-500/10 text-green-400">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
            </div>
            <p className="mt-3 text-sm font-medium text-heading">Welcome to {preview?.name ?? "the group"}!</p>
            <p className="mt-1 text-xs text-muted">Redirecting…</p>
          </div>
        )}
      </div>
    </Modal>
  );
}
