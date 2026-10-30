// Synchronisation automatique : voix séparée (facultatif) -> paroles minutées (Suno ou IA)
// -> alignement mot par mot des paroles collées, ou paroles écrites par l'IA si absentes.
import { h, modal, toast, progressBar, field } from "./ui.js";
import { api, upload, waitJob } from "./api.js";
import { upgradePrompt } from "./session.js";
import { channelsOf } from "./audio.js";
import { speechWav, detectActivity } from "./core/dsp.js";
import { syncLinesToReference, syncLinesByActivity } from "./core/align.js";
import { linesFromTranscript, splitLongLines, serializeLyrics } from "./core/lyrics.js";

const LANGS = [
  ["", "Détection automatique"],
  ["fr", "Français"],
  ["en", "Anglais"],
  ["es", "Espagnol"],
  ["pt", "Portugais"],
  ["it", "Italien"],
  ["de", "Allemand"],
  ["ar", "Arabe"],
  ["sw", "Swahili"],
  ["ln", "Lingala"],
  ["yo", "Yoruba"],
  ["ha", "Haoussa"],
  ["ht", "Créole haïtien"],
];

/** Choix proposés selon ce qui est disponible. */
export function syncChoices(project, caps) {
  const hasLyrics = project.lines.length > 0;
  const out = [];
  if (project.suno?.taskId && (project.transcript?.provider === "suno" || caps.kie))
    out.push({ id: "suno", label: "Paroles horodatées de Suno", desc: "Gratuit et précis : Suno connaît sa propre chanson." });
  if (caps.transcription.length)
    out.push({
      id: "ai",
      label: hasLyrics ? "IA : écoute la chanson et cale tes paroles" : "IA : écrit les paroles et les cale",
      desc: caps.transcription.includes("elevenlabs") ? "ElevenLabs Scribe (ou Whisper)" : "Whisper (Groq / OpenAI)",
    });
  if (hasLyrics)
    out.push({
      id: "voice",
      label: "Sans IA : répartition sur la voix détectée",
      desc: "Approximatif, à retoucher. Bien meilleur avec la voix séparée.",
    });
  if (hasLyrics)
    out.push({ id: "tap", label: "À la main : je tape en rythme", desc: "Espace (ou le bouton TAP) au début de chaque mot ou ligne." });
  return out;
}

