// Images et vidéos du projet (fond, média du haut) prêtes à dessiner.
import { mediaUrl } from "./api.js";

export class Assets {
  constructor(onChange) {
    this.items = { bg: null, top: null };
    this.keys = { bg: null, top: null };
    this.onChange = onChange;
  }

  /** Charge ce que le style demande (et libère le reste). */
  update(project) {
    const bg = project.style.background;
    const top = project.style.top;
    this.want("bg", bg.type === "image" || bg.type === "video" ? bg.media : null, bg.type, project);
    this.want("top", top.enabled ? top.media : null, top.kind || "image", project);
  }

  want(slot, file, kind, project) {
    const key = file ? `${kind}:${file}` : null;
    if (this.keys[slot] === key) return;
    this.dispose(slot);
    this.keys[slot] = key;
    if (!file) return this.onChange?.();
    const url = mediaUrl(project, file);
    if (kind === "video") {
      const v = document.createElement("video");
      Object.assign(v, { muted: true, loop: true, playsInline: true, preload: "auto" });
      v.setAttribute("playsinline", "");
      v.addEventListener("loadeddata", () => {
        if (this.keys[slot] !== key) return;
        this.items[slot] = { source: v, width: v.videoWidth, height: v.videoHeight, kind: "video" };
        this.onChange?.();
      });
      v.addEventListener("seeked", () => this.onChange?.());
      v.src = url;
      v.load();
    } else {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => {
        if (this.keys[slot] !== key) return;
        this.items[slot] = { source: img, width: img.naturalWidth, height: img.naturalHeight, kind: "image" };
        this.onChange?.();
      };
      img.src = url;
    }
  }

  dispose(slot) {
    const it = this.items[slot];
    if (it?.kind === "video") {
      it.source.pause();
      it.source.removeAttribute("src");
      it.source.load();
    }
    this.items[slot] = null;
  }

  videos() {
    return Object.values(this.items).filter((x) => x?.kind === "video" && x.source.duration > 0);
  }

  /** Aperçu : les vidéos suivent le son (sans à-coups). */
  sync(t, playing) {
    for (const { source: v } of this.videos()) {
      const target = t % v.duration;
      if (playing) {
        if (v.paused) v.play().catch(() => {});
        if (Math.abs(v.currentTime - target) > 0.4) v.currentTime = target;
      } else {
        if (!v.paused) v.pause();
        if (!v.seeking && Math.abs(v.currentTime - target) > 0.04) v.currentTime = target;
      }
    }
  }

  /** Export : chaque vidéo à l'image exacte, on attend qu'elle soit prête. */
  async seekExact(t) {
    await Promise.all(
      this.videos().map(({ source: v }) => {
        v.pause();
        const target = t % v.duration;
        if (Math.abs(v.currentTime - target) < 0.001 && !v.seeking) return null;
        return new Promise((resolve) => {
          const done = () => (clearTimeout(timer), v.removeEventListener("seeked", done), resolve());
          const timer = setTimeout(done, 3000);
          v.addEventListener("seeked", done);
          v.currentTime = target;
        });
      }),
    );
  }

  /** Attend que les médias demandés soient chargés (avant un export). */
  async ready(timeoutMs = 15000) {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      const missing = Object.entries(this.keys).some(([slot, key]) => key && !this.items[slot]);
      if (!missing) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  }

  current() {
    return this.items;
  }

  destroy() {
    this.dispose("bg");
    this.dispose("top");
  }
}
