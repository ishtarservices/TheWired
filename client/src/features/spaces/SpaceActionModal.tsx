import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { X, Plus, LogIn, Globe } from "lucide-react";
import { Modal } from "../../components/ui/Modal";
import { CreateSpaceModal } from "./CreateSpaceModal";
import { JoinSpaceModal } from "./JoinSpaceModal";
import { ImportSpaceModal } from "./ImportSpaceModal";
import { InviteGenerateModal } from "./InviteGenerateModal";
import { useSpace } from "./useSpace";
import { isBackendBacked } from "./spaceType";
import { useAppSelector } from "../../store/hooks";
import {
  FEATURE_DECENTRALIZED_SPACES,
  selectFeatureEnabled,
} from "../../store/slices/featuresSlice";

interface SpaceActionModalProps {
  open: boolean;
  onClose: () => void;
}

export function SpaceActionModal({ open, onClose }: SpaceActionModalProps) {
  const { joinSpace } = useSpace();
  const navigate = useNavigate();
  const location = useLocation();
  const decentralizedEnabled = useAppSelector(
    selectFeatureEnabled(FEATURE_DECENTRALIZED_SPACES),
  );
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importInput, setImportInput] = useState<string | undefined>(undefined);
  const [inviteSpace, setInviteSpace] = useState<{ id: string; name: string } | null>(null);

  const handleCreate = () => {
    onClose();
    setShowCreate(true);
  };

  const handleJoin = () => {
    onClose();
    setShowJoin(true);
  };

  const handleImport = () => {
    onClose();
    setShowImport(true);
  };

  return (
    <>
      <Modal open={open} onClose={onClose}>
        <div className="w-full max-w-sm rounded-2xl card-glass p-8 shadow-2xl">
          <div className="mb-6 flex items-center justify-between">
            <h2 className="text-lg font-bold text-heading">Add a Space</h2>
            <button
              onClick={onClose}
              className="rounded-full p-1 text-soft hover:bg-card-hover hover:text-heading transition-colors"
            >
              <X size={18} />
            </button>
          </div>

          <div className="space-y-3">
            <button
              onClick={handleCreate}
              className="flex w-full items-center gap-4 rounded-xl bg-surface border border-border px-4 py-4 text-left transition-all hover:bg-primary/8 hover:border-primary/20 group"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary group-hover:bg-primary/20 transition-colors">
                <Plus size={20} />
              </div>
              <div>
                <p className="text-sm font-semibold text-heading">Create My Own</p>
                <p className="text-xs text-muted">Start a new space from scratch</p>
              </div>
            </button>

            <button
              onClick={handleJoin}
              className="flex w-full items-center gap-4 rounded-xl bg-surface border border-border px-4 py-4 text-left transition-all hover:bg-primary/8 hover:border-primary/20 group"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary group-hover:bg-primary/20 transition-colors">
                <LogIn size={20} />
              </div>
              <div>
                <p className="text-sm font-semibold text-heading">Join a Space</p>
                <p className="text-xs text-muted">Enter an invite code or link</p>
              </div>
            </button>

            {decentralizedEnabled && (
              <button
                onClick={handleImport}
                className="flex w-full items-center gap-4 rounded-xl bg-surface border border-border px-4 py-4 text-left transition-all hover:bg-primary/8 hover:border-primary/20 group"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary group-hover:bg-primary/20 transition-colors">
                  <Globe size={20} />
                </div>
                <div>
                  <p className="text-sm font-semibold text-heading">Import a Group</p>
                  <p className="text-xs text-muted">Bring a NIP-29 group from another app</p>
                </div>
              </button>
            )}
          </div>
        </div>
      </Modal>

      <CreateSpaceModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreate={(space) => {
          joinSpace(space);
          // Backend invites (kind via REST) only apply to backend-backed spaces.
          // NIP-29-native groups use relay invites (not yet surfaced here).
          if (isBackendBacked(space)) {
            setInviteSpace({ id: space.id, name: space.name });
          }
          if (location.pathname !== "/") {
            navigate("/");
          }
        }}
      />

      {inviteSpace && (
        <InviteGenerateModal
          open
          onClose={() => setInviteSpace(null)}
          spaceId={inviteSpace.id}
          spaceName={inviteSpace.name}
        />
      )}

      <JoinSpaceModal
        open={showJoin}
        onClose={() => setShowJoin(false)}
        onImportInstead={(addr) => {
          // The pasted value was a decentralized group address, not an invite
          // code — switch to the Import flow with it pre-filled.
          setShowJoin(false);
          setImportInput(addr);
          setShowImport(true);
        }}
      />

      <ImportSpaceModal
        open={showImport}
        initialInput={importInput}
        onClose={() => {
          setShowImport(false);
          setImportInput(undefined);
        }}
      />
    </>
  );
}
