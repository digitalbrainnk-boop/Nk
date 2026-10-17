// Export mobile : enregistrement natif du fichier sur le téléphone.
//
//  1. Web Share API niveau 2 (`navigator.share({ files })`) : ouvre la feuille de partage
//     native → « Enregistrer dans Fichiers » (iPhone/iPad), Fichiers / Musique (Android),
//     ou envoi direct à WhatsApp en un geste.
//  2. Repli : téléchargement forcé via un Blob HTML5 et un lien <a download>.
//
// Important : Safari exige que `navigator.share` soit appelé pendant le geste de l'utilisateur.
// On précharge donc le fichier (`prepareFile`) AVANT le clic, puis le clic appelle
// `downloadToMobile(file)` immédiatement, sans attente réseau.

export type DownloadMethod = "share" | "download" | "open";

export interface DownloadToMobileOptions {
  /** Nom du fichier enregistré, extension comprise (ex. « Maman Awa - DB.Mélo.mp3 »). */
  filename: string;
  /** Titre affiché dans la feuille de partage. */
  title: string;
  /** Message accompagnant le partage (ex. lien de la page cadeau pour WhatsApp). */
  text?: string;
  mimeType?: string;
  /** Ouvrir la feuille de partage quand c'est possible (par défaut : oui sur mobile/tablette). */
  preferShare?: boolean;
  onProgress?: (ratio: number) => void;
  signal?: AbortSignal;
}

export interface DownloadResult {
  method: DownloadMethod;
  /** L'utilisateur a fermé la feuille de partage sans choisir. */
  cancelled?: boolean;
}

/* ───────────── Détection de l'appareil ───────────── */

export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  // iPadOS se présente comme un Mac : on le reconnaît à l'écran tactile.
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function isAndroid(): boolean {
  return typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
}

export function isMobileDevice(): boolean {
  return isIOS() || isAndroid() || (typeof navigator !== "undefined" && /Mobi/i.test(navigator.userAgent));
}

/** Application installée (écran d'accueil). */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function canShareFiles(file?: File): boolean {
  if (typeof navigator === "undefined" || typeof navigator.canShare !== "function") return false;
  try {
    return navigator.canShare({ files: [file ?? new File([""], "test.mp3", { type: "audio/mpeg" })] });
  } catch {
    return false;
  }
}

/* ───────────── Préparation du fichier ───────────── */

/** Télécharge le fichier en mémoire (avec progression) et renvoie un `File` prêt à partager. */
export async function prepareFile(
  url: string,
  opts: Pick<DownloadToMobileOptions, "filename" | "mimeType" | "onProgress" | "signal">,
): Promise<File> {
  const res = await fetch(url, { signal: opts.signal, cache: "no-store" });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `Téléchargement impossible (${res.status}).`);
  }
  const type = opts.mimeType ?? res.headers.get("content-type") ?? "application/octet-stream";
  const total = Number(res.headers.get("content-length")) || 0;
  if (!res.body || !total || !opts.onProgress) {
    const blob = await res.blob();
    opts.onProgress?.(1);
    return new File([blob], opts.filename, { type });
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    opts.onProgress(Math.min(1, received / total));
  }
  return new File(chunks as BlobPart[], opts.filename, { type });
}

/* ───────────── Enregistrement ───────────── */

/** Téléchargement forcé d'un Blob : Android → Téléchargements, iOS 13+ → Fichiers, ordinateur → dossier choisi. */
export function triggerBlobDownload(blob: Blob, filename: string): DownloadMethod {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  // iOS 12 et plus anciens ignorent l'attribut download : on ouvre le fichier (lecture + « Partager »).
  const legacyIOS = isIOS() && !("download" in HTMLAnchorElement.prototype);
  if (legacyIOS) window.open(url, "_blank");
  else a.click();
  a.remove();
  // Safari a besoin que l'URL vive quelques secondes après le clic.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return legacyIOS ? "open" : "download";
}

/**
 * Enregistre la chanson sur l'appareil.
 * @param source URL du fichier, ou fichier déjà préparé (recommandé sur iPhone, voir plus haut).
 */
export async function downloadToMobile(source: string | Blob, opts: DownloadToMobileOptions): Promise<DownloadResult> {
  const file =
    source instanceof File && source.name === opts.filename
      ? source
      : source instanceof Blob
        ? new File([source], opts.filename, { type: opts.mimeType ?? source.type })
        : await prepareFile(source, opts);

  const preferShare = opts.preferShare ?? isMobileDevice();
  if (preferShare && canShareFiles(file)) {
    try {
      await navigator.share({ files: [file], title: opts.title, text: opts.text });
      return { method: "share" };
    } catch (e) {
      const name = (e as DOMException).name;
      if (name === "AbortError") return { method: "share", cancelled: true };
      // NotAllowedError (geste expiré), TypeError, DataError… : on bascule sur le téléchargement.
    }
  }
  return { method: triggerBlobDownload(file, opts.filename) };
}

/** Ouvre WhatsApp avec un message prêt à envoyer (lien de la page cadeau). */
export function shareOnWhatsApp(text: string, url?: string) {
  const message = url ? `${text}\n${url}` : text;
  window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, "_blank", "noopener");
}

/** Partage d'un lien (feuille native si disponible, sinon copie dans le presse-papiers). */
export async function shareLink(url: string, title: string, text?: string): Promise<"shared" | "copied" | "cancelled"> {
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ url, title, text });
      return "shared";
    } catch (e) {
      if ((e as DOMException).name === "AbortError") return "cancelled";
    }
  }
  await navigator.clipboard?.writeText(url);
  return "copied";
}
