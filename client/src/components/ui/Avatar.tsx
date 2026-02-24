import clsx from "clsx";
import { User } from "lucide-react";

interface AvatarProps {
  src?: string | null;
  alt?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const sizeStyles = {
  sm: "h-6 w-6",
  md: "h-8 w-8",
  lg: "h-12 w-12",
};

const iconSizes = {
  sm: 12,
  md: 16,
  lg: 24,
};

export function Avatar({ src, alt, size = "md", className }: AvatarProps) {
  if (src) {
    return (
      <img
        src={src}
        alt={alt ?? "avatar"}
        className={clsx(
          "rounded-full object-cover",
          sizeStyles[size],
          className,
        )}
      />
    );
  }

  return (
    <div
      className={clsx(
        "flex items-center justify-center rounded-full bg-card-hover",
        sizeStyles[size],
        className,
      )}
    >
      <User size={iconSizes[size]} className="text-soft" />
    </div>
  );
}
