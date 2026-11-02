import Image from "next/image";
import { cn } from "@/lib/utils/cn";

const PALETTE = ["#22e07d", "#4fb3ff", "#ff8a3d", "#ff5c8a", "#b18cff", "#ffd23f", "#4cc9ff", "#ff6b6b"];

function colorFor(name: string): string {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, "").split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  return (words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[1][0]).toUpperCase();
}

/** Logo d'équipe (API-Sports) ou, à défaut, un écusson avec les initiales. */
export function TeamCrest({ name, logoUrl, size = 28, className }: { name: string; logoUrl?: string | null; size?: number; className?: string }) {
  if (logoUrl) {
    return <Image src={logoUrl} alt="" width={size} height={size} className={cn("shrink-0 object-contain", className)} />;
  }
  const color = colorFor(name);
  return (
    <span
      aria-hidden
      className={cn("grid shrink-0 place-items-center rounded-full font-display text-[11px] font-extrabold", className)}
      style={{ width: size, height: size, background: `${color}22`, color, boxShadow: `inset 0 0 0 1.5px ${color}66` }}
    >
      {initials(name)}
    </span>
  );
}
