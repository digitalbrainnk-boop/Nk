// ─────────────────────────────────────────────────────────────────────────────
// DB.Mélo — modèle de données partagé (client + serveur).
// Ce fichier ne contient que des types : il peut être importé partout.
// ─────────────────────────────────────────────────────────────────────────────

/* ───────────────────────────── Configuration d'une chanson ───────────────────────────── */

/** Mode 1 « Studio Paroles » (paroles écrites par l'utilisateur) ou Mode 2 « Parolier & Compositeur IA ». */
export type CreationMode = "studio" | "ai";

export type VoiceType = "male" | "female" | "duo" | "child";

/** Curseur d'émotion. */
export type Emotion = "joyful" | "nostalgic" | "romantic" | "epic";

export type Occasion =
  | "birthday"
  | "wedding"
  | "tribute"
  | "love"
  | "mothers_day"
  | "fathers_day"
  | "lullaby"
  | "graduation"
  | "friendship"
  | "faith"
  | "other";

export type MusicStyleId =
  | "afropop"
  | "coupe_decale"
  | "zouk"
  | "rnb"
  | "ballad"
  | "amapiano"
  | "gospel"
  | "afrobeats"
  | "rumba"
  | "mbalax"
  | "kompa"
  | "chanson"
  | "reggae"
  | "hiphop";

export type InstrumentId =
  | "saxophone"
  | "acoustic_guitar"
  | "balafon_percussion"
  | "intimate_piano"
  | "kora"
  | "strings"
  | "talking_drum"
  | "brass";

export type SongLanguage = "fr" | "en" | "fr_en" | "wolof_fr" | "dioula_fr" | "lingala_fr";

/** Brief du parolier IA (Mode 2). */
export interface AiLyricsBrief {
  recipientName: string;
  nicknames?: string;
  senderName?: string;
  occasion: Occasion;
  anecdotes: string;
  emotion: Emotion;
}

/** Résultat de l'analyse locale (navigateur) du morceau de référence : tempo et énergie. */
export interface ReferenceAnalysis {
  bpm: number | null;
  energy: "low" | "medium" | "high";
  durationSec: number;
}

/** Morceau de référence déposé pour la fonction « Style Match ». */
export interface ReferenceAudio {
  uploadId: string;
  fileName: string;
  analysis?: ReferenceAnalysis;
  /** Reprendre la structure du morceau (Suno « upload-cover »). Exige d'en détenir les droits. */
  useAsCover: boolean;
  rightsConfirmed: boolean;
}

export type CoverChoice = "suno" | "collector" | "ai";

/** Tout ce que l'utilisateur configure avant la création musicale. */
export interface SongConfig {
  mode: CreationMode;
  title: string;
  /** Paroles avec balises françaises : [Couplet], [Refrain], [Pont], [Solo Instrumental], [Outro]… */
  lyrics: string;
  brief?: AiLyricsBrief;
  language: SongLanguage;
  voice: VoiceType;
  emotion: Emotion;
  styles: MusicStyleId[];
  customInspiration?: string;
  instruments: InstrumentId[];
  referenceAudio?: ReferenceAudio | null;
  /** Prénom du destinataire, affiché sur la page cadeau. */
  recipientName?: string;
  /** Mot doux affiché sur la page cadeau. */
  dedication?: string;
  /** Photo pour la pochette personnalisée. */
  photoUploadId?: string | null;
  coverChoice?: CoverChoice;
}

/* ───────────────────────────── API Suno via Kie.ai ───────────────────────────── */

export type KieSunoModel = "V3_5" | "V4" | "V4_5" | "V4_5PLUS" | "V5" | "V6" | "V6_MINI" | "V6_WILD";

/**
 * Corps exact de `POST https://api.kie.ai/api/v1/generate` en mode « Custom Generation ».
 * (Pour `POST /api/v1/generate/upload-cover`, on ajoute `uploadUrl` et `audioWeight`.)
 */
export interface KieGenerationRequest {
  /** Mode personnalisé : `prompt` contient les paroles, `style` et `title` sont obligatoires. */
  customMode: true;
  instrumental: boolean;
  model: KieSunoModel;
  /** Paroles (balises anglaises [Verse], [Chorus]… comprises par Suno). 5000 caractères max en V4_5+/V5. */
  prompt: string;
  /** Style musical, voix et instruments. 1000 caractères max en V4_5+/V5. */
  style: string;
  title: string;
  /** Kie l'exige ; on suit aussi l'avancement par polling (l'adresse peut être injoignable en local). */
  callBackUrl: string;
  negativeTags?: string;
  vocalGender?: "m" | "f";
  /** 0 à 1 : fidélité au style demandé. */
  styleWeight?: number;
  /** 0 à 1 : plus bas = moins expérimental. */
  weirdnessConstraint?: number;
  /** 0 à 1 : poids de l'audio de référence (upload-cover). */
  audioWeight?: number;
  /** URL publique du morceau de référence (upload-cover uniquement). */
  uploadUrl?: string;
}

