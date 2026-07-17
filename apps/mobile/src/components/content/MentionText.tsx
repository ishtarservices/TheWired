import { useEffect } from "react";
import { useNavigation } from "@react-navigation/native";

import { Type } from "@/components/ui/Type";
import { useEngine } from "@/lib/nostr/EngineContext";
import { profileDisplayName } from "@/lib/nostr/profiles";
import { useAppSelector } from "@/store/hooks";
import { cn } from "@/lib/cn";
import type { TypeRole } from "@/theme/typography";

// Inline npub/nprofile mention: @name, weight-600 (monochrome design —
// differentiation by weight, never a link color), tap → Profile. Renders
// NESTED inside the NoteText root <Type>, so it must stay a Text node.

export interface MentionTextProps {
  pubkey: string;
  role?: TypeRole;
  /** Color class inherited from the surface (DM own-bubble tint etc.). */
  className?: string;
}

export function MentionText({ pubkey, role = "body", className }: MentionTextProps) {
  const navigation = useNavigation();
  const engine = useEngine();
  const profile = useAppSelector((s) => s.profiles.byPubkey[pubkey]);

  // Backfill the kind-0 — requestProfiles dedups against store + in-flight.
  useEffect(() => {
    engine.requestProfiles([pubkey]);
  }, [engine, pubkey]);

  return (
    <Type
      role={role}
      weight={600}
      className={cn("text-heading", className)}
      accessibilityRole="link"
      onPress={() => navigation.navigate("Profile", { pubkey })}
      suppressHighlighting
    >
      @{profileDisplayName(profile, pubkey)}
    </Type>
  );
}
