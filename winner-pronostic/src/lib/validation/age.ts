import { MIN_AGE } from "@/lib/constants";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Analyse une date AAAA-MM-JJ et vérifie qu'elle existe vraiment (pas de 31 février). */
export function parseIsoDate(value: string): { year: number; month: number; day: number } | null {
  const match = ISO_DATE.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return { year, month, day };
}

/**
 * Âge révolu à la date `today` (calcul en UTC, qui correspond à l'heure du
 * Burkina Faso). Même règle que la base de données : une personne née un
 * 29 février fête ses 18 ans le 1er mars les années non bissextiles.
 */
export function computeAge(birthDate: string, today: Date = new Date()): number | null {
  const parsed = parseIsoDate(birthDate);
  if (!parsed) return null;
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth() + 1;
  const d = today.getUTCDate();
  let age = y - parsed.year;
  if (m < parsed.month || (m === parsed.month && d < parsed.day)) age -= 1;
  return age;
}

export function isAdult(birthDate: string, today: Date = new Date(), minAge: number = MIN_AGE): boolean {
  const age = computeAge(birthDate, today);
  return age !== null && age >= minAge;
}

/** Date maximale autorisée dans le sélecteur de date (aujourd'hui − 18 ans). */
export function latestAllowedBirthDate(today: Date = new Date(), minAge: number = MIN_AGE): string {
  const y = today.getUTCFullYear() - minAge;
  const m = String(today.getUTCMonth() + 1).padStart(2, "0");
  const d = String(today.getUTCDate()).padStart(2, "0");
  // Le 29 février n'existe pas toutes les années : on recule au 28.
  return parseIsoDate(`${y}-${m}-${d}`) ? `${y}-${m}-${d}` : `${y}-${m}-28`;
}
