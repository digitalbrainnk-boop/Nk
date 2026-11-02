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
      <LogoMark className="size-8" />
      <span className="text-[17px] font-extrabold leading-none tracking-tight">
        Winner<span className="text-brand"> Pronostic</span>
      </span>
    </span>
  );
}
