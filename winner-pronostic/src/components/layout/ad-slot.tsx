import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

/**
 * Emplacement publicitaire des comptes gratuits. Par défaut, il met en avant
 * l'offre Premium ; un réseau publicitaire pourra y être branché plus tard.
 */
export async function AdSlot() {
  const supabase = await createClient();
  const [{ data: setting }, profile] = await Promise.all([
    supabase.from("app_settings").select("value").eq("key", "ads_enabled").maybeSingle(),
    getCurrentProfile().catch(() => null),
  ]);
  if (setting?.value === false || profile?.isPremium) return null;
  return (
    <aside aria-label="Publicité" className="rounded-(--radius-card) border border-gold/30 bg-gradient-to-r from-gold/10 to-transparent p-4">
      <p className="text-[10px] font-bold uppercase tracking-wider text-faint">Publicité</p>
      <p className="mt-1 font-display text-lg font-extrabold uppercase">👑 Tous les pronostics avec Premium</p>
      <p className="text-sm text-muted">Rapports complets, codes illimités et alertes. Dès 1 000 F par semaine via Orange Money ou Moov Money.</p>
      <Link href="/premium" className="mt-2 inline-block text-sm font-semibold text-gold underline">
        Découvrir Premium →
      </Link>
    </aside>
  );
}
