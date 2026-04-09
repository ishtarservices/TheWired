import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronUp, Pencil, User, Settings, LogOut, Plus, Check } from "lucide-react";
import { Avatar } from "../../components/ui/Avatar";
import {
  PopoverMenu,
  PopoverMenuItem,
  PopoverMenuSeparator,
} from "../../components/ui/PopoverMenu";
import { ProfileEditModal } from "../profile/ProfileEditModal";
import { AddAccountModal } from "./AddAccountModal";
import { useIdentity } from "./useIdentity";
import { useProfile } from "../profile/useProfile";

export function ProfileCard() {
  const { pubkey, profile, accounts, logOut, logOutAll, switchTo } = useIdentity();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [addAccountOpen, setAddAccountOpen] = useState(false);

  const hasTauri =
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  const hasMultipleAccounts = accounts.length > 1;

  const toggleMenu = useCallback(() => setMenuOpen((v) => !v), []);
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  if (!pubkey) return null;

  const displayName =
    profile?.display_name || profile?.name || pubkey.slice(0, 8) + "...";

  return (
    <>
      <button
        onClick={toggleMenu}
        className="flex w-full items-center gap-2 rounded-xl p-1 transition-colors hover:bg-surface"
      >
        <Avatar src={profile?.picture} alt={displayName} size="sm" />
        <div className="min-w-0 flex-1 text-left">
          <div className="truncate text-sm font-medium text-heading">
            {displayName}
          </div>
          <div className="truncate text-xs text-muted">
            {pubkey.slice(0, 12)}...
          </div>
        </div>
        <ChevronUp
          size={14}
          className={`text-soft transition-transform duration-150 ${menuOpen ? "" : "rotate-180"}`}
        />
      </button>

      <PopoverMenu open={menuOpen} onClose={closeMenu}>
        {/* Account list */}
        {hasMultipleAccounts && (
          <>
            <AccountList
              accounts={accounts}
              activePubkey={pubkey}
              onSwitch={(pk) => {
                closeMenu();
                switchTo(pk);
              }}
            />
            <PopoverMenuSeparator />
          </>
        )}

        <PopoverMenuItem
          icon={<Pencil size={14} />}
          label="Edit Profile"
          onClick={() => {
            closeMenu();
            setEditOpen(true);
          }}
        />
        <PopoverMenuItem
          icon={<User size={14} />}
          label="View Profile"
          onClick={() => {
            closeMenu();
            navigate(`/profile/${pubkey}`);
          }}
        />
        <PopoverMenuItem
          icon={<Settings size={14} />}
          label="Settings"
          onClick={() => {
            closeMenu();
            navigate("/settings");
          }}
        />

        {hasTauri && (
          <>
            <PopoverMenuSeparator />
            <PopoverMenuItem
              icon={<Plus size={14} />}
              label="Add Account"
              onClick={() => {
                closeMenu();
                setAddAccountOpen(true);
              }}
            />
          </>
        )}

        <PopoverMenuSeparator />
        {hasMultipleAccounts ? (
          <>
            <PopoverMenuItem
              icon={<LogOut size={14} />}
              label="Log Out"
              variant="danger"
              onClick={() => {
                closeMenu();
                logOut();
              }}
            />
            <PopoverMenuItem
              icon={<LogOut size={14} />}
              label="Log Out All Accounts"
              variant="danger"
              onClick={() => {
                closeMenu();
                logOutAll();
              }}
            />
          </>
        ) : (
          <PopoverMenuItem
            icon={<LogOut size={14} />}
            label="Logout"
            variant="danger"
            onClick={() => {
              closeMenu();
              logOut();
            }}
          />
        )}
      </PopoverMenu>

      {editOpen && <ProfileEditModal onClose={() => setEditOpen(false)} />}
      <AddAccountModal
        open={addAccountOpen}
        onClose={() => setAddAccountOpen(false)}
      />
    </>
  );
}

function AccountList({
  accounts,
  activePubkey,
  onSwitch,
}: {
  accounts: { pubkey: string; signerType: string | null; addedAt: number }[];
  activePubkey: string;
  onSwitch: (pubkey: string) => void;
}) {
  return (
    <div className="px-1 py-1">
      <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted">
        Accounts
      </div>
      {accounts.map((account) => (
        <AccountListItem
          key={account.pubkey}
          pubkey={account.pubkey}
          isActive={account.pubkey === activePubkey}
          onSwitch={() => onSwitch(account.pubkey)}
        />
      ))}
    </div>
  );
}

function AccountListItem({
  pubkey,
  isActive,
  onSwitch,
}: {
  pubkey: string;
  isActive: boolean;
  onSwitch: () => void;
}) {
  const { profile } = useProfile(pubkey);

  const displayName =
    profile?.display_name ||
    profile?.name ||
    pubkey.slice(0, 8) + "...";

  return (
    <button
      onClick={isActive ? undefined : onSwitch}
      disabled={isActive}
      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface disabled:cursor-default"
    >
      <Avatar
        src={profile?.picture}
        alt={displayName}
        size="xs"
      />
      <span className="flex-1 truncate text-xs text-heading">
        {displayName}
      </span>
      {isActive && (
        <Check size={12} className="shrink-0 text-primary" />
      )}
    </button>
  );
}
