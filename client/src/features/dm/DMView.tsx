import { useState, useCallback, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { DMSidebar } from "./DMSidebar";
import { DMConversation } from "./DMConversation";
import { NewDMModal } from "./NewDMModal";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { setActiveConversation } from "@/store/slices/dmSlice";
import { Lock, SquarePen } from "lucide-react";

export function DMView() {
  const { pubkey: routePubkey } = useParams<{ pubkey?: string }>();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const activeConversation = useAppSelector((s) => s.dm.activeConversation);
  const [showNewDM, setShowNewDM] = useState(false);

  // Use route param if available, fallback to redux state
  const activePubkey = routePubkey || activeConversation;

  // Keep Redux activeConversation in sync with route param so that
  // dmSlice unread checks work correctly when navigating via URL
  useEffect(() => {
    if (routePubkey && routePubkey !== activeConversation) {
      dispatch(setActiveConversation(routePubkey));
    }
  }, [routePubkey, activeConversation, dispatch]);

  // Clear activeConversation when leaving the DM view entirely.
  // Without this, the dmSlice reducer thinks we're still viewing the
  // conversation and won't increment unreadCount for new messages.
  useEffect(() => {
    return () => {
      dispatch(setActiveConversation(null));
    };
  }, [dispatch]);

  const handleSelectContact = useCallback(
    (pubkey: string) => {
      dispatch(setActiveConversation(pubkey));
      navigate(`/dm/${pubkey}`);
    },
    [dispatch, navigate],
  );

  const handleBack = useCallback(() => {
    dispatch(setActiveConversation(null));
    navigate("/dm");
  }, [dispatch, navigate]);

  return (
    <div className="flex flex-1 overflow-hidden">
      <DMSidebar
        activePartner={activePubkey ?? null}
        onSelectContact={handleSelectContact}
      />
      {activePubkey ? (
        <DMConversation partnerPubkey={activePubkey} onBack={handleBack} />
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <Lock size={32} className="mx-auto mb-3 text-muted" />
            <h3 className="text-lg font-semibold text-heading">
              Direct Messages
            </h3>
            <p className="mt-1 text-sm text-muted max-w-sm">
              End-to-end encrypted messages using NIP-17.
            </p>
            <button
              onClick={() => setShowNewDM(true)}
              className="mt-4 inline-flex items-center gap-2 rounded-xl bg-pulse/15 px-4 py-2 text-sm font-medium text-pulse hover:bg-pulse/25 transition-colors"
            >
              <SquarePen size={15} />
              Start a conversation
            </button>
            <NewDMModal
              open={showNewDM}
              onClose={() => setShowNewDM(false)}
              onSelect={handleSelectContact}
            />
          </div>
        </div>
      )}
    </div>
  );
}
