import { Wifi, Clock, Activity } from "lucide-react";
import { useAppSelector } from "../../store/hooks";
import { RelayStatusBadge } from "./RelayStatusBadge";

export function RelayStatusPanel() {
  const connections = useAppSelector((s) => s.relays.connections);
  const relays = Object.values(connections);

  const connected = relays.filter((r) => r.status === "connected").length;

  return (
    <div className="flex flex-1 flex-col overflow-y-auto p-4">
      <div className="mb-4 flex items-center gap-2">
        <Wifi size={18} className="text-neon" />
        <h2 className="text-lg font-bold text-heading">Relay Status</h2>
        <span className="ml-auto rounded-full bg-card px-2 py-0.5 text-xs text-soft">
          {connected}/{relays.length} connected
        </span>
      </div>

      {relays.length === 0 ? (
        <div className="text-center text-sm text-muted">
          No relay connections
        </div>
      ) : (
        <div className="space-y-2">
          {relays.map((relay) => (
            <div
              key={relay.url}
              className="rounded-lg border-neon-glow bg-card p-3 transition-all duration-150 hover:glow-neon"
            >
              <div className="flex items-center gap-2">
                <RelayStatusBadge status={relay.status} />
                <span className="flex-1 truncate text-sm text-heading">
                  {relay.url.replace("wss://", "")}
                </span>
                <span className="rounded bg-card-hover px-1.5 py-0.5 text-xs text-soft">
                  {relay.mode}
                </span>
              </div>

              <div className="mt-2 flex items-center gap-4 text-xs text-muted">
                <div className="flex items-center gap-1">
                  <Clock size={12} />
                  <span>
                    {relay.latencyMs > 0 ? `${relay.latencyMs}ms` : "--"}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <Activity size={12} />
                  <span>{relay.eventCount} events</span>
                </div>
              </div>

              {relay.error && (
                <p className="mt-1 text-xs text-red-400">{relay.error}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
