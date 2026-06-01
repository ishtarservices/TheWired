import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Settings, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePlaybackBarSpacing } from "@/hooks/usePlaybackBarSpacing";
import { ProfileSettingsTab } from "./ProfileSettingsTab";
import { RelaySettingsTab } from "./RelaySettingsTab";
import { AppSettingsTab } from "./AppSettingsTab";
import { NotificationSettingsTab } from "./NotificationSettingsTab";
import { SecuritySettingsTab } from "./SecuritySettingsTab";
import { ThemeSettingsTab } from "./ThemeSettingsTab";
import { WalletSettingsTab } from "./WalletSettingsTab";
import { FeaturesSettingsTab } from "./FeaturesSettingsTab";

type Tab = "profile" | "appearance" | "relays" | "notifications" | "security" | "wallet" | "features" | "app";

const tabs: { id: Tab; label: string }[] = [
  { id: "profile", label: "Profile" },
  { id: "appearance", label: "Appearance" },
  { id: "relays", label: "Relays" },
  { id: "notifications", label: "Notifications" },
  { id: "security", label: "Security" },
  { id: "wallet", label: "Wallet" },
  { id: "features", label: "Features" },
  { id: "app", label: "App" },
];

export function SettingsPage() {
  const [searchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const [activeTab, setActiveTab] = useState<Tab>(() =>
    tabs.some((t) => t.id === requestedTab) ? (requestedTab as Tab) : "profile",
  );
  const navigate = useNavigate();
  const { scrollPaddingClass } = usePlaybackBarSpacing();

  return (
    <div data-tour="settings-content" className={`flex flex-1 flex-col overflow-y-auto p-4 ${scrollPaddingClass}`}>
      <div className="mb-4 flex items-center gap-2">
        <button
          onClick={() => navigate("/")}
          className="rounded-md p-1 text-soft transition-colors hover:bg-card hover:text-heading"
          title="Back"
        >
          <ArrowLeft size={18} />
        </button>
        <Settings size={18} className="text-primary" />
        <h2 className="text-lg font-bold text-heading">Settings</h2>
      </div>

      <div className="mb-4 flex gap-1 border-b border-border">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "px-4 py-2 text-sm font-medium transition-colors",
              activeTab === tab.id
                ? "border-b-2 border-primary text-primary"
                : "text-soft hover:text-heading",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "profile" && <ProfileSettingsTab />}
      {activeTab === "appearance" && <ThemeSettingsTab />}
      {activeTab === "relays" && <RelaySettingsTab />}
      {activeTab === "notifications" && <NotificationSettingsTab />}
      {activeTab === "security" && <SecuritySettingsTab />}
      {activeTab === "wallet" && <WalletSettingsTab />}
      {activeTab === "features" && <FeaturesSettingsTab />}
      {activeTab === "app" && <AppSettingsTab />}
    </div>
  );
}
