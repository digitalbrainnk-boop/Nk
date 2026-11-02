import Link from "next/link";
import { logoMotif } from "@/lib/brand/logo";

/** Logo seul : note et cœur dans un anneau doré, entourés de symboles de musique (voir lib/brand/logo.ts). */
export function LogoMark({ size = 40 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" dangerouslySetInnerHTML={{ __html: logoMotif(`logo-${size}`) }} />;
}

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2" aria-label="DB.Mélo — chansons personnalisées, accueil">
      <LogoMark />
      <span className="flex flex-col">
        <span className="font-display text-lg font-bold leading-none tracking-tight">
          DB<span className="text-gold">.</span>Mélo
        </span>
        <span className="mt-1 hidden text-[10px] font-bold uppercase leading-none tracking-[0.18em] text-gold sm:block">Chansons personnalisées</span>
      </span>
    </Link>
  );
}
