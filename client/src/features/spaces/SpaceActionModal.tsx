import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { X, Plus, LogIn } from "lucide-react";
import { Modal } from "../../components/ui/Modal";
import { CreateSpaceModal } from "./CreateSpaceModal";
import { JoinSpaceModal } from "./JoinSpaceModal";
import { InviteGenerateModal } from "./InviteGenerateModal";
import { useSpace } from "./useSpace";

interface SpaceActionModalProps {
  open: boolean;
  onClose: () => void;
}

export function SpaceActionModal({ open, onClose }: SpaceActionModalProps) {
  const { joinSpace } = useSpace();
  const navigate = useNavigate();
  const location = useLocation();
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [inviteSpace, setInviteSpace] = useState<{ id: string; name: string } | null>(null);

  const handleCreate = () => {
    onClose();
    setShowCreate(true);
  };

  const handleJoin = () => {
    onClose();
    setShowJoin(true);
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
              className="flex w-full items-center gap-4 rounded-xl bg-surface border border-edge px-4 py-4 text-left transition-all hover:bg-pulse/8 hover:border-pulse/20 group"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-pulse/10 text-pulse group-hover:bg-pulse/20 transition-colors">
                <Plus size={20} />
              </div>
              <div>
                <p className="text-sm font-semibold text-heading">Create My Own</p>
                <p className="text-xs text-muted">Start a new space from scratch</p>
              </div>
            </button>

            <button
              onClick={handleJoin}
              className="flex w-full items-center gap-4 rounded-xl bg-surface border border-edge px-4 py-4 text-left transition-all hover:bg-neon/8 hover:border-neon/20 group"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-neon/10 text-neon group-hover:bg-neon/20 transition-colors">
                <LogIn size={20} />
              </div>
              <div>
                <p className="text-sm font-semibold text-heading">Join a Space</p>
                <p className="text-xs text-muted">Enter an invite code or link</p>
              </div>
            </button>
          </div>
        </div>
      </Modal>

      <CreateSpaceModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreate={(space) => {
          joinSpace(space);
          setInviteSpace({ id: space.id, name: space.name });
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
      />
    </>
  );
}
