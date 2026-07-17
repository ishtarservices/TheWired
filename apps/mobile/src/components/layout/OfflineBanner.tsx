// Connection state without color: a floating hairline-bordered pill in the
// protocol voice — no warning fill (status = contrast + mono, app-wide).
// Rendered as a sibling of NavigationContainer in App.tsx so it floats above
// every screen; pointerEvents none keeps it out of the touch tree.

import { View } from "react-native";

import { Type } from "@/components/ui/Type";
import { useAppSelector } from "@/store/hooks";

/** Presentational half — testable without the store. */
export function OfflineNotice() {
  return (
    <View className="absolute left-0 right-0 top-14 items-center" pointerEvents="none">
      <View className="rounded-full border border-border-light bg-panel px-4 py-1.5">
        <Type role="meta" className="text-soft">
          offline — reconnecting when the network returns
        </Type>
      </View>
    </View>
  );
}

export function OfflineBanner() {
  const isOnline = useAppSelector((s) => s.lifecycle.isOnline);
  if (isOnline) return null;
  return <OfflineNotice />;
}
