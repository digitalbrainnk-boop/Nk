// Catalogue DB.Mélo : styles, voix, instruments, occasions, tarifs, opérateurs.
// Les descriptions `suno` sont en anglais : c'est ce que Suno comprend le mieux.
import type {
  CountryCode,
  Currency,
  Emotion,
  InstrumentId,
  MobileOperator,
  MusicStyleId,
  Occasion,
  PlanId,
  SongLanguage,
  SongVariant,
  VoiceType,
} from "./types";

export const BRAND = {
  name: "DB.Mélo",
  artist: "DB.Mélo",
  album: "DB.Mélo — Chansons personnalisées",
  tagline: "Votre histoire, chantée en qualité studio.",
} as const;

/** Coordonnées de DB.Mélo, utilisées quand les variables MERCHANT_* ne sont pas renseignées. */
export const CONTACT = {
  email: "dbmelox@gmail.com",
  whatsapp: "+226 72 83 01 94",
  phone: "+226 75 54 10 16",
  address: "Burkina Faso",
} as const;

export interface VoiceOption {
  id: VoiceType;
  label: string;
  description: string;
  emoji: string;
  suno: string;
  sample: string;
}

export const VOICES: VoiceOption[] = [
  {
    id: "male",
    label: "Voix masculine",
    description: "Chaude, posée, pleine d'émotion",
    emoji: "🎙️",
    suno: "warm male lead vocals, expressive male singer",
    sample: "/samples/voice-male.mp3",
  },
  {
    id: "female",
    label: "Voix féminine",
    description: "Soul, lumineuse, tout en nuances",
    emoji: "🎤",
    suno: "soulful female lead vocals, expressive female singer",
    sample: "/samples/voice-female.mp3",
  },
  {
    id: "duo",
    label: "Duo homme & femme",
    description: "Couplets partagés, refrain à deux voix",
    emoji: "💞",
    suno: "male and female duet, alternating male and female vocals, harmonized chorus",
    sample: "/samples/voice-duo.mp3",
  },
  {
    id: "child",
    label: "Voix d'enfant",
    description: "Berceuses, anniversaires d'enfants, fête des mères/pères",
    emoji: "🧸",
    suno: "child vocals, young child singer, sweet innocent kid voice, simple melody",
    sample: "/samples/voice-child.mp3",
  },
];

export interface StyleOption {
  id: MusicStyleId;
  label: string;
  emoji: string;
  hint: string;
  suno: string;
}

export const STYLES: StyleOption[] = [
  { id: "afropop", label: "Afro-pop", emoji: "🌍", hint: "Mélodieux et solaire", suno: "Afropop, West African pop, bright highlife guitars, bouncy afro groove" },
  { id: "coupe_decale", label: "Coupé-décalé", emoji: "🔥", hint: "Ambiance maquis, ça bouge !", suno: "Coupé-décalé, Ivorian dance music, fast festive percussion, catchy chants" },
  { id: "zouk", label: "Zouk", emoji: "🌴", hint: "Tendre et caribéen", suno: "Zouk love, Caribbean zouk, smooth synths, romantic swaying groove" },
  { id: "rnb", label: "R&B", emoji: "💜", hint: "Smooth et soul", suno: "Contemporary R&B, smooth soul, lush harmonies, laid-back groove" },
  { id: "ballad", label: "Ballade", emoji: "🕯️", hint: "Émotion pure", suno: "Emotional pop ballad, heartfelt, slow build, piano and strings" },
  { id: "amapiano", label: "Amapiano", emoji: "🎹", hint: "Log drum et vibes sud-africaines", suno: "Amapiano, log drum bass, shakers, airy pads, South African house groove" },
  { id: "gospel", label: "Gospel", emoji: "🙏", hint: "Chœurs et louange", suno: "African gospel, uplifting praise, choir backing vocals, organ, joyful worship" },
  { id: "afrobeats", label: "Afrobeats", emoji: "🥁", hint: "Rythmes de Lagos à Accra", suno: "Afrobeats, syncopated drums, catchy hooks, modern Nigerian afrobeats" },
  { id: "rumba", label: "Rumba congolaise", emoji: "🎸", hint: "Guitares sebene", suno: "Congolese rumba, soukous sebene guitars, elegant groove" },
  { id: "mbalax", label: "Mbalax", emoji: "🪘", hint: "Sabar sénégalais", suno: "Mbalax, Senegalese sabar drums, energetic, tama talking drum" },
  { id: "kompa", label: "Kompa", emoji: "🌺", hint: "Groove haïtien", suno: "Kompa, Haitian konpa, smooth guitar and synth groove" },
  { id: "chanson", label: "Variété française", emoji: "🇫🇷", hint: "Chanson à texte", suno: "French chanson pop, variété française, storytelling, elegant arrangement" },
  { id: "reggae", label: "Reggae", emoji: "🟢", hint: "Positive vibes", suno: "Roots reggae, one drop rhythm, warm bass, positive vibes" },
  { id: "hiphop", label: "Afro hip-hop", emoji: "🎧", hint: "Flow et punchlines", suno: "Afro hip-hop, melodic rap, boom bap meets afro percussion" },
];