export function openSyncDialog(studio) {
  const p = studio.project;
  const caps = studio.caps;
  const choices = syncChoices(p, caps);
  if (!choices.length) {
    return modal({
      title: "Synchronisation",
      body: h(
        "div",
        {},
        h("p", {}, "Il n'y a pas encore de paroles et aucun service d'IA n'est configuré."),
        h(
          "p",
          {},
          "Colle les paroles dans l'onglet Texte, ou ajoute une clé de transcription (Groq gratuit, OpenAI ou ElevenLabs) dans les Réglages.",
        ),
      ),
      actions: [{ label: "OK", primary: true, onClick: (c) => c() }],
    });
  }
  let choice = choices[0].id;
  const radios = h(
    "div",
    { class: "choices" },
    choices.map((c, i) =>
      h(
        "label",
        { class: "choice" },
        h("input", { type: "radio", name: "sync-choice", value: c.id, checked: i === 0, onchange: () => ((choice = c.id), refresh()) }),
        h("span", {}, h("strong", {}, c.label), h("small", {}, c.desc)),
      ),
    ),
  );
  const stemMethods = [];
  if (caps.demucs) stemMethods.push(["demucs", "Demucs (sur cet ordinateur, gratuit)"]);
  if (p.suno?.taskId && caps.kie) stemMethods.push(["suno", "Suno via Kie.ai (quelques crédits)"]);
  const hasStems = !!p.media.vocals || !!p.media.instrumental;
  const stemBox = h("input", { type: "checkbox", checked: !hasStems && stemMethods.length > 0 && stemMethods[0][0] === "demucs" });
  const stemSelect = h(
    "select",
    {},
    stemMethods.map(([v, t]) => h("option", { value: v }, t)),
  );
  const stemRow = hasStems
    ? h(
        "p",
        { class: "hint ok" },
        `✓ Voix séparée disponible (${p.media.vocals?.method || p.media.instrumental?.method}) : elle sera utilisée.`,
      )
    : stemMethods.length
      ? h(
          "div",
          { class: "row gap wrap" },
          h("label", { class: "toggle" }, stemBox, h("span", { class: "toggle-ui" }), h("span", {}, "Séparer la voix d'abord")),
          stemSelect,
        )
      : h(
          "p",
          { class: "hint" },
          "Séparation de la voix : installe Demucs (pip install demucs) ou envoie une voix séparée depuis le menu Son. Sinon, la voix est retirée « au centre » pour le karaoké.",
        );
  const providerSelect = h(
    "select",
    {},
    caps.transcription.map((x) => h("option", { value: x }, x === "elevenlabs" ? "ElevenLabs Scribe" : "Whisper (Groq / OpenAI)")),
  );
  const langSelect = h(
    "select",
    {},
    LANGS.map(([v, t]) => h("option", { value: v }, t)),
  );
  langSelect.value = studio.prefs.language ?? "";
  const aiRow = h("div", { class: "grid2" }, field("Service", providerSelect), field("Langue", langSelect));
  const tapMode = h(
    "select",
    {},
    h("option", { value: "line" }, "Une frappe par ligne (rapide)"),
    h("option", { value: "word" }, "Une frappe par mot (précis)"),
  );
  const tapRow = h(
    "div",
    {},
    field("Rythme", tapMode),
    h(
      "p",
      { class: "hint" },
      "La lecture démarre : appuie sur Espace (ou TAP) au début de chaque ligne/mot. En mode mot, garde la touche enfoncée pendant le mot. Échap pour arrêter.",
    ),
  );
  const refresh = () => {
    aiRow.hidden = choice !== "ai";
    tapRow.hidden = choice !== "tap";
    stemRow.hidden = choice === "tap" || choice === "suno";
  };
  refresh();
  const body = h("div", { class: "sync-dialog" }, radios, aiRow, tapRow, stemRow);
  const dlg = modal({
    title: "Synchroniser les paroles",
    body,
    actions: [
      { label: "Annuler", onClick: (c) => c() },
      {
        label: "Lancer",
        primary: true,
        onClick: (close) => {
          close();
          studio.prefs.language = langSelect.value;
          if (choice === "tap") return studio.startTap(tapMode.value);
          runSync(studio, {
            choice,
            stems: !hasStems && stemBox.checked && stemMethods.length ? stemSelect.value : null,
            provider: providerSelect.value,
            language: langSelect.value,
          });
        },
      },
    ],
  });
  return dlg;
}

