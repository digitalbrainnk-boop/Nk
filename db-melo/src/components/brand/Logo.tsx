import Link from "next/link";

export function LogoMark({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="lg-gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#F3C969" />
          <stop offset="0.6" stopColor="#E5A93C" />
          <stop offset="1" stopColor="#9A6B1C" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="#161622" />
      <circle cx="32" cy="32" r="22" fill="none" stroke="url(#lg-gold)" strokeWidth="2.5" />
      <circle cx="32" cy="32" r="15" fill="none" stroke="#2A2A3C" strokeWidth="1.5" />
      <path d="M36 18v20.5a6 6 0 1 1-3-5.2V22.5l-6 1.6v-4z" fill="url(#lg-gold)" />
    </svg>
  );
}

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5" aria-label="DB.Mélo — accueil">
      <LogoMark />
      <span className="font-display text-lg font-bold tracking-tight">
        DB<span className="text-gold">.</span>Mélo
      </span>
    </Link>
  );
}