export interface InstrumentOption {
  id: InstrumentId;
  label: string;
  emoji: string;
  suno: string;
}

export const INSTRUMENTS: InstrumentOption[] = [
  { id: "saxophone", label: "Saxophone", emoji: "🎷", suno: "saxophone" },
  { id: "acoustic_guitar", label: "Guitare acoustique", emoji: "🎸", suno: "acoustic guitar" },
  { id: "balafon_percussion", label: "Balafon & percussions", emoji: "🪘", suno: "balafon, djembe, African percussion" },
  { id: "intimate_piano", label: "Piano intimiste", emoji: "🎹", suno: "intimate piano" },
  { id: "kora", label: "Kora", emoji: "🪕", suno: "kora" },
  { id: "strings", label: "Cordes", emoji: "🎻", suno: "lush strings" },
  { id: "talking_drum", label: "Tama / talking drum", emoji: "🥁", suno: "talking drum" },
  { id: "brass", label: "Cuivres", emoji: "🎺", suno: "brass section" },
];

export interface EmotionOption {
  id: Emotion;
  label: string;
  emoji: string;
  suno: string;
  /** Couleur de l'étape du curseur. */
  color: string;
}

export const EMOTIONS: EmotionOption[] = [
  { id: "joyful", label: "Joyeux & Festif", emoji: "🎉", suno: "joyful, festive, celebratory, bright", color: "#FFB547" },
  { id: "nostalgic", label: "Doux & Nostalgique", emoji: "🌙", suno: "nostalgic, tender, bittersweet, heartfelt", color: "#9B8CFF" },
  { id: "romantic", label: "Romantique", emoji: "🌹", suno: "romantic, loving, warm, sensual", color: "#FF6B8B" },
  { id: "epic", label: "Épique", emoji: "⚡", suno: "epic, powerful, anthemic, cinematic build", color: "#E5A93C" },
];

export interface OccasionOption {
  id: Occasion;
  label: string;
  emoji: string;
  /** Idées de souvenirs proposées dans le formulaire guidé. */
  prompts: string[];
}

export const OCCASIONS: OccasionOption[] = [
  { id: "birthday", label: "Anniversaire", emoji: "🎂", prompts: ["Son âge", "Sa passion", "Une fête mémorable"] },
  { id: "wedding", label: "Mariage", emoji: "💍", prompts: ["Votre rencontre", "La demande", "Vos projets"] },
  { id: "love", label: "Amour", emoji: "❤️", prompts: ["Ce que vous aimez chez elle/lui", "Votre premier rendez-vous", "Un mot doux à vous"] },
  { id: "tribute", label: "Hommage", emoji: "🕊️", prompts: ["Ses valeurs", "Une leçon de vie", "Un souvenir lumineux"] },
  { id: "mothers_day", label: "Fête des mères", emoji: "🌷", prompts: ["Ses sacrifices", "Sa cuisine", "Ses conseils"] },
  { id: "fathers_day", label: "Fête des pères", emoji: "👔", prompts: ["Son courage", "Ses expressions", "Un moment complice"] },
  { id: "lullaby", label: "Berceuse", emoji: "🌙", prompts: ["Son doudou", "Ses petites manies", "Vos rituels du soir"] },
  { id: "graduation", label: "Réussite / Diplôme", emoji: "🎓", prompts: ["Le chemin parcouru", "Ses efforts", "Ses rêves"] },
  { id: "friendship", label: "Amitié", emoji: "🤝", prompts: ["Votre rencontre", "Vos fous rires", "Ce qui vous lie"] },
  { id: "faith", label: "Foi & louange", emoji: "✨", prompts: ["Un verset aimé", "Un témoignage", "Une grâce reçue"] },
  { id: "other", label: "Autre", emoji: "🎵", prompts: ["Le contexte", "Le message", "L'ambiance"] },
];

