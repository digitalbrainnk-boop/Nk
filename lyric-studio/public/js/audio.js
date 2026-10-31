// Son du projet : décodage, forme d'onde, piste karaoké, lecture.
// La lecture passe par un <audio> (horloge fiable), la piste karaoké calculée est un WAV en mémoire.
import { mediaUrl, fetchMedia } from "./api.js";
import { centerCancel, mix, encodeWav, computePeaks, peakOf } from "./core/dsp.js";

export const channelsOf = (buf) => Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));

export class AudioEngine extends EventTarget {
  constructor() {
    super();
    this.el = new Audio();
    this.el.preload = "auto";
    this.ctx = null;
    this.buffers = {};
    this.peaks = {};
    this.playbackKey = null;
    this.blobUrl = null;
    for (const ev of ["play", "pause", "ended", "seeked", "loadedmetadata"])
      this.el.addEventListener(ev, () => this.dispatchEvent(new Event(ev)));
  }

  get context() {
    this.ctx ??= new (window.AudioContext || window.webkitAudioContext)();
    return this.ctx;
  }

  async decode(url) {
    const data = await fetchMedia(url);
    try {
      return await this.context.decodeAudioData(data);
    } catch {
      const e = new Error("Ce navigateur ne sait pas lire ce format.");
      e.decode = true;
      throw e;
    }
  }

  /** Charge le son principal (et sa forme d'onde). */
  async load(project) {
    this.project = project;
    this.buffers = {};
    this.peaks = {};
    const buf = await this.decode(mediaUrl(project, project.media.audio.file));
    this.buffers.original = buf;
    this.peaks.original = computePeaks(channelsOf(buf), buf.sampleRate, 100);
    this.duration = buf.duration;
    this.playbackKey = null;
    return buf;
  }

  get sampleRate() {
    return this.buffers.original?.sampleRate || 44100;
  }

  /** Voix séparée ou instrumental (décodés à la demande, gardés en mémoire). */
  async stem(kind) {
    const m = this.project.media[kind];
    if (!m) return null;
    const key = `${kind}:${m.file}`;
    if (this.buffers[key]) return this.buffers[key];
    const buf = await this.decode(mediaUrl(this.project, m.file));
    this.buffers[key] = buf;
    if (kind === "vocals") this.peaks.vocals = computePeaks(channelsOf(buf), buf.sampleRate, 100);
    return buf;
  }

  /** La voix séparée existe-t-elle ? */
  hasStem(kind) {
    return !!this.project?.media?.[kind];
  }

  /** Piste karaoké : instrumental (séparé, ou voix retirée au centre) + voix guide éventuelle. */
  async karaokeChannels(guide = 0) {
    const o = this.buffers.original;
    const n = o.length;
    const inst = await this.stem("instrumental").catch(() => null);
    if (inst) {
      const voc = guide > 0 ? (await this.stem("vocals").catch(() => null)) || null : null;
      const tracks = [{ channels: channelsOf(inst), gain: 1 }];
      if (guide > 0) tracks.push({ channels: voc ? channelsOf(voc) : channelsOf(o), gain: voc ? guide : guide * 0.7 });
      return mix(tracks, n);
    }
    const ch = channelsOf(o);
    this.monoWarning = ch.length < 2;
    const cancelled = ch.length < 2 ? [ch[0], ch[0]] : centerCancel(ch[0], ch[1], o.sampleRate);
    // Sans la voix, le son est plus faible : on le remonte au niveau du morceau d'origine.
    const level = peakOf(cancelled);
    const tracks = [{ channels: cancelled, gain: level > 0 ? Math.min(4, (peakOf(ch) * 0.95) / level) : 1 }];
    if (guide > 0) tracks.push({ channels: ch, gain: guide * 0.7 });
    return mix(tracks, n);
  }

  /** Son final selon le mode (pour l'export). */
  async exportChannels(style) {
    if (style.mode === "karaoke") return this.karaokeChannels(style.guideVocals || 0);
    return channelsOf(this.buffers.original);
  }

  /** Choisit ce qu'on entend pendant l'aperçu (garde la position de lecture). */
  async setPlayback(style) {
    const guide = style.mode === "karaoke" ? Math.round((style.guideVocals || 0) * 100) / 100 : 0;
    const media = this.project.media;
    const key = style.mode === "karaoke" ? `k:${media.instrumental?.file || "center"}:${guide}` : `o:${media.audio.file}`;
    if (key === this.playbackKey) return;
    this.playbackKey = key;
    let url;
    if (style.mode !== "karaoke") url = mediaUrl(this.project, media.audio.file);
    else if (media.instrumental && !guide) url = mediaUrl(this.project, media.instrumental.file);
    else {
      const channels = await this.karaokeChannels(guide);
      if (this.playbackKey !== key) return;
      url = URL.createObjectURL(new Blob([encodeWav(channels, this.sampleRate)], { type: "audio/wav" }));
    }
    const t = this.el.currentTime;
    const playing = !this.el.paused;
    if (this.blobUrl) URL.revokeObjectURL(this.blobUrl);
    this.blobUrl = url.startsWith("blob:") ? url : null;
    this.el.src = url;
    await new Promise((r) => {
      this.el.addEventListener("loadedmetadata", r, { once: true });
      this.el.addEventListener("error", r, { once: true });
    });
    this.el.currentTime = Math.min(t, this.duration || t);
    if (playing) this.el.play().catch(() => {});
  }

  get time() {
    return this.el.currentTime || 0;
  }

  get playing() {
    return !this.el.paused && !this.el.ended;
  }

  seek(t) {
    this.el.currentTime = Math.max(0, Math.min(this.duration || 0, t));
    this.dispatchEvent(new Event("seek"));
  }

  play() {
    this.context.resume?.();
    return this.el.play().catch(() => {});
  }

  pause() {
    this.el.pause();
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  destroy() {
    this.el.pause();
    this.el.removeAttribute("src");
    if (this.blobUrl) URL.revokeObjectURL(this.blobUrl);
    this.ctx?.close?.();
    this.buffers = {};
  }
}
