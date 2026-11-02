import { DEFAULT_TIMEZONE } from "@/lib/constants";

/** « 2 novembre 2026 » (fuseau du Burkina Faso). */
export function formatLongDate(value: string | Date): string {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeZone: DEFAULT_TIMEZONE }).format(new Date(value));
}
