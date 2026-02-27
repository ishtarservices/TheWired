import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronUp, Pencil, User, Settings, LogOut } from "lucide-react";
import { Avatar } from "../../components/ui/Avatar";
import {
  PopoverMenu,
  PopoverMenuItem,
  PopoverMenuSeparator,
} from "../../components/ui/PopoverMenu";
import { ProfileEditModal } from "../profile/ProfileEditModal";
import { useIdentity } from "./useIdentity";

export function ProfileCard() {
  const { pubkey, profile, logOut } = useIdentity();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const toggleMenu = useCallback(() => setMenuOpen((v) => !v), []);
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  if (!pubkey) return null;

  const displayName =
    profile?.display_name || profile?.name || pubkey.slice(0, 8) + "...";

  return (
    <>
      <button
        onClick={toggleMenu}
        className="flex w-full items-center gap-2 rounded-xl p-1 transition-colors hover:bg-white/[0.02]"
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
        <PopoverMenuSeparator />
        <PopoverMenuItem
          icon={<LogOut size={14} />}
          label="Logout"
          variant="danger"
          onClick={() => {
            closeMenu();
            logOut();
          }}
        />
      </PopoverMenu>

      {editOpen && <ProfileEditModal onClose={() => setEditOpen(false)} />}
    </>
  );
}
