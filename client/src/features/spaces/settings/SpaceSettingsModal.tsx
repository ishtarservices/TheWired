import { useState } from "react";
import { X, Settings, Hash, Shield, Users, Gavel, Bell, Rss } from "lucide-react";
import { cn } from "@/lib/utils";
import { Modal } from "../../../components/ui/Modal";
import { GeneralTab } from "./GeneralTab";
import { ChannelsTab } from "./ChannelsTab";
import { RolesTab } from "./RolesTab";
import { MembersTab } from "./MembersTab";
import { NotificationsTab } from "./NotificationsTab";
import { ModerationTab } from "../moderation/ModerationTab";
import { usePermissions } from "../usePermissions";
import { useAppSelector } from "../../../store/hooks";

type TabId = "general" | "channels" | "roles" | "members" | "notifications" | "moderation";

interface Tab {
  id: TabId;
  label: string;
  icon: typeof Settings;
  permission?: string;
}

const COMMUNITY_TABS: Tab[] = [
  { id: "general", label: "General", icon: Settings },
  { id: "channels", label: "Channels", icon: Hash },
  { id: "roles", label: "Roles", icon: Shield },
  { id: "members", label: "Members", icon: Users },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "moderation", label: "Moderation", icon: Gavel, permission: "BAN_MEMBERS" },
];

const FEED_TABS: Tab[] = [
  { id: "general", label: "General", icon: Settings },
  { id: "channels", label: "Channels", icon: Hash },
  { id: "members", label: "Feed & Members", icon: Rss },
  { id: "notifications", label: "Notifications", icon: Bell },
];

interface SpaceSettingsModalProps {
  open: boolean;
  onClose: () => void;
  spaceId: string;
}

export function SpaceSettingsModal({ open, onClose, spaceId }: SpaceSettingsModalProps) {
  const [activeTab, setActiveTab] = useState<TabId>("general");
  const { can } = usePermissions(spaceId);
  const space = useAppSelector((s) => s.spaces.list.find((sp) => sp.id === spaceId));
  const isFeedMode = space?.mode === "read";

  const baseTabs = isFeedMode ? FEED_TABS : COMMUNITY_TABS;
  const visibleTabs = baseTabs.filter(
    (tab) => !tab.permission || can(tab.permission),
  );

  return (
    <Modal open={open} onClose={onClose}>
      <div className="flex w-full max-w-2xl rounded-2xl card-glass shadow-2xl overflow-hidden" style={{ height: "min(80vh, 600px)" }}>
        {/* Tab navigation */}
        <div className="flex w-44 shrink-0 flex-col border-r border-edge bg-surface/50">
          <div className="flex items-center justify-between px-4 py-3 border-b border-edge">
            <h2 className="text-sm font-bold text-heading">Settings</h2>
            <button
              onClick={onClose}
              className="rounded-full p-1 text-soft hover:bg-card-hover hover:text-heading transition-colors"
            >
              <X size={16} />
            </button>
          </div>
          <nav className="flex-1 space-y-0.5 p-2">
            {visibleTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm transition-all duration-150",
                  activeTab === tab.id
                    ? "bg-pulse/10 text-pulse"
                    : "text-soft hover:bg-surface-hover hover:text-heading",
                )}
              >
                <tab.icon size={16} />
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === "general" && <GeneralTab spaceId={spaceId} />}
          {activeTab === "channels" && <ChannelsTab spaceId={spaceId} />}
          {activeTab === "roles" && <RolesTab spaceId={spaceId} />}
          {activeTab === "members" && <MembersTab spaceId={spaceId} />}
          {activeTab === "notifications" && <NotificationsTab spaceId={spaceId} />}
          {activeTab === "moderation" && <ModerationTab spaceId={spaceId} />}
        </div>
      </div>
    </Modal>
  );
}
