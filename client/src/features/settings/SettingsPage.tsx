import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Settings, ArrowLeft } from "lucide-react";
import clsx from "clsx";
import { ProfileSettingsTab } from "./ProfileSettingsTab";
import { RelaySettingsTab } from "./RelaySettingsTab";
import { AppSettingsTab } from "./AppSettingsTab";

type Tab = "profile" | "relays" | "app";

const tabs: { id: Tab; label: string }[] = [
  { id: "profile", label: "Profile" },
  { id: "relays", label: "Relays" },
  { id: "app", label: "App" },
];

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>("profile");
  const navigate = useNavigate();

  return (
    <div className="flex flex-1 flex-col overflow-y-auto p-4">
      <div className="mb-4 flex items-center gap-2">
        <button
          onClick={() => navigate("/")}
          className="rounded-md p-1 text-soft transition-colors hover:bg-card hover:text-heading"
          title="Back"
        >
          <ArrowLeft size={18} />
        </button>
        <Settings size={18} className="text-neon" />
        <h2 className="text-lg font-bold text-heading">Settings</h2>
      </div>

      <div className="mb-4 flex gap-1 border-b border-edge">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={clsx(
              "px-4 py-2 text-sm font-medium transition-colors",
              activeTab === tab.id
                ? "border-b-2 border-neon text-neon"
                : "text-soft hover:text-heading",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "profile" && <ProfileSettingsTab />}
      {activeTab === "relays" && <RelaySettingsTab />}
      {activeTab === "app" && <AppSettingsTab />}
    </div>
  );
}
