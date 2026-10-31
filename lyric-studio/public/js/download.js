// Enregistrer un fichier sur l'appareil. Sur le site : un simple téléchargement.
// Dans la version de démonstration (page intégrée à claude.ai), la plateforme demande confirmation.
import { toast } from "./ui.js";
import { fetchMedia } from "./api.js";

export async function downloadFile({ blob, url, filename }) {
  const downloads = window.claude?.use ? await window.claude.use("downloads").catch(() => null) : null;
  if (downloads) {
    try {
      if (!blob) blob = new Blob([await fetchMedia(url)]);
      await downloads.save({ filename, data: blob });
      toast("Fichier enregistré.", "ok");
    } catch (e) {
      if (e?.code !== "declined") toast(`Enregistrement impossible : ${e?.message || e}`, "error", 7000);
    }
    return;
  }
  const a = document.createElement("a");
  a.href = url || URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
}
