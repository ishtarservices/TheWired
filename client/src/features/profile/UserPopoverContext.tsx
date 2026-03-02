import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { UserPopoverCard } from "./UserPopoverCard";

interface UserPopoverState {
  pubkey: string;
  anchorEl: HTMLElement;
}

interface UserPopoverContextValue {
  openUserPopover: (pubkey: string, anchorEl: HTMLElement) => void;
  closeUserPopover: () => void;
}

const UserPopoverCtx = createContext<UserPopoverContextValue>({
  openUserPopover: () => {},
  closeUserPopover: () => {},
});

export function useUserPopover() {
  return useContext(UserPopoverCtx);
}

export function UserPopoverProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<UserPopoverState | null>(null);
  const navigate = useNavigate();

  const openUserPopover = useCallback(
    (pubkey: string, anchorEl: HTMLElement) => {
      setState({ pubkey, anchorEl });
    },
    [],
  );

  const closeUserPopover = useCallback(() => {
    setState(null);
  }, []);

  const handleMessage = useCallback(
    (pubkey: string) => {
      navigate(`/dm/${pubkey}`);
    },
    [navigate],
  );

  return (
    <UserPopoverCtx.Provider value={{ openUserPopover, closeUserPopover }}>
      {children}
      {state && (
        <UserPopoverCard
          pubkey={state.pubkey}
          anchorEl={state.anchorEl}
          onClose={closeUserPopover}
          onMessage={handleMessage}
        />
      )}
    </UserPopoverCtx.Provider>
  );
}
