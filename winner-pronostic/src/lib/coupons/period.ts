export type CouponPeriod = "jour" | "weekend" | "long_terme";

export const PERIOD_LABELS: Record<CouponPeriod, { label: string; hint: string }> = {
  jour: { label: "Du jour", hint: "Matchs d'aujourd'hui" },
  weekend: { label: "Week-end", hint: "Samedi et dimanche" },
  long_terme: { label: "7 jours", hint: "Toute la semaine à venir" },
};

const DAY = 86_400_000;

/**
 * Fenêtre de dates d'une période (heure UTC = heure du Burkina Faso).
 *   jour       : maintenant → fin de journée
 *   weekend    : samedi 00:00 → dimanche 23:59 (ou maintenant si on est déjà le week-end)
 *   long_terme : maintenant → +7 jours
 */
export function periodWindow(period: CouponPeriod, now: Date = new Date()): { from: Date; to: Date } {
  const startOfDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (period === "jour") return { from: now, to: new Date(startOfDay + DAY) };
  if (period === "long_terme") return { from: now, to: new Date(now.getTime() + 7 * DAY) };

  const weekday = now.getUTCDay(); // 0 = dimanche, 6 = samedi
  const daysToSaturday = weekday === 0 ? -1 : 6 - weekday;
  const saturday = startOfDay + daysToSaturday * DAY;
  const from = weekday === 6 || weekday === 0 ? now : new Date(saturday);
  return { from, to: new Date(saturday + 2 * DAY) };
}
