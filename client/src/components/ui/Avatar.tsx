import { cn } from "@/lib/utils";
import { User } from "lucide-react";

interface AvatarProps {
  src?: string | null;
  alt?: string;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
}

const sizeStyles = {
  xs: "h-5 w-5",
  sm: "h-8 w-8",
  md: "h-10 w-10",
  lg: "h-14 w-14",
};

const iconSizes = {
  xs: 10,
  sm: 14,
  md: 18,
  lg: 28,
};

export function Avatar({ src, alt, size = "md", className }: AvatarProps) {
  if (src) {
    return (
      <img
        src={src}
        alt={alt ?? "avatar"}
        className={cn(
          "rounded-full object-cover ring-1 ring-white/10",
          sizeStyles[size],
          className,
        )}
      />
    );
  }

  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-full bg-gradient-to-br from-pulse/20 to-neon/10 ring-1 ring-white/10",
        sizeStyles[size],
        className,
      )}
    >
      <User size={iconSizes[size]} className="text-soft" />
    </div>
  );
}
