/** Nothing to show: two quiet lines and, when it can be retried, one action. */
export function EmptyState({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="col-span-full py-16 text-center">
      <p className="text-sm text-heading">{title}</p>
      <p className="mt-1 text-xs text-muted">{message}</p>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-4 h-8 rounded-lg border border-border px-3 text-xs text-soft transition-colors hover:bg-surface-hover hover:text-heading"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