export const LANGUAGES: { id: SongLanguage; label: string; suno: string }[] = [
  { id: "fr", label: "Français", suno: "sung in French" },
  { id: "en", label: "Anglais", suno: "sung in English" },
  { id: "fr_en", label: "Français + anglais", suno: "sung in French with English hooks" },
  { id: "wolof_fr", label: "Français + wolof", suno: "sung in French with Wolof phrases" },
  { id: "dioula_fr", label: "Français + dioula", suno: "sung in French with Dioula phrases" },
  { id: "lingala_fr", label: "Français + lingala", suno: "sung in French with Lingala phrases" },
];

/** Balises cliquables de l'éditeur, et leur équivalent compris par Suno. */
export const SECTION_TAGS: { label: string; suno: string; numbered?: boolean }[] = [
  { label: "Intro", suno: "Intro" },
  { label: "Couplet", suno: "Verse", numbered: true },
  { label: "Pré-refrain", suno: "Pre-Chorus" },
  { label: "Refrain", suno: "Chorus" },
  { label: "Pont", suno: "Bridge" },
  { label: "Solo Instrumental", suno: "Instrumental Solo" },
  { label: "Outro", suno: "Outro" },
];

export const LIMITS = {
  titleMax: 80,
  lyricsMin: 60,
  lyricsMax: 4500,
  stylesMax: 3,
  instrumentsMax: 4,
  inspirationMax: 200,
  dedicationMax: 500,
  anecdotesMin: 20,
  anecdotesMax: 2000,
  referenceMaxBytes: 20 * 1024 * 1024,
  photoMaxBytes: 8 * 1024 * 1024,
} as const;

/* ───────────────────────────── Tarifs ───────────────────────────── */

export interface CurrencyInfo {
  label: string;
  /** Pas de centimes (XOF, XAF…) : utile pour Stripe. */
  zeroDecimal: boolean;
}

export const CURRENCIES: Record<Currency, CurrencyInfo> = {
  XOF: { label: "FCFA (UEMOA)", zeroDecimal: true },
  XAF: { label: "FCFA (CEMAC)", zeroDecimal: true },
  GNF: { label: "Franc guinéen", zeroDecimal: true },
  CDF: { label: "Franc congolais", zeroDecimal: false },
  GHS: { label: "Cedi ghanéen", zeroDecimal: false },
  KES: { label: "Shilling kényan", zeroDecimal: false },
  UGX: { label: "Shilling ougandais", zeroDecimal: true },
  TZS: { label: "Shilling tanzanien", zeroDecimal: false },
  RWF: { label: "Franc rwandais", zeroDecimal: true },
  ZMW: { label: "Kwacha zambien", zeroDecimal: false },
  EUR: { label: "Euro", zeroDecimal: false },
  USD: { label: "Dollar US", zeroDecimal: false },
};

/**
 * Prix d'une chanson : 1 200 FCFA.
 * Hors zone FCFA (Mobile Money en monnaie locale), les montants sont des équivalents
 * approximatifs : ajuste-les ici selon les taux du moment. Les montants FCFA, GNF et CDF
 * sont des multiples de 5 (exigé par CinetPay).
 */
export const SONG_PRICES: Record<Currency, number> = {
  XOF: 1200,
  XAF: 1200,
  GNF: 18000,
  CDF: 6000,
  GHS: 24,
  KES: 280,
  UGX: 7800,
  TZS: 5400,
  RWF: 3000,
  ZMW: 54,
  EUR: 1.8,
  USD: 2.1,
};

/** Devises proposées pour le paiement par carte (la banque du client convertit si besoin). */
export const CARD_CURRENCIES: Currency[] = ["XOF", "EUR", "USD"];

export interface Plan {
  id: PlanId;
  name: string;
  tagline: string;
  features: string[];
  prices: Record<Currency, number>;
  /** Offre proposée à la vente. */
  enabled: boolean;
  highlight?: boolean;
}

export const PLANS: Record<PlanId, Plan> = {
  essentiel: {
    id: "essentiel",
    name: "Chanson complète",
    tagline: "Composée pour vous juste après le paiement",
    features: [
      "2 versions de votre chanson, au choix",
      "MP3 HD sans watermark, à garder sur votre téléphone",
      "Paroles synchronisées (karaoké)",
      "Page cadeau + QR code",
    ],
    prices: SONG_PRICES,
    enabled: true,
  },
  // Offre désactivée : passe `enabled` à true et fixe ses prix pour la proposer (WAV, 4 prises, pochette IA).
  prestige: {
    id: "prestige",
    name: "Prestige Studio",
    tagline: "L'édition collector",
    features: ["Tout l'essentiel, avec 4 prises", "Fichier WAV qualité studio", "Pochette IA avec votre photo", "Page cadeau premium"],
    prices: Object.fromEntries(Object.entries(SONG_PRICES).map(([c, p]) => [c, p * 2])) as Record<Currency, number>,
    enabled: false,
    highlight: true,
  },
};

