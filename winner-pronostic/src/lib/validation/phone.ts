/**
 * Numéros de téléphone : pays pris en charge et normalisation au format
 * international E.164 (+22670123456), attendu par Supabase Auth.
 */

export type PhoneCountry = {
  code: string; // ISO 3166-1 alpha-2
  name: string;
  dialCode: string; // sans le « + »
  /** Nombre de chiffres du numéro national (sans indicatif ni préfixe 0). */
  nationalLength: number;
  /** Préfixe national à retirer (ex. le « 0 » au Ghana ou en France). */
  trunkPrefix?: string;
  example: string;
};

/** Afrique de l'Ouest en priorité (Burkina Faso en tête), puis diaspora. */
export const PHONE_COUNTRIES: readonly PhoneCountry[] = [
  { code: "BF", name: "Burkina Faso", dialCode: "226", nationalLength: 8, example: "70 12 34 56" },
  { code: "CI", name: "Côte d'Ivoire", dialCode: "225", nationalLength: 10, example: "07 12 34 56 78" },
  { code: "ML", name: "Mali", dialCode: "223", nationalLength: 8, example: "76 12 34 56" },
  { code: "NE", name: "Niger", dialCode: "227", nationalLength: 8, example: "96 12 34 56" },
  { code: "SN", name: "Sénégal", dialCode: "221", nationalLength: 9, example: "77 123 45 67" },
  { code: "TG", name: "Togo", dialCode: "228", nationalLength: 8, example: "90 12 34 56" },
  { code: "BJ", name: "Bénin", dialCode: "229", nationalLength: 10, example: "01 97 12 34 56" },
  { code: "GH", name: "Ghana", dialCode: "233", nationalLength: 9, trunkPrefix: "0", example: "024 123 4567" },
  { code: "GN", name: "Guinée", dialCode: "224", nationalLength: 9, example: "621 12 34 56" },
  { code: "CM", name: "Cameroun", dialCode: "237", nationalLength: 9, example: "6 71 23 45 67" },
  { code: "FR", name: "France", dialCode: "33", nationalLength: 9, trunkPrefix: "0", example: "06 12 34 56 78" },
] as const;

export const DEFAULT_PHONE_COUNTRY = "BF";

export const SUPPORTED_COUNTRY_CODES = PHONE_COUNTRIES.map((c) => c.code) as [string, ...string[]];

export function getPhoneCountry(code: string): PhoneCountry | undefined {
  return PHONE_COUNTRIES.find((c) => c.code === code.toUpperCase());
}

function nationalToE164(national: string, country: PhoneCountry): string | null {
  let digits = national;
  if (country.trunkPrefix && digits.length === country.nationalLength + country.trunkPrefix.length && digits.startsWith(country.trunkPrefix)) {
    digits = digits.slice(country.trunkPrefix.length);
  }
  if (digits.length !== country.nationalLength) return null;
  return `+${country.dialCode}${digits}`;
}

/**
 * Convertit une saisie libre (« 70 12 34 56 », « +226 70-12-34-56 »,
 * « 0022670123456 »…) en numéro E.164, ou renvoie null si invalide.
 * `countryCode` sert pour les numéros saisis sans indicatif.
 */
export function normalizePhone(input: string, countryCode: string = DEFAULT_PHONE_COUNTRY): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > 25) return null;
  // Seuls chiffres, espaces, points, tirets, parenthèses et « + » initial sont acceptés.
  if (!/^\+?[\d\s.\-()]+$/.test(trimmed)) return null;

  const hasPlus = trimmed.startsWith("+");
  let digits = trimmed.replace(/\D/g, "");
  if (!hasPlus && digits.startsWith("00")) {
    digits = digits.slice(2);
    return internationalToE164(digits);
  }
  if (hasPlus) return internationalToE164(digits);

  const country = getPhoneCountry(countryCode);
  if (!country) return null;

  // Numéro national
  const national = nationalToE164(digits, country);
  if (national) return national;

  // Indicatif saisi sans « + » (ex. 22670123456 avec le Burkina sélectionné)
  if (digits.startsWith(country.dialCode)) {
    return nationalToE164(digits.slice(country.dialCode.length), country);
  }
  return null;
}

function internationalToE164(digits: string): string | null {
  // Indicatifs les plus longs d'abord pour éviter les ambiguïtés.
  const candidates = [...PHONE_COUNTRIES].sort((a, b) => b.dialCode.length - a.dialCode.length);
  for (const country of candidates) {
    if (digits.startsWith(country.dialCode)) {
      return nationalToE164(digits.slice(country.dialCode.length), country);
    }
  }
  return null;
}

/** Affichage lisible : +226 70 12 34 56 */
export function formatPhoneForDisplay(e164: string): string {
  const digits = e164.replace(/\D/g, "");
  const country = [...PHONE_COUNTRIES]
    .sort((a, b) => b.dialCode.length - a.dialCode.length)
    .find((c) => digits.startsWith(c.dialCode));
  if (!country) return e164;
  const national = digits.slice(country.dialCode.length);
  const groups = national.match(/.{1,2}/g) ?? [national];
  return `+${country.dialCode} ${groups.join(" ")}`;
}

/** Masque le milieu d'un numéro : +226 70 •• •• 56 */
export function maskPhone(e164: string): string {
  const display = formatPhoneForDisplay(e164);
  const parts = display.split(" ");
  if (parts.length <= 3) return display;
  return [parts[0], parts[1], ...parts.slice(2, -1).map(() => "••"), parts[parts.length - 1]].join(" ");
}
