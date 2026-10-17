// Cycle de vie d'une chanson : création, lancement Suno (2 variantes), suivi, paiement.
import { createHmac, timingSafeEqual } from "node:crypto";
import { buildKieRequests } from "../kie-prompt";
import type {
  PaymentRecord,
  PaymentVerification,
  PublicSong,
  SongConfig,
  SongRecord,
  SongVariant,
  StoredTrack,
  VariantId,
} from "../types";
import { config, isPublicUrl } from "./env";
import { HttpError } from "./http";
import { randomId } from "./ids";
import * as kie from "./kie";
import { coverChoices, effectiveCoverChoice } from "./cover-choice";
import { coverPrompt } from "./cover-prompt";
import { gifts, payments, songs, uploads } from "./store";

export const VARIANTS: VariantId[] = ["A", "B"];
const POLL_THROTTLE_MS = 3000;
export const DEMO_DURATION = 48;

const isTerminal = (s: SongVariant["status"]) => s === "SUCCESS" || kie.FAILED_STATUSES.has(s);

function emptyVariant(id: VariantId): SongVariant {
  return { id, mood: id === "A" ? "rhythmic" : "acoustic", status: "QUEUED", tracks: [] };
}

export async function createSong(cfg: SongConfig): Promise<SongRecord> {
  const now = Date.now();
  const song: SongRecord = {
    id: randomId(22),
    giftSlug: randomId(10),
    createdAt: now,
    updatedAt: now,
    config: { ...cfg, recipientName: cfg.recipientName || cfg.brief?.recipientName },
    generation: { status: "idle" },
    variants: { A: emptyVariant("A"), B: emptyVariant("B") },
    payment: { status: "unpaid" },
    aiCover: null,
    demo: config.demoMusic(),
  };
  await songs.put(song);
  await gifts.put({ slug: song.giftSlug, songId: song.id });
  return song;
}

/* ───────────── Adresses de rappel Kie signées (Kie ne signe pas ses webhooks) ───────────── */

export function callbackToken(songId: string, variant: string, kind: string): string {
  return createHmac("sha256", config.callbackSecret()).update(`${songId}:${variant}:${kind}`).digest("hex").slice(0, 40);
}