export const ACTIVE_PLANS = Object.values(PLANS).filter((p) => p.enabled);

/* ───────────────────────────── Mobile Money ───────────────────────────── */

export const OPERATORS: Record<MobileOperator, { label: string; color: string; text: string }> = {
  orange_money: { label: "Orange Money", color: "#FF7900", text: "#111" },
  wave: { label: "Wave", color: "#1DC8FF", text: "#04223A" },
  mtn_momo: { label: "MTN MoMo", color: "#FFCC00", text: "#111" },
  moov_money: { label: "Moov Money", color: "#0066B3", text: "#fff" },
  airtel_money: { label: "Airtel Money", color: "#E40000", text: "#fff" },
  mpesa: { label: "M-Pesa", color: "#43B02A", text: "#fff" },
  free_money: { label: "Free Money", color: "#CD1E25", text: "#fff" },
  tmoney: { label: "T-Money", color: "#00A0E3", text: "#fff" },
  telecel_cash: { label: "Telecel Cash", color: "#E60000", text: "#fff" },
  airteltigo_money: { label: "AirtelTigo Money", color: "#1D4F91", text: "#fff" },
  africell_money: { label: "Afrimoney", color: "#7B2C8E", text: "#fff" },
  mixx: { label: "Mixx by Yas", color: "#0E2C74", text: "#fff" },
  halopesa: { label: "HaloPesa", color: "#F58220", text: "#111" },
  zamtel_money: { label: "Zamtel Money", color: "#00A651", text: "#fff" },
};

export interface CountryOption {
  code: CountryCode;
  label: string;
  flag: string;
  dial: string;
  /** Mobile Money pris en charge par au moins une passerelle : devise et opérateurs. */
  momo?: { currency: Currency; operators: MobileOperator[] };
  /** Longueur du numéro national, quand elle est fixe. */
  digits?: number[];
}

const flag = (code: string) => String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));

// Les 54 pays d'Afrique. Sans Mobile Money pris en charge, le paiement se fait par carte bancaire.
const RAW_COUNTRIES: [CountryCode, string, string, CountryOption["momo"]?, number[]?][] = [
  ["DZ", "Algérie", "213"],
  ["AO", "Angola", "244"],
  ["BJ", "Bénin", "229", { currency: "XOF", operators: ["mtn_momo", "moov_money"] }, [8, 10]],
  ["BW", "Botswana", "267"],
  ["BF", "Burkina Faso", "226", { currency: "XOF", operators: ["orange_money", "moov_money"] }, [8]],
  ["BI", "Burundi", "257"],
  ["CV", "Cap-Vert", "238"],
  ["CM", "Cameroun", "237", { currency: "XAF", operators: ["orange_money", "mtn_momo"] }, [9]],
  ["CF", "Centrafrique", "236"],
  ["KM", "Comores", "269"],
  ["CG", "Congo-Brazzaville", "242"],
  ["CD", "RD Congo", "243", { currency: "CDF", operators: ["orange_money", "airtel_money", "mpesa", "africell_money"] }, [9]],
  ["CI", "Côte d'Ivoire", "225", { currency: "XOF", operators: ["orange_money", "mtn_momo", "moov_money", "wave"] }, [10]],
  ["DJ", "Djibouti", "253"],
  ["EG", "Égypte", "20"],
  ["ER", "Érythrée", "291"],
  ["SZ", "Eswatini", "268"],
  ["ET", "Éthiopie", "251"],
  ["GA", "Gabon", "241"],
  ["GM", "Gambie", "220"],
  ["GH", "Ghana", "233", { currency: "GHS", operators: ["mtn_momo", "telecel_cash", "airteltigo_money"] }, [9]],
  ["GN", "Guinée", "224", { currency: "GNF", operators: ["orange_money", "mtn_momo"] }, [9]],
  ["GQ", "Guinée équatoriale", "240"],
  ["GW", "Guinée-Bissau", "245"],
  ["KE", "Kenya", "254", { currency: "KES", operators: ["mpesa", "airtel_money"] }, [9]],
  ["LS", "Lesotho", "266"],
  ["LR", "Liberia", "231"],
  ["LY", "Libye", "218"],
  ["MG", "Madagascar", "261"],
  ["MW", "Malawi", "265"],
  ["ML", "Mali", "223", { currency: "XOF", operators: ["orange_money", "moov_money"] }, [8]],
  ["MA", "Maroc", "212"],
  ["MU", "Maurice", "230"],
  ["MR", "Mauritanie", "222"],
  ["MZ", "Mozambique", "258"],
  ["NA", "Namibie", "264"],
  ["NE", "Niger", "227", { currency: "XOF", operators: ["airtel_money", "moov_money"] }, [8]],
  ["NG", "Nigeria", "234"],
  ["UG", "Ouganda", "256", { currency: "UGX", operators: ["mtn_momo", "airtel_money"] }, [9]],
  ["RW", "Rwanda", "250", { currency: "RWF", operators: ["mtn_momo", "airtel_money"] }, [9]],
  ["ST", "Sao Tomé-et-Principe", "239"],
  ["SN", "Sénégal", "221", { currency: "XOF", operators: ["orange_money", "wave", "free_money"] }, [9]],
  ["SC", "Seychelles", "248"],
  ["SL", "Sierra Leone", "232"],
  ["SO", "Somalie", "252"],
  ["SD", "Soudan", "249"],
  ["SS", "Soudan du Sud", "211"],
  ["ZA", "Afrique du Sud", "27"],
  ["TZ", "Tanzanie", "255", { currency: "TZS", operators: ["mpesa", "airtel_money", "mixx", "halopesa"] }, [9]],
  ["TD", "Tchad", "235"],
  ["TG", "Togo", "228", { currency: "XOF", operators: ["moov_money", "tmoney"] }, [8]],
  ["TN", "Tunisie", "216"],
  ["ZM", "Zambie", "260", { currency: "ZMW", operators: ["mtn_momo", "airtel_money", "zamtel_money"] }, [9]],
  ["ZW", "Zimbabwe", "263"],
];

