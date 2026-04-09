import { Outlet } from "react-router-dom";

export function CenterPanel() {
  return (
    <div data-tour="center-panel" className="flex flex-1 flex-col overflow-hidden bg-background">
      <Outlet />
    </div>
  );
}
