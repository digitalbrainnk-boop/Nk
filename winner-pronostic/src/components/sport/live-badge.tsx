export function LiveBadge({ clock }: { clock?: string | null }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-live/15 px-1.5 py-0.5 text-[11px] font-extrabold uppercase tracking-wide text-live">
      <span className="size-1.5 animate-live-pulse rounded-full bg-live" aria-hidden />
      {clock ? `Live · ${clock}` : "Live"}
    </span>
  );
}
