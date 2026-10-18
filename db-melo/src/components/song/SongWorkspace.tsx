"use client";

// Page d'une commande : paiement → composition (useKieSuno) → lecteur HD,
// téléchargement mobile, pochette et page cadeau.
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Loader, Music, RefreshCw, XCircle } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useKieSuno } from "@/hooks/useKieSuno";
import { api } from "@/lib/client/api";
import { rememberSong } from "@/lib/client/local-songs";
import { BRAND, STYLES, VOICES, label, variantLabel } from "@/lib/constants";
import type { CoverChoice, PublicSong, VariantId } from "@/lib/types";
import { AudioPlayer } from "../player/AudioPlayer";
import { PaymentSelector } from "../payment/PaymentSelector";
import { CoverPicker } from "./CoverPicker";
import { DownloadPanel } from "./DownloadPanel";
import { GenerationProgress } from "./GenerationProgress";
import { GiftShare } from "./GiftShare";
import { LyricsCard } from "./LyricsCard";

type PayState = "checking" | "pending" | "paid" | "failed" | "cancelled" | null;


export function SongWorkspace({ id, autoStart, paymentRef }: { id: string; autoStart: boolean; paymentRef?: string }) {
  const k = useKieSuno(id, { autoStart });
  const { song } = k;
  const [variant, setVariant] = useState<VariantId>("A");
  const [take, setTake] = useState(0);
  const [files, setFiles] = useState<Record<string, File>>({});
  const [payState, setPayState] = useState<PayState>(null);
  const [coverVersion, setCoverVersion] = useState(0);
  const [origin, setOrigin] = useState("");

  useEffect(() => setOrigin(window.location.origin), []);

  const remembered = useRef(false);
  useEffect(() => {
    if (!song || remembered.current) return;
    remembered.current = true;
    rememberSong({ id: song.id, title: song.config.title, recipient: song.config.recipientName, createdAt: song.createdAt });
  }, [song]);

  // Retour de la passerelle : on vérifie (Mobile Money : la validation sur le téléphone peut prendre un moment).
  const refresh = k.refresh;
  useEffect(() => {
    if (!paymentRef) return;
    if (paymentRef === "annule") return setPayState("cancelled");
    let stopped = false;
    let tries = 0;
    setPayState("checking");
    const check = async () => {
      try {
        const r = await api<{ status: "paid" | "pending" | "failed" }>("/api/payments/verify", { body: { reference: paymentRef } });
        if (stopped) return;
        if (r.status === "paid") {
          setPayState("paid");
          await refresh();
          window.history.replaceState(null, "", `/chanson/${id}`);
          return;
        }
        if (r.status === "failed") return setPayState("failed");
        setPayState("pending");
      } catch {
        if (!stopped) setPayState("pending");
      }
      if (!stopped && ++tries < 45) setTimeout(check, 4000);
    };
    void check();
    return () => {
      stopped = true;
    };
  }, [paymentRef, id, refresh]);

  // Si la version choisie a échoué, on bascule sur l'autre.
  useEffect(() => {
    if (song && song.variants[variant].status !== "SUCCESS" && song.variants[variant === "A" ? "B" : "A"].status === "SUCCESS") {
      setVariant(variant === "A" ? "B" : "A");
    }
  }, [song, variant]);

  const changeCover = useCallback(
    async (choice: CoverChoice) => {
      const { song: s } = await api<{ song: PublicSong }>(`/api/songs/${id}`, { method: "PATCH", body: { coverChoice: choice } });
      k.setSong(s);
      setFiles({});
      setCoverVersion((v) => v + 1);
    },
    [id, k],
  );

  if (!song) {
    return (
      <div className="card flex min-h-60 flex-col items-center justify-center gap-3 p-8 text-center">
        {k.error ? (
          <>
            <AlertTriangle className="size-8 text-danger" />
            <p>{k.error}</p>
            <Link href="/studio" className="btn btn-ghost">
              Créer une chanson
            </Link>
          </>
        ) : (
          <Loader className="size-8 animate-spin text-gold" />
        )}
      </div>
    );
  }

  const c = song.config;
  const paid = song.payment.status === "paid";
  const prestige = song.payment.plan === "prestige";
  const ext = song.demo ? "wav" : "mp3";
  const filename = (v: VariantId) => `${c.title.replace(/[\\/:*?"<>|]+/g, "")} - ${BRAND.name} (${variantLabel(song.variants[v]).toLowerCase()}).${ext}`;
  const previewUrl = (v: VariantId, t = 0) => `/api/songs/${id}/audio?variant=${v}&take=${t}&quality=preview`;
  const hdUrl = (v: VariantId, t: number) => `/api/songs/${id}/audio?variant=${v}&take=${t}&quality=hd&download=1&cv=${coverVersion}`;
  const coverUrl = `/api/songs/${id}/cover?v=${coverVersion}-${song.coverChoice}`;
  const ready = (["A", "B"] as const).filter((v) => song.variants[v].status === "SUCCESS");
  const generating = k.phase === "submitting" || song.generation.status === "generating";
  const fileKey = `${variant}-${take}-${coverVersion}`;
  const giftUrl = song.giftSlug && origin ? `${origin}/cadeau/${song.giftSlug}` : undefined;

  return (
    <div className="space-y-6">
      <header className="flex items-start gap-4">
        <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-gold/15 text-gold">
          <Music className="size-7" />
        </span>
        <div className="min-w-0">
          <p className="eyebrow">{c.recipientName ? `Pour ${c.recipientName}` : "Votre chanson"}</p>
          <h1 className="line-clamp-2 font-display text-2xl font-bold sm:text-3xl">{c.title}</h1>
          <p className="mt-1 text-sm text-muted">
            {label(VOICES, c.voice)} · {c.styles.map((s) => label(STYLES, s)).join(" · ")}
            {song.demo && " · mode démo"}
          </p>
        </div>
      </header>

      <AnimatePresence>
        {payState && payState !== "paid" && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className={`flex items-center gap-3 rounded-2xl border p-4 text-sm ${payState === "failed" ? "border-danger/40 bg-danger/10" : payState === "cancelled" ? "border-line bg-studio-2" : "border-gold/40 bg-gold/10"}`}
          >
            {payState === "failed" ? <XCircle className="size-5 text-danger" /> : payState === "cancelled" ? <XCircle className="size-5 text-muted" /> : <Loader className="size-5 animate-spin text-gold" />}
            {payState === "failed"
              ? "Le paiement n'a pas abouti. Vous pouvez réessayer ci-dessous."
              : payState === "cancelled"
                ? "Paiement annulé. Votre chanson vous attend toujours."
                : "Paiement en cours de confirmation… Si vous payez par Mobile Money, validez la demande sur votre téléphone."}
          </motion.div>
        )}
        {payState === "paid" && (
          <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="flex items-center gap-3 rounded-2xl border border-success/40 bg-success/10 p-4 text-sm">
            <CheckCircle2 className="size-5 text-success" />
            {song.generation.status === "ready"
              ? "Merci ! Paiement confirmé : votre chanson est débloquée en qualité HD, sans watermark."
              : "Merci ! Paiement confirmé : la composition de votre chanson démarre."}
          </motion.div>
        )}
      </AnimatePresence>

      {song.generation.status === "idle" && !generating && (
        song.flowMode === "pay_first" && !paid ? (
          <>
            <p className="rounded-2xl border border-gold/30 bg-gold/5 p-4 text-sm text-cream/90">
              Dernière étape : réglez votre chanson. La musique est composée juste après le paiement (1 à 5 minutes), puis vous la téléchargez.
            </p>
            <LyricsCard song={song} editable onSaved={k.setSong} />
            <PaymentSelector song={song} />
          </>
        ) : (
          <div className="card flex flex-col items-center gap-4 p-8 text-center">
            {paid && !k.error && <Loader className="size-6 animate-spin text-gold" />}
            <p className="text-muted">{paid ? "Démarrage de la composition…" : "Tout est prêt pour composer votre chanson."}</p>
            <button type="button" onClick={k.startGeneration} className={paid ? "btn btn-ghost" : "btn btn-gold"}>
              Lancer la composition
            </button>
            {k.error && <p className="text-sm text-danger">{k.error}</p>}
          </div>
        )
      )}

      {generating && <GenerationProgress song={song} phase={k.phase} progress={k.progress} variantProgress={k.variantProgress} elapsed={k.elapsed} />}

      {song.generation.status === "failed" && (
        <>
          <div className="card space-y-4 p-6 text-center">
            <AlertTriangle className="mx-auto size-8 text-danger" />
            <p>{song.generation.error ?? "La composition a échoué."}</p>
            {song.generation.attemptsLeft > 0 ? (
              <>
                <p className="text-sm text-muted">
                  {paid ? "Votre paiement est conservé. " : ""}Corrigez les paroles si besoin, puis relancez ({song.generation.attemptsLeft} essai
                  {song.generation.attemptsLeft > 1 ? "s" : ""} restant{song.generation.attemptsLeft > 1 ? "s" : ""}).
                </p>
                <button type="button" onClick={k.startGeneration} className="btn btn-gold">
                  <RefreshCw className="size-4" /> Relancer la composition
                </button>
              </>
            ) : (
              <p className="text-sm text-muted">Contactez-nous avec le lien de cette page : nous relancerons votre chanson.</p>
            )}
            {k.error && k.error !== song.generation.error && <p className="text-sm text-danger">{k.error}</p>}
          </div>
          {song.generation.attemptsLeft > 0 && <LyricsCard song={song} editable onSaved={k.setSong} />}
        </>
      )}

      {song.generation.status === "ready" && !paid && (
        <>
          <section className="space-y-3">
            <h2 className="font-display text-xl font-bold">Écoutez vos {ready.length > 1 ? "deux versions" : "versions"}</h2>
            <p className="text-sm text-muted">
              Pré-écoute protégée des {song.previewSeconds} premières secondes. Les deux versions sont incluses dans votre achat.
            </p>
            <div className="grid gap-4 lg:grid-cols-2">
              {ready.map((v) => (
                <AudioPlayer
                  key={v}
                  src={previewUrl(v)}
                  filename={`preview-${v}.${ext}`}
                  title={variantLabel(song.variants[v])}
                  subtitle={c.title}
                  lyrics={c.lyrics}
                  alignedWords={song.variants[v].alignedWords}
                  trackDuration={song.variants[v].duration}
                  preview
                  previewSeconds={song.previewSeconds}
                />
              ))}
            </div>
          </section>
          <PaymentSelector song={song} />
        </>
      )}

      {song.generation.status === "ready" && paid && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {ready.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => {
                  setVariant(v);
                  setTake(0);
                }}
                className={`chip min-h-10 ${variant === v ? "chip-on" : ""}`}
              >
                {variantLabel(song.variants[v])}
              </button>
            ))}
            {prestige && song.variants[variant].takes > 1 && (
              <span className="ml-auto flex gap-1">
                {Array.from({ length: song.variants[variant].takes }, (_, t) => (
                  <button key={t} type="button" onClick={() => setTake(t)} className={`chip min-h-10 ${take === t ? "chip-on" : ""}`}>
                    Prise {t + 1}
                  </button>
                ))}
              </span>
            )}
          </div>
          <AudioPlayer
            key={fileKey}
            src={hdUrl(variant, take)}
            filename={filename(variant)}
            title={c.title}
            subtitle={`${variantLabel(song.variants[variant])} · ${BRAND.artist}`}
            lyrics={c.lyrics}
            alignedWords={song.variants[variant].alignedWords}
            trackDuration={song.variants[variant].duration}
            waveform={song.variants[variant].waveform}
            coverUrl={coverUrl}
            defaultKaraoke
            onFileReady={(f) => setFiles((m) => ({ ...m, [fileKey]: f }))}
          />
          <div className="grid gap-6 lg:grid-cols-2">
            <DownloadPanel
              hdUrl={hdUrl(variant, take)}
              filename={filename(variant)}
              title={c.title}
              recipient={c.recipientName}
              file={files[fileKey] ?? null}
              giftUrl={giftUrl}
              coverUrl={`/api/songs/${id}/cover`}
              wav={
                prestige && !song.demo
                  ? { url: `/api/songs/${id}/audio?variant=${variant}&quality=hd&format=wav&download=1`, filename: filename(variant).replace(/\.mp3$/, ".wav"), status: song.variants[variant].wavStatus ?? "pending" }
                  : null
              }
            />
            <div className="card space-y-5 p-5 sm:p-6">
              <CoverPicker
                songId={id}
                choices={song.covers}
                value={song.coverChoice}
                pendingAi={prestige && song.aiCoverStatus === "pending"}
                onChange={changeCover}
                version={coverVersion}
              />
              {c.dedication && (
                <blockquote className="border-l-2 border-gold pl-4 text-sm text-cream/85 italic">« {c.dedication} »</blockquote>
              )}
            </div>
          </div>
          {giftUrl && <GiftShare url={giftUrl} title={c.title} recipient={c.recipientName} />}
        </>
      )}
    </div>
  );
}
