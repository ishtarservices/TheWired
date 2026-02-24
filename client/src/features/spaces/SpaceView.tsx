import { ChannelHeader } from "./ChannelHeader";
import { useSpace } from "./useSpace";

interface SpaceViewProps {
  children?: React.ReactNode;
}

export function SpaceView({ children }: SpaceViewProps) {
  const { activeSpace } = useSpace();

  if (!activeSpace) {
    return (
      <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-grid">
        <div className="pointer-events-none absolute inset-0 bg-ambient opacity-60" />
        <div className="relative z-10 text-center">
          <h2 className="text-xl font-bold text-silver-gradient tracking-wide">Select a Space</h2>
          <p className="mt-1 text-sm text-soft">
            Choose a space from the sidebar to get started
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <ChannelHeader />
      <div className="flex flex-1 overflow-hidden">
        {children}
      </div>
    </div>
  );
}
