import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Settings, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePlaybackBarSpacing } from "@/hooks/usePlaybackBarSpacing";
import { ProfileSettingsTab } from "./ProfileSettingsTab";
import { RelaySettingsTab } from "./RelaySettingsTab";
import { StorageSettingsTab } from "./StorageSettingsTab";
import { AppSettingsTab } from "./AppSettingsTab";
import { NotificationSettingsTab } from "./NotificationSettingsTab";
import { SecuritySettingsTab } from "./SecuritySettingsTab";
import { ThemeSettingsTab } from "./ThemeSettingsTab";
import { WalletSettingsTab } from "./WalletSettingsTab";
import { FeaturesSettingsTab } from "./FeaturesSettingsTab";
import { AISettingsTab } from "./AISettingsTab";
import { VoiceSettingsTab } from "./VoiceSettingsTab";
import { useAppSelector } from "@/store/hooks";
import { selectFeatureEnabled, FEATURE_AI } from "@/store/slices/featuresSlice";

type Tab = "profile" | "appearance" | "relays" | "storage" | "notifications" | "voice" | "security" | "wallet" | "features" | "ai" | "app";

const baseTabs: { id: Tab; label: string }[] = [
  { id: "profile", label: "Profile" },
  { id: "appearance", label: "Appearance" },
  { id: "relays", label: "Relays" },
  { id: "storage", label: "Storage" },
  { id: "notifications", label: "Notifications" },
  { id: "voice", label: "Voice & Video" },
  { id: "security", label: "Security" },
  { id: "wallet", label: "Wallet" },
  { id: "features", label: "Features" },
  { id: "app", label: "App" },
];

export function SettingsPage() {
  const [searchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const aiEnabled = useAppSelector(selectFeatureEnabled(FEATURE_AI));
  // AI slots in just before "App".
  const appIndex = baseTabs.findIndex((t) => t.id === "app");
  const tabs = aiEnabled
    ? [
        ...baseTabs.slice(0, appIndex),
        { id: "ai" as Tab, label: "AI" },
        ...baseTabs.slice(appIndex),
      ]
    : baseTabs;
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
              "-mb-px border-b-2 px-3 py-2 text-[13px] font-medium transition-colors",
              activeTab === tab.id
                ? "border-primary text-heading"
                : "border-transparent text-soft hover:text-heading",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "profile" && <ProfileSettingsTab />}
      {activeTab === "appearance" && <ThemeSettingsTab />}
      {activeTab === "relays" && <RelaySettingsTab />}
      {activeTab === "storage" && <StorageSettingsTab />}
      {activeTab === "notifications" && <NotificationSettingsTab />}
      {activeTab === "voice" && <VoiceSettingsTab />}
      {activeTab === "security" && <SecuritySettingsTab />}
      {activeTab === "wallet" && <WalletSettingsTab />}
      {activeTab === "features" && <FeaturesSettingsTab />}
      {activeTab === "ai" && <AISettingsTab />}
      {activeTab === "app" && <AppSettingsTab />}
    </div>
  );
}
