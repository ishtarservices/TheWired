import clsx from "clsx";
import type { RelayStatus } from "../../types/relay";

interface RelayStatusBadgeProps {
  status: RelayStatus;
}

const statusColors: Record<RelayStatus, string> = {
  connected: "bg-green-500",
  connecting: "bg-yellow-500",
  disconnected: "bg-slate-500",
  error: "bg-red-500",
};

export function RelayStatusBadge({ status }: RelayStatusBadgeProps) {
  return (
    <span
      className={clsx("inline-block h-2 w-2 rounded-full", statusColors[status])}
      title={status}
    />
  );
}