export function verifyCallbackToken(songId: string, variant: string, kind: string, token: string): boolean {
  const expected = Buffer.from(callbackToken(songId, variant, kind));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

function callbackUrl(base: string, songId: string, variant: VariantId, kind: "music" | "wav"): string {
  // Kie exige une adresse ; en local elle est injoignable et le polling prend le relais.
  if (!isPublicUrl(base)) return "https://example.invalid/kie-callback";
  const token = callbackToken(songId, variant, kind);
  return `${base}/api/kie/callback?song=${songId}&variant=${variant}&kind=${kind}&token=${token}`;
}

/* ───────────── Lancement ───────────── */

export async function startGeneration(id: string, base: string): Promise<SongRecord> {
  let already = false;
  const claimed = await songs.update(id, (s) => {
    if (s.generation.status === "generating" || s.generation.status === "ready") {
      already = true;
      return;
    }
    if (config.flowMode() === "pay_first" && s.payment.status !== "paid") {
      throw new HttpError(402, "Le paiement doit être validé avant la composition de la chanson.");
    }
    const attempts = s.generation.attempts ?? 0;
    if (attempts >= config.maxAttempts()) {
      throw new HttpError(429, "Nombre maximal de compositions atteint pour cette chanson : contactez-nous, nous la relancerons pour vous.");
    }
    s.generation = { status: "generating", startedAt: Date.now(), attempts: attempts + 1 };
    s.variants = { A: emptyVariant("A"), B: emptyVariant("B") };
    s.updatedAt = Date.now();
  });
  if (!claimed) throw new HttpError(404, "Chanson introuvable.");
  if (already) return claimed;

  if (claimed.demo) {
    return (await songs.update(id, (s) => {
      for (const v of VARIANTS) s.variants[v] = { ...s.variants[v], taskId: "demo", status: "PENDING", startedAt: Date.now() };
    }))!;
  }

  const ref = claimed.config.referenceAudio;
  const uploadUrl = ref?.useAsCover && ref.rightsConfirmed ? (await uploads.get(ref.uploadId))?.publicUrl : undefined;
  const requests = buildKieRequests(claimed.config, {
    model: config.sunoModel(),
    callbackUrl: (v) => callbackUrl(base, id, v, "music"),
    uploadUrl,
  });

  const results = await Promise.allSettled(VARIANTS.map((v) => kie.startSunoTask(requests[v])));
  const updated = await songs.update(id, (s) => {
    results.forEach((r, i) => {
      const v = VARIANTS[i];
      s.variants[v] =
        r.status === "fulfilled"
          ? { ...s.variants[v], taskId: r.value, status: "PENDING", startedAt: Date.now() }
          : { ...s.variants[v], status: "CREATE_TASK_FAILED", error: (r.reason as Error).message };
    });
    if (results.every((r) => r.status === "rejected")) {
      s.generation = { status: "failed", startedAt: s.generation.startedAt, error: (results[0] as PromiseRejectedResult).reason?.message };
    }
    s.updatedAt = Date.now();
  });
  return updated!;
}

/* ───────────── Suivi (polling + webhooks) ───────────── */

function demoProgress(v: SongVariant, now: number): Partial<SongVariant> {
  const t = (now - (v.startedAt ?? now)) / 1000 - (v.id === "B" ? 3 : 0);
  if (t < 4) return { status: "PENDING" };
  if (t < 9) return { status: "TEXT_SUCCESS" };
  if (t < 14) return { status: "FIRST_SUCCESS" };
  const tracks: StoredTrack[] = [0, 1].map((i) => ({ audioId: `demo-${v.id}-${i}`, audioUrl: `demo:${v.id}:${i}`, duration: DEMO_DURATION }));
  return { status: "SUCCESS", tracks, alignedWords: null, waveform: null, finishedAt: now };
}

async function sunoProgress(v: SongVariant): Promise<Partial<SongVariant>> {
  const info = await kie.getSunoTask(v.taskId!);
  const tracks: StoredTrack[] = (info.response?.sunoData ?? [])
    .filter((t) => t?.audioUrl)
    .map((t) => ({ audioId: t.id, audioUrl: t.audioUrl, imageUrl: t.imageUrl, duration: t.duration ? Number(t.duration) : undefined }));
  if (kie.FAILED_STATUSES.has(info.status)) return { status: info.status, error: kie.failureMessage(info.status, info.errorMessage) };
  if (info.status === "SUCCESS" && !tracks.length) return { status: "FIRST_SUCCESS" };
  const patch: Partial<SongVariant> = { status: info.status };
  if (tracks.length) patch.tracks = tracks;
  if (info.status === "SUCCESS") {
    patch.finishedAt = Date.now();
    try {
      const ts = await kie.getTimestampedLyrics(v.taskId!, tracks[0].audioId);
      patch.alignedWords = ts.words.length ? ts.words : null;
      patch.waveform = ts.waveform.length ? ts.waveform : null;
    } catch {
      patch.alignedWords = null; // karaoké estimé côté navigateur
    }
  }
  return patch;
}

function computeGeneration(s: SongRecord) {
  const vs = VARIANTS.map((v) => s.variants[v]);
  if (vs.some((v) => !isTerminal(v.status))) return;
  const ok = vs.some((v) => v.status === "SUCCESS");
  s.generation = {
    ...s.generation,
    status: ok ? "ready" : "failed",
    finishedAt: s.generation.finishedAt ?? Date.now(),
    error: ok ? undefined : vs.find((v) => v.error)?.error ?? "La création a échoué.",
  };
}

/**
 * Met à jour la chanson auprès de Kie (au plus une fois toutes les 3 s), y compris les tâches
 * post-paiement de l'offre Prestige (WAV, pochette IA).
 */
export async function refreshSong(id: string, opts: { force?: boolean; base?: string } = {}): Promise<SongRecord | null> {
  const now = Date.now();
  let skip = false;
  const wavToStart: VariantId[] = [];
  let startCover = false;

  const song = await songs.update(id, (s) => {
    if (!opts.force && now - (s.generation.lastPolledAt ?? 0) < POLL_THROTTLE_MS) {
      skip = true;
      return;
    }
    s.generation.lastPolledAt = now;
    // Réserve ici les tâches post-paiement pour ne jamais les lancer deux fois.
    if (opts.base && s.payment.status === "paid" && s.payment.plan === "prestige" && !s.demo) {
      for (const v of VARIANTS) {
        const variant = s.variants[v];
        if (variant.status === "SUCCESS" && variant.tracks[0] && !variant.wav) {
          variant.wav = { status: "pending" };
          wavToStart.push(v);
        }
      }
      if (!s.aiCover && s.generation.status === "ready") {
        s.aiCover = { status: "pending" };
        startCover = true;
      }
    }
  });
  if (!song || skip) return song;

  const patches: Partial<Record<VariantId, Partial<SongVariant>>> = {};
  await Promise.all(
    VARIANTS.map(async (v) => {
      const variant = song.variants[v];
      try {
        if (variant.taskId && !isTerminal(variant.status)) {
          patches[v] = song.demo ? demoProgress(variant, now) : await sunoProgress(variant);
        }
        if (wavToStart.includes(v)) {
          const taskId = await kie.startWavTask(variant.taskId!, variant.tracks[0].audioId, callbackUrl(opts.base!, id, v, "wav"));
          patches[v] = { ...patches[v], wav: { status: "pending", taskId } };
        } else if (variant.wav?.status === "pending" && variant.wav.taskId) {
          const wav = await kie.getWavTask(variant.wav.taskId);
          patches[v] = { ...patches[v], wav: { ...variant.wav, ...wav } };
        }
      } catch (e) {
        console.warn(`[DB.Mélo] Suivi ${id}/${v} :`, (e as Error).message);
        if (wavToStart.includes(v)) patches[v] = { ...patches[v], wav: { status: "failed" } };
      }
    }),
  );

  let coverPatch: SongRecord["aiCover"] | undefined;
  try {
    if (startCover) {
      const photo = song.config.photoUploadId ? await uploads.get(song.config.photoUploadId) : null;
      coverPatch = { status: "pending", taskId: await kie.startImageTask(coverPrompt(song), photo?.publicUrl) };
    } else if (song.aiCover?.status === "pending" && song.aiCover.taskId) {
      const r = await kie.getImageTask(song.aiCover.taskId);
      coverPatch = { ...song.aiCover, ...r };
    }
  } catch (e) {
    coverPatch = { status: "failed", error: (e as Error).message };
  }

  return songs.update(id, (s) => {
    for (const v of VARIANTS) if (patches[v]) s.variants[v] = { ...s.variants[v], ...patches[v] };
    if (coverPatch) {
      s.aiCover = coverPatch;
      if (coverPatch.status === "ready" && !s.config.coverChoice) s.config.coverChoice = "ai";
    }
    if (s.generation.status === "generating") computeGeneration(s);
    s.updatedAt = Date.now();
  });
}

/* ───────────── Paiement ───────────── */

/**
 * Applique la vérification du prestataire (le montant et la devise doivent correspondre).
 * En parcours « paiement d'abord », la composition démarre dès la confirmation, même si le
 * client a fermé la page (confirmation Mobile Money reçue par webhook, par exemple).
 */
export async function applyPaymentResult(payment: PaymentRecord, v: PaymentVerification, base?: string): Promise<PaymentRecord> {
  let status = v.status;
  if (status === "paid") {
    const wrongCurrency = v.currency && v.currency.toUpperCase() !== payment.currency;
    const tooLow = typeof v.amount === "number" && v.amount + 0.001 < payment.amount;
    if (wrongCurrency || tooLow) {
      console.error(`[DB.Mélo] Paiement ${payment.reference} : montant ou devise incohérents`, v);
      status = "failed";
    }
  }
  const updated = await payments.update(payment.reference, (p) => {
    if (p.status === "paid") return; // ne jamais rétrograder un paiement confirmé
    p.status = status;
    p.providerRef = v.providerRef ?? p.providerRef;
    p.updatedAt = Date.now();
    if (status === "paid") p.paidAt = Date.now();
  });
  if (updated?.status === "paid") {
    await songs.update(updated.songId, (s) => {
      if (s.payment.status === "paid") return;
      s.payment = {
        status: "paid",
        plan: updated.plan,
        reference: updated.reference,
        provider: updated.provider,
        paidAt: updated.paidAt,
        amount: updated.amount,
        currency: updated.currency,
      };
      s.updatedAt = Date.now();
    });
    if (base && config.flowMode() === "pay_first") {
      const song = await songs.get(updated.songId);
      if (song?.generation.status === "idle") {
        await startGeneration(song.id, base).catch((e) => console.error(`[DB.Mélo] Composition après paiement ${song.id} :`, (e as Error).message));
      }
    }
  } else if (updated?.status === "pending") {
    await songs.update(updated.songId, (s) => {
      if (s.payment.status === "unpaid") s.payment = { ...s.payment, status: "pending", reference: updated.reference };
    });
  }
  return updated ?? payment;
}

/* ───────────── Vues publiques ───────────── */

export function toPublicSong(s: SongRecord): PublicSong {
  const paid = s.payment.status === "paid";
  return {
    id: s.id,
    giftSlug: paid ? s.giftSlug : undefined,
    createdAt: s.createdAt,
    config: s.config,
    generation: {
      status: s.generation.status,
      startedAt: s.generation.startedAt,
      finishedAt: s.generation.finishedAt,
      error: s.generation.error,
      attemptsLeft: Math.max(0, config.maxAttempts() - (s.generation.attempts ?? 0)),
    },
    variants: Object.fromEntries(
      VARIANTS.map((v) => {
        const x = s.variants[v];
        return [
          v,
          {
            id: v,
            mood: x.mood,
            status: x.status,
            takes: x.tracks.length,
            duration: x.tracks[0]?.duration,
            alignedWords: x.alignedWords,
            waveform: x.waveform,
            wavStatus: x.wav?.status ?? null,
            error: x.error,
          },
        ];
      }),
    ) as PublicSong["variants"],
    payment: { status: s.payment.status, plan: s.payment.plan, paidAt: s.payment.paidAt },
    aiCoverStatus: s.aiCover?.status ?? null,
    covers: coverChoices(s),
    coverChoice: effectiveCoverChoice(s),
    demo: s.demo,
    previewSeconds: config.previewSeconds(),
    flowMode: config.flowMode(),
  };
}

export async function songBySlug(slug: string): Promise<SongRecord | null> {
  const g = await gifts.get(slug);
  return g ? songs.get(g.songId) : null;
}

export async function requireSong(id: string): Promise<SongRecord> {
  const s = await songs.get(id);
  if (!s) throw new HttpError(404, "Chanson introuvable.");
  return s;
}
