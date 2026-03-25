import { useRef } from "react";
import { useProfile } from "@/features/profile/useProfile";

interface MentionLinkProps {
  pubkey: string;
  onClick?: (pubkey: string, anchor: HTMLElement) => void;
}

export function MentionLink({ pubkey, onClick }: MentionLinkProps) {
  const { profile } = useProfile(pubkey);
  const ref = useRef<HTMLButtonElement>(null);

  const displayName =
    profile?.display_name || profile?.name || pubkey.slice(0, 8) + "...";

  return (
    <button
      ref={ref}
      type="button"
      onClick={() => {
        if (onClick && ref.current) onClick(pubkey, ref.current);
      }}
      className="inline text-primary hover:text-primary-soft hover:underline font-medium cursor-pointer"
    >
      @{displayName}
    </button>
  );
}
