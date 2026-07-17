import { useState } from "react";
import { Image, Text, View } from "react-native";

import { cn } from "@/lib/cn";
import { safeImageUri } from "@/lib/nostr/noteContent";

// Deterministic fallback color per identity — stands in for the desktop
// Avatar's gradient fallback until profile data flows.
function hueFromSeed(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 360;
}

export interface AvatarProps {
  uri?: string | null;
  /** Display name — first character becomes the fallback initial. */
  name?: string;
  /** Hex pubkey — seeds the fallback color (falls back to name). */
  pubkey?: string;
  /** Diameter in pt. */
  size?: number;
  className?: string;
}

export function Avatar({ uri, name, pubkey, size = 40, className }: AvatarProps) {
  const dimension = { width: size, height: size, borderRadius: size / 2 };
  // A 404/dead-host bitmap must not stick as a grey bg-card circle forever —
  // fall through to the initial fallback. Comparing against the failed uri
  // (not a boolean) self-resets when a kind-0 refresh changes the picture.
  const [failedUri, setFailedUri] = useState<string | null>(null);

  // Profile pictures are untrusted kind-0 data — sanitize before RCTImage.
  const safeUri = safeImageUri(uri);
  if (safeUri && failedUri !== safeUri) {
    return (
      <Image
        source={{ uri: safeUri }}
        style={dimension}
        className={cn("bg-card", className)}
        onError={() => setFailedUri(safeUri)}
        testID="avatar-image"
        accessibilityIgnoresInvertColors
      />
    );
  }

  const seed = pubkey || name || "?";
  const hue = hueFromSeed(seed);
  const initial = (name?.trim()[0] ?? seed[0] ?? "?").toUpperCase();

  return (
    <View
      style={[dimension, { backgroundColor: `hsl(${hue}, 45%, 35%)` }]}
      className={cn("items-center justify-center", className)}
    >
      <Text
        style={{ fontSize: size * 0.42, color: "hsl(0, 0%, 100%)" }}
        className="font-semibold"
      >
        {initial}
      </Text>
    </View>
  );
}