export const COUNTRIES: CountryOption[] = RAW_COUNTRIES.map(([code, label, dial, momo, digits]) => ({ code, label, flag: flag(code), dial, momo, digits })).sort(
  (a, b) => a.label.localeCompare(b.label, "fr"),
);

export const COUNTRY_CODES = COUNTRIES.map((c) => c.code);

export const findCountry = (code: string | undefined) => COUNTRIES.find((c) => c.code === code);

/** Numéro national valide pour ce pays (7 à 12 chiffres quand la longueur n'est pas fixe). */
export function validPhone(country: CountryOption, phone: string): boolean {
  if (!/^\d+$/.test(phone)) return false;
  return country.digits ? country.digits.includes(phone.length) : phone.length >= 7 && phone.length <= 12;
}

// Fuseaux horaires → pays, pour présélectionner le pays du client.
const ZONES: Record<string, CountryCode> = {
  Abidjan: "CI", Accra: "GH", Addis_Ababa: "ET", Algiers: "DZ", Asmara: "ER", Bamako: "ML", Bangui: "CF", Banjul: "GM",
  Bissau: "GW", Blantyre: "MW", Brazzaville: "CG", Bujumbura: "BI", Cairo: "EG", Casablanca: "MA", Conakry: "GN",
  Dakar: "SN", Dar_es_Salaam: "TZ", Djibouti: "DJ", Douala: "CM", El_Aaiun: "MA", Freetown: "SL", Gaborone: "BW",
  Harare: "ZW", Johannesburg: "ZA", Juba: "SS", Kampala: "UG", Khartoum: "SD", Kigali: "RW", Kinshasa: "CD",
  Lagos: "NG", Libreville: "GA", Lome: "TG", Luanda: "AO", Lubumbashi: "CD", Lusaka: "ZM", Malabo: "GQ", Maputo: "MZ",
  Maseru: "LS", Mbabane: "SZ", Mogadishu: "SO", Monrovia: "LR", Nairobi: "KE", Ndjamena: "TD", Niamey: "NE",
  Nouakchott: "MR", Ouagadougou: "BF", "Porto-Novo": "BJ", Sao_Tome: "ST", Tripoli: "LY", Tunis: "TN", Windhoek: "NA",
  Antananarivo: "MG", Comoro: "KM", Mauritius: "MU", Mahe: "SC", Cape_Verde: "CV",
};

export function guessCountry(timeZone?: string): CountryCode | null {
  const city = timeZone?.split("/").pop() ?? "";
  return ZONES[city] ?? null;
}

export const label = <T extends { id: string; label: string }>(list: T[], id: string | undefined) =>
  list.find((o) => o.id === id)?.label ?? "";

/** Nom affiché d'une version : prise 1 / 2 d'une même composition, ou arrangement rythmé / acoustique. */
export function variantLabel(v: Pick<SongVariant, "id" | "mood">): string {
  if (v.mood === "take") return v.id === "A" ? "Version 1" : "Version 2";
  return v.mood === "acoustic" ? "Version acoustique" : "Version rythmée";
}
