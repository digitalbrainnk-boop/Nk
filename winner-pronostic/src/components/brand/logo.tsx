import { cn } from "@/lib/utils/cn";

/** Logo Winner Pronostic (SVG inline : aucun téléchargement d'image). */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="66 84 380 360" className={cn("shrink-0", className)} aria-hidden>
      <defs>
        <linearGradient id="wp-logo-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2be38c" />
          <stop offset="1" stopColor="#0e9e57" />
        </linearGradient>
      </defs>
      <circle cx="256" cy="262" r="178" fill="url(#wp-logo-g)" />
      <polyline
        points="160,206 206,334 256,244 306,334 352,206"
        fill="none"
        stroke="#04170d"
        strokeWidth="40"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M256 112 l14.1 28.6 31.5 4.6 -22.8 22.2 5.4 31.4 -28.2 -14.8 -28.2 14.8 5.4 -31.4 -22.8 -22.2 31.5 -4.6z"
        fill="#f6c544"
      />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark className="size-9 drop-shadow-[0_0_12px_rgb(34_224_125/0.45)]" />
      <span className="flex flex-col leading-none">
        <span className="font-display text-[22px] font-extrabold uppercase tracking-wide">Winner</span>
        <span className="font-display text-[11px] font-semibold uppercase tracking-[0.32em] text-brand">Pronostic</span>
      </span>
    </span>
  );
}
