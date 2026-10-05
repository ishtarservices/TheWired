interface UpdateAvailableBadgeProps {
  /** Tooltip / accessible label. */
  title?: string;
  className?: string;
}

/** Pulsing dot: a saved track / project has a newer version than the one saved. */
export function UpdateAvailableBadge({ title = "Update available", className = "" }: UpdateAvailableBadgeProps) {
  return (
    <span
      role="img"
      aria-label={title}
      title={title}
      className={`inline-block h-2.5 w-2.5 rounded-full bg-primary animate-pulse ${className}`}
    />
  );
}