export type KieTaskStatus =
  | "PENDING"
  | "TEXT_SUCCESS"
  | "FIRST_SUCCESS"
  | "SUCCESS"
  | "CREATE_TASK_FAILED"
  | "GENERATE_AUDIO_FAILED"
  | "CALLBACK_EXCEPTION"
  | "SENSITIVE_WORD_ERROR";

/** Un morceau tel que renvoyé par `GET /api/v1/generate/record-info` (`data.response.sunoData[]`). */
export interface KieSunoTrack {
  id: string;
  audioUrl: string;
  sourceAudioUrl?: string;
  streamAudioUrl?: string;
  imageUrl?: string;
  prompt?: string;
  modelName?: string;
  title?: string;
  tags?: string;
  createTime?: string | number;
  duration?: number;
}

export interface KieRecordInfo {
  taskId: string;
  status: KieTaskStatus;
  response?: { taskId?: string; sunoData?: KieSunoTrack[] | null } | null;
  errorCode?: number | string | null;
  errorMessage?: string | null;
}

/** Mot horodaté (`POST /api/v1/generate/get-timestamped-lyrics`) pour le karaoké. */
export interface AlignedWord {
  word: string;
  startS: number;
  endS: number;
  success?: boolean;
}

/* ───────────────────────────── Chanson stockée ───────────────────────────── */

export type VariantId = "A" | "B";

/** Statut local d'une variante : statuts Kie + « QUEUED » (pas encore envoyée). */
export type VariantStatus = KieTaskStatus | "QUEUED";

export interface StoredTrack {
  audioId: string;
  /** URL Kie/Suno. Jamais envoyée au navigateur avant paiement. */
  audioUrl: string;
  imageUrl?: string;
  duration?: number;
}

export interface SongVariant {
  id: VariantId;
  /**
   * A = rythmée, B = acoustique / douce (deux compositions Suno), ou « take » : les deux prises
   * d'une seule composition, servies comme version 1 et version 2 (deux fois moins de crédits Kie).
   */
  mood: "rhythmic" | "acoustic" | "take";
  /** Pour mood « take » : indice de la prise Suno (0 ou 1) dans la tâche partagée. */
  take?: number;
  taskId?: string;
  status: VariantStatus;
  /** Suno renvoie 2 prises par tâche. */
  tracks: StoredTrack[];
  alignedWords?: AlignedWord[] | null;
  waveform?: number[] | null;
  wav?: { taskId?: string; url?: string; status: "pending" | "ready" | "failed" } | null;
  error?: string;
  startedAt?: number;
  finishedAt?: number;
}

export type GenerationStatus = "idle" | "generating" | "ready" | "failed";
export type PaymentStatus = "unpaid" | "pending" | "paid";
export type PlanId = "essentiel" | "prestige";

export interface SongRecord {
  id: string;
  /** Identifiant public de la page cadeau (différent de l'id privé de la commande). */
  giftSlug: string;
  createdAt: number;
  updatedAt: number;
  config: SongConfig;
  generation: {
    status: GenerationStatus;
    startedAt?: number;
    finishedAt?: number;
    error?: string;
    lastPolledAt?: number;
    /** Nombre de lancements Suno (limité après paiement pour protéger le crédit Kie). */
    attempts?: number;
  };
  variants: Record<VariantId, SongVariant>;
  payment: { status: PaymentStatus; plan?: PlanId; reference?: string; provider?: PaymentProviderId; paidAt?: number; amount?: number; currency?: Currency };
  aiCover?: { status: "pending" | "ready" | "failed"; taskId?: string; url?: string; error?: string } | null;
  /** Créée sans clé Kie : audio de démonstration synthétisé localement. */
  demo: boolean;
}

/** Vue publique d'une chanson (aucune URL audio brute). */
export interface PublicVariant {
  id: VariantId;
  mood: SongVariant["mood"];
  status: VariantStatus;
  takes: number;
  duration?: number;
  alignedWords?: AlignedWord[] | null;
  waveform?: number[] | null;
  wavStatus?: "pending" | "ready" | "failed" | null;
  error?: string;
}

export interface PublicSong {
  id: string;
  giftSlug?: string;
  createdAt: number;
  config: SongConfig;
  generation: { status: GenerationStatus; startedAt?: number; finishedAt?: number; error?: string; attemptsLeft: number };
  variants: Record<VariantId, PublicVariant>;
  payment: { status: PaymentStatus; plan?: PlanId; paidAt?: number };
  aiCoverStatus?: "pending" | "ready" | "failed" | null;
  covers: CoverChoice[];
  coverChoice: CoverChoice;
  demo: boolean;
  previewSeconds: number;
  flowMode: FlowMode;
}

