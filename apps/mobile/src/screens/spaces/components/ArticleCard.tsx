import { Image, View } from "react-native";
import type { ArticleItem } from "../articleParser";

import { Avatar } from "@/components/ui/Avatar";
import { Card } from "@/components/ui/Card";
import { Type } from "@/components/ui/Type";
import { profileDisplayName } from "@/lib/nostr/profiles";
import { formatRelativeTime } from "@/lib/time";
import { useAppSelector } from "@/store/hooks";

// Long-form article card for the articles channel: cover, title, summary,
// author. Tap opens the reader (root Article screen via naddr).

export function ArticleCard({
  article,
  onPress,
  onLongPress,
}: {
  article: ArticleItem;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const profile = useAppSelector((s) => s.profiles.byPubkey[article.event.pubkey]);
  const name = profileDisplayName(profile, article.event.pubkey);

  return (
    <Card onPress={onPress} onLongPress={onLongPress} haptic={false} className="overflow-hidden p-0">
      {article.image ? (
        <Image
          source={{ uri: article.image }}
          resizeMode="cover"
          className="h-32 w-full bg-surface"
          accessibilityIgnoresInvertColors
        />
      ) : null}
      <View className="p-4">
        <Type role="headline" className="text-heading" numberOfLines={2}>
          {article.title}
        </Type>
        {article.summary ? (
          <Type role="caption" className="mt-1.5 leading-5 text-soft" numberOfLines={2}>
            {article.summary}
          </Type>
        ) : null}
        <View className="mt-3 flex-row items-center gap-2">
          <Avatar
            uri={profile?.picture}
            name={name}
            pubkey={article.event.pubkey}
            size={20}
          />
          <Type role="micro" weight={500} className="shrink text-muted" numberOfLines={1}>
            {name}
          </Type>
          <Type role="micro" tabular className="text-faint">
            {formatRelativeTime(article.publishedAt)}
          </Type>
        </View>
      </View>
    </Card>
  );
}