export async function runSync(studio, { choice, stems, provider, language }) {
  const p = studio.project;
  const bar = progressBar();
  const log = h("ul", { class: "steps" });
  const step = (text) => {
    const li = h("li", {}, text);
    log.append(li);
    return {
      ok: (t) => ((li.className = "ok"), t && (li.textContent = t)),
      fail: (t) => ((li.className = "fail"), (li.textContent = t)),
    };
  };
  const controller = new AbortController();
  const dlg = modal({
    title: "Synchronisation en cours",
    body: h("div", {}, bar.el, log),
    closable: false,
    actions: [{ label: "Arrêter", onClick: () => controller.abort() }],
  });
  const tick = () => new Promise((r) => setTimeout(r, 30));
  try {
    // 1. Voix séparée
    if (stems) {
      const s = step(stems === "demucs" ? "Séparation de la voix avec Demucs…" : "Séparation de la voix par Suno…");
      const { job } = await api(`/api/projects/${p.id}/stems`, { method: "POST", json: { method: stems } });
      const media = await waitJob(job, (j) => bar.set(j.progress * 0.5, j.message), { signal: controller.signal });
      Object.assign(p.media, media);
      studio.audio.project = p;
      studio.stemsChanged();
      s.ok("Voix séparée ✓");
    }
    bar.set(0.5, "");
    // 2. Son de référence : la voix seule si on l'a.
    const a = step("Analyse du son…");
    await tick();
    const vocals = await studio.audio.stem("vocals").catch(() => null);
    const src = vocals || studio.audio.buffers.original;
    const activity = detectActivity(channelsOf(src), src.sampleRate);
    a.ok(`Voix détectée : ${activity.length} passages${vocals ? " (voix séparée)" : ""}`);
    const duration = studio.audio.duration;
    let transcript = null;
    if (choice === "suno") {
      const s = step("Paroles horodatées de Suno…");
      transcript = p.transcript?.provider === "suno" ? p.transcript : await api(`/api/projects/${p.id}/suno-lyrics`, { method: "POST" });
      s.ok(`Suno : ${transcript.words.length} mots minutés ✓`);
    } else if (choice === "ai") {
      const s = step("Écoute de la chanson par l'IA (30 s à 2 min)…");
      await tick();
      const wav = speechWav(channelsOf(src), src.sampleRate);
      const form = new FormData();
      form.append("audio", new Blob([wav], { type: "audio/wav" }), "voix.wav");
      form.append("provider", provider || "auto");
      form.append("language", language || "");
      if (p.lines.length) form.append("prompt", serializeLyrics(p.lines).replace(/^(A|B|AB): /gm, ""));
      transcript = await upload(
        `/api/projects/${p.id}/transcribe`,
        form,
        (x) => bar.set(0.5 + x * 0.2, x < 1 ? "Envoi du son…" : "L'IA écoute…"),
        {
          signal: controller.signal,
        },
      );
      if (!transcript.words.length) throw new Error("L'IA n'a reconnu aucun mot (morceau instrumental ?).");
      s.ok(`IA : ${transcript.words.length} mots reconnus ✓`);
    }
    bar.set(0.85, "Calage mot par mot…");
    await tick();
    let lines;
    let matched = 0;
    let total = 0;
    if (transcript) {
      p.transcript = transcript;
      if (p.lines.length) {
        const r = syncLinesToReference(p.lines, transcript.words, { duration, activity });
        lines = r.lines;
        matched = r.matched;
        total = r.total;
      } else {
        lines = splitLongLines(linesFromTranscript(transcript.words), studio.prefs.maxChars || 32);
        for (const l of lines) for (const w of l.words) w.conf = 1;
        matched = total = lines.reduce((n, l) => n + l.words.length, 0);
        p.lyricsText = serializeLyrics(lines);
      }
    } else {
      lines = syncLinesByActivity(p.lines, activity.length ? activity : [{ start: 0, end: duration }]);
      total = lines.reduce((n, l) => n + l.words.length, 0);
    }
    p.sync = { method: choice, at: Date.now(), matched, total };
    studio.setLines(lines, "Synchronisation automatique", { keepText: !!p.lyricsText });
    studio.lyrics.show("lines");
    bar.set(1, "Terminé");
    const ratio = total ? Math.round((matched / total) * 100) : 0;
    step(
      transcript
        ? `${ratio} % des mots retrouvés avec certitude. Vérifie les mots encadrés en orange.`
        : "Timing approximatif : écoute et ajuste les lignes dans la frise (ou synchro à la main).",
    ).ok();
    dlg.close();
    toast(
      transcript
        ? `Synchronisation terminée : ${ratio} % des mots calés avec certitude.`
        : "Synchronisation approximative terminée : ajuste dans la frise.",
      "ok",
      6000,
    );
  } catch (e) {
    if (e.name === "AbortError") {
      dlg.close();
      return toast("Synchronisation arrêtée.", "info");
    }
    step(`✗ ${e.message}`).fail(`✗ ${e.message}`);
    dlg.close();
    if (e.upgrade) return upgradePrompt(e.message);
    modal({
      title: "La synchronisation a échoué",
      body: h("p", {}, e.message),
      actions: [{ label: "OK", primary: true, onClick: (c) => c() }],
    });
  }
}
