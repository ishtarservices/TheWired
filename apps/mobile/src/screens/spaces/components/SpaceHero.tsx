import { useState } from "react";
import { Image, Pressable, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Boxes, Eye } from "lucide-react-native";
import type { SpaceDetail } from "@/lib/api/spaces";

import { Avatar } from "@/components/ui/Avatar";
import { Pill } from "@/components/ui/Pill";
import { Type } from "@/components/ui/Type";
import { safeImageUri } from "@/lib/nostr/noteContent";
import { useTheme } from "@/theme/ThemeContext";

// The space's identity block: cover (its picture, blurred by scale + scrim),
// overlapping avatar, pills, living stats, expandable about, tags. Space has
// no banner field (desktop parity) — the picture doubles as the cover.

const ABOUT_CLAMP_CHARS = 160;

function StatDivider() {
  return (
    <Type role="micro" className="text-faint">
      ·
    </Type>
  );
}

export function SpaceHero({
  detail,
  isMember,
}: {
  detail: SpaceDetail;
  isMember: boolean;
}) {
  const { tokens } = useTheme();
  const [aboutExpanded, setAboutExpanded] = useState(false);
  const cover = safeImageUri(detail.picture);
  const isNative = detail.spaceMode === "nip29";
  const isReadOnly = detail.mode === "read";
  const aboutNeedsToggle = (detail.about?.length ?? 0) > ABOUT_CLAMP_CHARS;

  const stats: string[] = [];
  if (detail.memberCount > 0) {
    stats.push(`${detail.memberCount} member${detail.memberCount === 1 ? "" : "s"}`);
  }
  if (detail.activeMembers24h > 0) stats.push(`${detail.activeMembers24h} active today`);
  if (detail.messagesLast24h > 0) stats.push(`${detail.messagesLast24h} messages/24h`);

  return (
    <View>
      {/* Cover */}
      <View className="h-32 overflow-hidden rounded-2xl bg-card">
        {cover ? (
          <>
            <Image
              source={{ uri: cover }}
              resizeMode="cover"
              blurRadius={12}
              style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
              accessibilityIgnoresInvertColors
            />
            <LinearGradient
              colors={["rgba(0,0,0,0.1)", "rgba(0,0,0,0.55)"]}
              style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
            />
          </>
        ) : (
          <View className="absolute inset-0 items-center justify-center bg-primary-dim">
            <Boxes size={32} color={tokens.primarySoft} strokeWidth={1.5} />
          </View>
        )}
      </View>

      {/* Overlapping avatar + name block */}
      <View className="px-1" style={{ marginTop: -34 }}>
        <View className="self-start rounded-full bg-background p-1">
          <Avatar uri={detail.picture} name={detail.name} pubkey={detail.id} size={68} />
        </View>

        <View className="mt-2 flex-row flex-wrap items-center gap-2">
          <Type role="title" className="shrink text-heading" numberOfLines={2}>
            {detail.name}
          </Type>
        </View>

        <View className="mt-2 flex-row flex-wrap items-center gap-1.5">
          {isMember ? <Pill label="joined" tone="primary" /> : null}
          {detail.featured ? <Pill label="featured" /> : null}
          {isNative ? <Pill label="nip-29" /> : null}
          {isReadOnly ? (
            <View className="flex-row items-center gap-1 self-start rounded-full bg-surface-hover px-2.5 py-1">
              <Eye size={11} color={tokens.soft} />
              <Type role="micro" weight={500} className="text-soft">
                read-only
              </Type>
            </View>
          ) : null}
          {detail.category ? <Pill label={detail.category} className="lowercase" /> : null}
        </View>

        {stats.length > 0 ? (
          <View className="mt-2.5 flex-row flex-wrap items-center gap-1.5">
            {stats.map((stat, i) => (
              <View key={stat} className="flex-row items-center gap-1.5">
                {i > 0 ? <StatDivider /> : null}
                <Type role="micro" tabular weight={500} className="text-muted">
                  {stat}
                </Type>
              </View>
            ))}
          </View>
        ) : null}

        {detail.about ? (
          <View className="mt-3">
            <Type
              role="caption"
              className="leading-5 text-soft"
              numberOfLines={aboutExpanded ? undefined : 3}
            >
              {detail.about}
            </Type>
            {aboutNeedsToggle ? (
              <Pressable
                accessibilityRole="button"
                hitSlop={8}
                onPress={() => setAboutExpanded((v) => !v)}
              >
                <Type role="micro" weight={600} className="mt-1 text-primary-soft">
                  {aboutExpanded ? "less" : "more"}
                </Type>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {detail.tags.length > 0 ? (
          <View className="mt-3 flex-row flex-wrap gap-1.5">
            {detail.tags.slice(0, 6).map((tag) => (
              <Pill key={tag} label={tag} />
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}
