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
  VoiceType,
} from "./types";

export const BRAND = {
  name: "DB.Mélo",
  artist: "DB.Mélo",
  album: "DB.Mélo — Chansons personnalisées",
  tagline: "Votre histoire, chantée en qualité studio.",
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

export interface Plan {
  id: PlanId;
  name: string;
  tagline: string;
  features: string[];
  prices: Record<Currency, number>;
  highlight?: boolean;
}

// XOF et XAF sont arrimés à l'euro (1 € = 655,957 FCFA). Les montants FCFA sont des multiples de 5 (exigé par CinetPay).
export const PLANS: Record<PlanId, Plan> = {
  essentiel: {
    id: "essentiel",
    name: "Essentiel",
    tagline: "La chanson qui fait pleurer de joie",
    features: [
      "2 versions : rythmée + acoustique",
      "MP3 HD sans watermark",
      "Paroles synchronisées (karaoké)",
      "Page cadeau + QR code",
    ],
    prices: { XOF: 9900, XAF: 9900, EUR: 15, USD: 17 },
  },
  prestige: {
    id: "prestige",
    name: "Prestige Studio",
    tagline: "L'édition collector",
    features: [
      "Tout l'Essentiel, avec 4 prises",
      "Fichier WAV qualité studio",
      "Pochette IA avec votre photo",
      "Page cadeau premium",
    ],
    prices: { XOF: 19900, XAF: 19900, EUR: 30, USD: 34 },
    highlight: true,
  },
};

export const CURRENCIES: Record<Currency, { label: string; zeroDecimal: boolean }> = {
  XOF: { label: "FCFA (UEMOA)", zeroDecimal: true },
  XAF: { label: "FCFA (CEMAC)", zeroDecimal: true },
  EUR: { label: "Euro", zeroDecimal: false },
  USD: { label: "Dollar US", zeroDecimal: false },
};

/* ───────────────────────────── Mobile Money ───────────────────────────── */

export const OPERATORS: Record<MobileOperator, { label: string; color: string; text: string }> = {
  orange_money: { label: "Orange Money", color: "#FF7900", text: "#111" },
  wave: { label: "Wave", color: "#1DC8FF", text: "#04223A" },
  mtn_momo: { label: "MTN MoMo", color: "#FFCC00", text: "#111" },
  moov_money: { label: "Moov Money", color: "#0066B3", text: "#fff" },
};

export interface CountryOption {
  code: CountryCode;
  label: string;
  flag: string;
  dial: string;
  currency: Currency;
  operators: MobileOperator[];
  /** Chiffres du numéro national. */
  digits: number[];
}

export const COUNTRIES: CountryOption[] = [
  { code: "CI", label: "Côte d'Ivoire", flag: "🇨🇮", dial: "225", currency: "XOF", operators: ["orange_money", "mtn_momo", "moov_money", "wave"], digits: [10] },
  { code: "SN", label: "Sénégal", flag: "🇸🇳", dial: "221", currency: "XOF", operators: ["orange_money", "wave"], digits: [9] },
  { code: "BF", label: "Burkina Faso", flag: "🇧🇫", dial: "226", currency: "XOF", operators: ["orange_money", "moov_money"], digits: [8] },
  { code: "ML", label: "Mali", flag: "🇲🇱", dial: "223", currency: "XOF", operators: ["orange_money", "moov_money"], digits: [8] },
  { code: "CM", label: "Cameroun", flag: "🇨🇲", dial: "237", currency: "XAF", operators: ["orange_money", "mtn_momo"], digits: [9] },
  { code: "TG", label: "Togo", flag: "🇹🇬", dial: "228", currency: "XOF", operators: ["moov_money"], digits: [8] },
  { code: "BJ", label: "Bénin", flag: "🇧🇯", dial: "229", currency: "XOF", operators: ["mtn_momo", "moov_money"], digits: [8, 10] },
  { code: "NE", label: "Niger", flag: "🇳🇪", dial: "227", currency: "XOF", operators: ["orange_money", "moov_money"], digits: [8] },
  { code: "GA", label: "Gabon", flag: "🇬🇦", dial: "241", currency: "XAF", operators: ["moov_money"], digits: [8, 9] },
  { code: "CG", label: "Congo", flag: "🇨🇬", dial: "242", currency: "XAF", operators: ["mtn_momo"], digits: [9] },
];

export const label = <T extends { id: string; label: string }>(list: T[], id: string | undefined) =>
  list.find((o) => o.id === id)?.label ?? "";