export type FlowMode = "preview_first" | "pay_first";

/** « takes » : 1 composition Suno → 2 prises ; « styles » : 2 compositions (rythmée + acoustique). */
export type VersionsMode = "takes" | "styles";

/* ───────────────────────────── Paiement ───────────────────────────── */

export type Currency = "XOF" | "XAF" | "GNF" | "CDF" | "GHS" | "KES" | "UGX" | "TZS" | "RWF" | "ZMW" | "EUR" | "USD";

export type PaymentProviderId = "chariow" | "fedapay" | "cinetpay" | "flutterwave" | "paystack" | "stripe" | "demo";

/** Moyen de paiement tel que le choisit l'utilisateur. */
export type PaymentMethod = "mobile_money" | "card";

export type MobileOperator =
  | "orange_money"
  | "wave"
  | "mtn_momo"
  | "moov_money"
  | "airtel_money"
  | "mpesa"
  | "free_money"
  | "tmoney"
  | "telecel_cash"
  | "airteltigo_money"
  | "africell_money"
  | "mixx"
  | "halopesa"
  | "zamtel_money";

/** Code pays ISO 3166-1 alpha-2 (les 54 pays d'Afrique sont listés dans constants.ts). */
export type CountryCode = string;

export interface CheckoutInput {
  reference: string;
  song: SongRecord;
  plan: PlanId;
  amount: number;
  currency: Currency;
  method: PaymentMethod;
  operator?: MobileOperator;
  country?: CountryCode;
  phone?: string;
  email?: string;
  customerName?: string;
  /** Adresse IP du client (Chariow en déduit son pays et les moyens de paiement proposés). */
  customerIp?: string;
  /** Adresse où le prestataire renvoie l'utilisateur. */
  returnUrl: string;
  /** Webhook serveur à serveur. */
  notifyUrl: string;
  cancelUrl: string;
}

export interface CheckoutSession {
  redirectUrl: string;
  /** Identifiant chez le prestataire (ex. id de session Stripe). */
  providerRef?: string;
}

export interface PaymentVerification {
  status: "paid" | "pending" | "failed";
  amount?: number;
  currency?: string;
  providerRef?: string;
  raw?: unknown;
}

export interface WebhookEvent {
  reference: string;
  /** Statut annoncé par le webhook : toujours revérifié via `verify`. */
  claimedStatus: PaymentVerification["status"];
}

/**
 * Contrat implémenté par chaque passerelle (Chariow, FedaPay, CinetPay, Flutterwave, Paystack, Stripe, démo).
 * Les implémentations vivent côté serveur uniquement (clés secrètes).
 */
export interface PaymentProvider {
  id: PaymentProviderId;
  label: string;
  methods: PaymentMethod[];
  currencies: Currency[];
  /** Pays où la passerelle encaisse le Mobile Money (vide pour les cartes seules). */
  momoCountries: CountryCode[];
  isConfigured(): boolean;
  createCheckout(input: CheckoutInput): Promise<CheckoutSession>;
  /** Interroge le prestataire : seule source de vérité pour débloquer le téléchargement. */
  verify(payment: PaymentRecord): Promise<PaymentVerification>;
  /** Vérifie la signature du webhook et renvoie la référence concernée (ou null si ignoré). */
  parseWebhook(req: Request, rawBody: string): Promise<WebhookEvent | null>;
}

export interface PaymentRecord {
  reference: string;
  songId: string;
  provider: PaymentProviderId;
  method: PaymentMethod;
  operator?: MobileOperator;
  plan: PlanId;
  amount: number;
  currency: Currency;
  status: PaymentVerification["status"];
  providerRef?: string;
  createdAt: number;
  updatedAt: number;
  paidAt?: number;
}

/** Ce que le navigateur sait des passerelles disponibles. */
export interface PaymentOptions {
  /** Pays où le Mobile Money est disponible, avec la passerelle utilisée. */
  mobileMoney: Record<CountryCode, PaymentProviderId>;
  card: { provider: PaymentProviderId; currencies: Currency[] } | null;
  demo: boolean;
}

/* ───────────────────────────── Divers ───────────────────────────── */

export interface UploadRecord {
  id: string;
  kind: "reference" | "photo";
  fileName: string;
  mime: string;
  size: number;
  /** URL publique (service de fichiers Kie) utilisable par Suno / le générateur d'images. */
  publicUrl?: string;
  /** Chemin local si le disque est persistant. */
  localPath?: string;
  createdAt: number;
}

export interface GeneratedLyrics {
  title: string;
  lyrics: string;
  source: "claude" | "kie" | "template";
}
