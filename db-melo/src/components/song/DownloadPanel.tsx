"use client";

// Après paiement : « Télécharger & Sauvegarder sur mon téléphone », envoi WhatsApp, WAV, pochette.
import { CheckCircle2, Download, FileAudio, Image as ImageIcon, Loader, MessageCircle, Smartphone } from "lucide-react";
import { useEffect, useState } from "react";
import {
  canShareFiles,
  downloadToMobile,
  isAndroid,
  isIOS,
  prepareFile,
  shareOnWhatsApp,
  triggerBlobDownload,
} from "@/lib/client/download-to-mobile";
import { BRAND } from "@/lib/constants";

interface Props {
  /** URL du MP3 HD étiqueté. */
  hdUrl: string;
  filename: string;
  title: string;
  recipient?: string;
  /** Fichier déjà chargé par le lecteur (évite un second téléchargement et garde le geste utilisateur). */
  file: File | null;
  giftUrl?: string;
  wav?: { url: string; filename: string; status: "pending" | "ready" | "failed" | null } | null;
  coverUrl: string;
}

export function DownloadPanel({ hdUrl, filename, title, recipient, file, giftUrl, wav, coverUrl }: Props) {
  const [ready, setReady] = useState<File | null>(file);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [device, setDevice] = useState<"ios" | "android" | "other">("other");

  useEffect(() => setDevice(isIOS() ? "ios" : isAndroid() ? "android" : "other"), []);

  // Préchargement : sur iPhone, la feuille de partage doit s'ouvrir sans attente réseau.
  useEffect(() => {
    if (file) return setReady(file);
    const ctrl = new AbortController();
    setReady(null);
    prepareFile(hdUrl, { filename, signal: ctrl.signal, onProgress: setProgress })
      .then(setReady)
      .catch(() => {});
    return () => ctrl.abort();
  }, [hdUrl, filename, file]);

  const message = `🎵 « ${title} » — une chanson créée rien que pour ${recipient ?? "toi"} avec ${BRAND.name}.`;

  const save = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const r = await downloadToMobile(ready ?? hdUrl, { filename, title, text: message, mimeType: "audio/mpeg" });
      if (r.cancelled) setStatus(null);
      else if (r.method === "share")
        setStatus(device === "ios" ? "Choisissez « Enregistrer dans Fichiers » pour garder la chanson." : "Choisissez où enregistrer ou partager la chanson.");
      else setStatus(device === "android" ? "Chanson enregistrée dans Téléchargements : elle apparaît dans vos lecteurs de musique." : "Chanson téléchargée.");
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const whatsapp = async () => {
    // Avec le fichier : la feuille de partage propose WhatsApp et envoie l'audio directement.
    if (ready && canShareFiles(ready)) {
      try {
        await navigator.share({ files: [ready], text: giftUrl ? `${message}\n${giftUrl}` : message });
        return;
      } catch (e) {
        if ((e as DOMException).name === "AbortError") return;
      }
    }
    shareOnWhatsApp(message, giftUrl);
  };

  const downloadCover = async () => {
    const res = await fetch(`${coverUrl}${coverUrl.includes("?") ? "&" : "?"}download=1`);
    if (res.ok) triggerBlobDownload(await res.blob(), `Pochette - ${title}.${res.headers.get("content-type")?.includes("png") ? "png" : "jpg"}`);
  };

  return (
    <section className="card space-y-4 p-5 sm:p-6" aria-labelledby="dl-title">
      <h2 id="dl-title" className="font-display text-xl font-bold">
        Votre chanson est à vous
      </h2>
      <button type="button" onClick={save} disabled={busy} className="btn btn-gold w-full py-4 text-base">
        {busy ? <Loader className="size-5 animate-spin" /> : <Smartphone className="size-5" />}
        Télécharger &amp; Sauvegarder sur mon téléphone
      </button>
      {!ready && (
        <div className="h-1.5 overflow-hidden rounded-full bg-line" aria-label="Préparation du fichier">
          <div className="h-full bg-gold transition-all" style={{ width: `${Math.max(5, progress * 100)}%` }} />
        </div>
      )}
      {status && (
        <p className="flex items-start gap-2 rounded-2xl border border-success/30 bg-success/10 p-3 text-sm text-cream">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" /> {status}
        </p>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        <button type="button" onClick={whatsapp} className="btn btn-ghost">
          <MessageCircle className="size-5 text-[#25D366]" /> Envoyer sur WhatsApp
        </button>
        <button type="button" onClick={downloadCover} className="btn btn-ghost">
          <ImageIcon className="size-5 text-gold" /> Pochette (image)
        </button>
        {wav && (
          <a
            href={wav.status === "ready" ? wav.url : undefined}
            download={wav.filename}
            aria-disabled={wav.status !== "ready"}
            className={`btn btn-ghost sm:col-span-2 ${wav.status !== "ready" ? "pointer-events-none opacity-60" : ""}`}
          >
            {wav.status === "pending" ? <Loader className="size-5 animate-spin" /> : <FileAudio className="size-5 text-gold" />}
            {wav.status === "ready" ? "Télécharger le WAV studio" : wav.status === "failed" ? "WAV indisponible — contactez-nous" : "WAV studio en préparation…"}
          </a>
        )}
        <a href={hdUrl} download={filename} className="btn btn-quiet text-sm sm:col-span-2">
          <Download className="size-4" /> Lien de téléchargement direct (ordinateur)
        </a>
      </div>
      <p className="text-xs text-muted">
        {device === "ios"
          ? "Sur iPhone et iPad, la chanson s'enregistre dans l'app Fichiers (titre, artiste et pochette inclus). Depuis Fichiers, vous pouvez la partager vers votre lecteur favori."
          : device === "android"
            ? "Sur Android, la chanson arrive dans Téléchargements avec son titre, l'artiste DB.Mélo et sa pochette."
            : "Le fichier MP3 contient le titre, l'artiste DB.Mélo, les paroles et la pochette."}
      </p>
    </section>
  );
}
