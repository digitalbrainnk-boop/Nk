// Modules partagés : paroles, synchronisation, affichage, son, rendu.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseLyrics,
  serializeLyrics,
  splitLongLines,
  lineText,
  linesFromTranscript,
  splitLineAt,
  mergeWithNext,
  syllables,
  tokenize,
} from "../public/js/core/lyrics.js";
import {
  normalizeToken,
  similarity,
  alignSequences,
  syncLinesToReference,
  syncLinesByActivity,
  shiftAll,
  retimeAfterEdit,
} from "../public/js/core/align.js";
import { schedule, visibleAt, countdownAt, titleAlpha, wordProgress } from "../public/js/core/timing.js";
import { computePeaks, detectActivity, encodeWav, centerCancel, speechWav, mix, fft, analysisTrack, spectrumAt, waveAt, peakOf } from "../public/js/core/dsp.js";
import { frameSize, defaultStyle, mergeStyle, PRESETS, normalizeStyle, shareableStyle, FONTS, DEFAULT_PLANS } from "../public/js/core/style.js";
import { Renderer, wrapRows, transformText, fontString, needsAudio } from "../public/js/core/render.js";

const LYRICS = `[Couplet 1]
Dans la nuit, je pense à toi
Et les étoiles chantent avec moi

[Refrain - B]
Oh oh, reviens-moi
A: Reviens, mon amour`;

test("paroles : lignes, couplets, repères ignorés, chanteurs", () => {
  const lines = parseLyrics(LYRICS);
  assert.equal(lines.length, 4);
  assert.equal(lineText(lines[0]), "Dans la nuit, je pense à toi");
  assert.equal(lines[0].stanza, 0);
  assert.equal(lines[2].stanza, 1);
  assert.equal(lines[2].singer, 1, "[Refrain - B] => chanteur 2");
  assert.equal(lines[3].singer, 0, "A: => chanteur 1");
  assert.ok(lines.every((l) => l.words.every((w) => w.start === null)));
  // Aller-retour texte -> lignes -> texte -> lignes
  const again = parseLyrics(serializeLyrics(lines));
  assert.deepEqual(again.map(lineText), lines.map(lineText));
  assert.deepEqual(
    again.map((l) => l.singer),
    [0, 0, 1, 0],
  );
  assert.deepEqual(
    again.map((l) => l.stanza),
    [0, 0, 1, 1],
  );
});

test("paroles : ponctuation isolée collée au mot voisin, syllabes", () => {
  assert.deepEqual(tokenize("Je t'aime — toujours !"), ["Je", "t'aime —", "toujours !"]);
  assert.equal(syllables("chanteront"), 3);
  assert.equal(syllables("à"), 1);
  assert.equal(syllables("..."), 1);
});

test("découpe des lignes trop longues, équilibrée et après une virgule", () => {
  const [line] = parseLyrics("Je marcherai sous la pluie, jusqu'au bout de la nuit avec toi");
  line.words.forEach((w, i) => ((w.start = i), (w.end = i + 0.5)));
  const out = splitLongLines([line], 32);
  assert.equal(out.length, 2);
  assert.equal(lineText(out[0]), "Je marcherai sous la pluie,");
  assert.ok(out.every((l) => lineText(l).length <= 34));
  assert.equal(out[1].words[0].start, 5, "les mots gardent leur timing");
  assert.notEqual(out[0].id, out[1].id);
  const short = parseLyrics("Court");
  assert.equal(splitLongLines(short, 32)[0], short[0]);
});

test("couper / fusionner des lignes", () => {
  const lines = parseLyrics("un deux trois\nquatre");
  const split = splitLineAt(lines, 0, 1);
  assert.deepEqual(split.map(lineText), ["un", "deux trois", "quatre"]);
  assert.deepEqual(mergeWithNext(split, 1).map(lineText), ["un", "deux trois quatre"]);
});

test("lignes à partir d'une transcription (silences, longueur, marques de Suno)", () => {
  const words = [
    { text: " Hello", start: 1, end: 1.4 },
    { text: "world.", start: 1.5, end: 2 },
    { text: "Again", start: 5, end: 5.5 },
    { text: "!", start: 5.5, end: 5.6 },
  ];
  const lines = linesFromTranscript(words);
  assert.deepEqual(lines.map(lineText), ["Hello world.", "Again !"]);
  assert.equal(lines[1].stanza, 1, "long silence = nouveau couplet");
  const suno = linesFromTranscript([
    { text: "a", start: 0, end: 1 },
    { text: "b", start: 1, end: 2, br: 1 },
    { text: "c", start: 9, end: 10 },
  ]);
  assert.deepEqual(suno.map(lineText), ["a", "b c"], "avec des marques, on ne coupe qu'aux marques");
});

test("normalisation et ressemblance des mots", () => {
  assert.equal(normalizeToken("J'ai"), "jai");
  assert.equal(normalizeToken("Cœur,"), "coeur");
  assert.equal(normalizeToken("Été!"), "ete");
  assert.equal(similarity("amour", "amour"), 1);
  assert.ok(similarity("amour", "amours") > 0.8);
  assert.ok(similarity("amour", "train") < 0.3);
});

test("alignement de séquences : mots manquants, en trop, mal entendus", () => {
  const A = ["je", "pense", "a", "toi", "mon", "amour"];
  const B = ["euh", "je", "pense", "toi", "mon", "amours"];
  const r = alignSequences(A, B);
  assert.equal(r[0].j, 1);
  assert.equal(r[1].j, 2);
  assert.equal(r[2], null, "« à » absent de la transcription");
  assert.equal(r[3].j, 3);
  assert.equal(r[5].j, 5);
});

/** Transcription simulée : chaque mot dure 0.4 s, 0.1 s d'écart. */
function fakeTranscript(text, t0 = 1, { drop = [], typo = {} } = {}) {
  const out = [];
  let t = t0;
  text.split(/\s+/).forEach((w, i) => {
    if (!drop.includes(i)) out.push({ text: typo[i] ?? w, start: t, end: t + 0.4 });
    t += 0.5;
  });
  return out;
}

test("synchronisation sur la transcription de l'IA", () => {
  const lines = parseLyrics("Dans la nuit je pense à toi\nEt les étoiles chantent avec moi");
  const ref = fakeTranscript("dans la nuit je pense à toi et les étoiles chantent avec moi", 2, {
    drop: [5],
    typo: { 9: "étoile", 10: "chante" },
  });
  const { lines: out, matched, total } = syncLinesToReference(lines, ref, { duration: 30 });
  assert.equal(total, 13);
  assert.equal(matched, 12);
  const w = out.flatMap((l) => l.words);
  assert.equal(w[0].start, 2);
  assert.equal(w[4].start, 4, "« pense »");
  // « à » interpolé entre « pense » (fin 4.4) et « toi » (début 5)
  assert.ok(w[5].start >= 4.4 && w[5].end <= 5, JSON.stringify(w[5]));
  assert.equal(w[5].conf, 0);
  assert.equal(w[9].start, 6.5, "« étoiles » retrouvé malgré la faute");
  for (let i = 1; i < w.length; i++) assert.ok(w[i].start >= w[i - 1].end - 1e-9, "pas de chevauchement");
  assert.ok(lines[0].words[0].start === null, "les lignes d'origine ne sont pas modifiées");
});

test("refrain absent de la transcription : réparti entre les repères, pas collé", () => {
  const lines = parseLyrics("un deux trois\nquatre cinq six\nsept huit neuf\ndix onze douze");
  const ref = [...fakeTranscript("un deux trois", 1), ...fakeTranscript("dix onze douze", 40)];
  const { lines: out } = syncLinesToReference(lines, ref, { duration: 60 });
  const starts = out.map((l) => l.words[0].start);
  assert.equal(starts[0], 1);
  assert.equal(starts[3], 40);
  assert.ok(starts[1] > 2.4 && starts[1] < 38);
  assert.ok(starts[2] > starts[1] + 5 && starts[2] < 38, "les lignes manquantes se partagent le trou");
  // Avec la voix détectée, elles vont là où l'on chante.
  const withVoice = syncLinesToReference(lines, ref, {
    duration: 60,
    activity: [
      { start: 1, end: 2.5 },
      { start: 20, end: 26 },
      { start: 40, end: 41.5 },
    ],
  });
  const s2 = withVoice.lines.map((l) => l.words[0].start);
  assert.ok(s2[1] >= 20 && s2[2] > s2[1] && s2[2] < 26.5, JSON.stringify(s2));
});

test("mot coupé en deux par la transcription", () => {
  const lines = parseLyrics("aujourd'hui");
  const ref = [
    { text: "aujourd", start: 1, end: 1.3 },
    { text: "hui", start: 1.3, end: 1.6 },
  ];
  const { lines: out } = syncLinesToReference(lines, ref, { duration: 5 });
  assert.deepEqual([out[0].words[0].start, out[0].words[0].end], [1, 1.6]);
});

test("sans IA : répartition sur la voix détectée", () => {
  const lines = parseLyrics("un deux trois quatre\ncinq six sept huit");
  const out = syncLinesByActivity(lines, [
    { start: 5, end: 8 },
    { start: 20, end: 23 },
  ]);
  const a = out[0].words;
  const b = out[1].words;
  assert.ok(a[0].start >= 5 && a.at(-1).end <= 8.5);
  assert.ok(b[0].start >= 19.9, `deuxième ligne après le silence : ${b[0].start}`);
  assert.ok(a.every((w) => w.conf === 0));
});

test("décalage global et conservation du timing après modification du texte", () => {
  const lines = parseLyrics("un deux trois");
  lines[0].words.forEach((w, i) => ((w.start = 1 + i), (w.end = 1.5 + i), (w.conf = 1)));
  assert.equal(shiftAll(lines, -0.5)[0].words[0].start, 0.5);
  assert.equal(shiftAll(lines, -5)[0].words[0].start, 0);
  const edited = parseLyrics("un deux et trois");
  const { lines: out } = retimeAfterEdit(edited, lines, { duration: 10 });
  const w = out[0].words;
  assert.equal(w[0].start, 1);
  assert.equal(w[1].start, 2);
  assert.equal(w[3].start, 3);
  assert.ok(w[2].start >= 2.5 && w[2].end <= 3);
  assert.equal(w[0].conf, 1);
});

function timed(text, starts) {
  const lines = parseLyrics(text);
  lines.forEach((l, i) => {
    l.words.forEach((w, k) => {
      w.start = starts[i] + k * 0.5;
      w.end = w.start + 0.4;
    });
  });
  return lines;
}

test("affichage alterné (karaoké) : la ligne suivante prend la place de celle d'avant", () => {
  const lines = timed("a b\nc d\ne f\ng h", [10, 12, 14, 16]);
  const s = schedule(lines, { display: "alternate", lines: 2, preRoll: 2.5, hold: 1 });
  assert.deepEqual(visibleAt(s, 5, 0.3), []);
  const at9 = visibleAt(s, 9, 0.3);
  assert.deepEqual(
    at9.map((v) => [v.index, v.slot, v.state]),
    [
      [0, 0, "future"],
      [1, 1, "future"],
    ],
  );
  // Ligne 0 finie à 10.9 : la ligne 2 la remplace dans l'emplacement 0
  const at12 = visibleAt(s, 12.2, 0.3);
  assert.deepEqual(
    at12.map((v) => [v.index, v.slot]),
    [
      [1, 1],
      [2, 0],
    ],
  );
  assert.equal(at12.find((v) => v.index === 1).state, "current");
  assert.deepEqual(visibleAt(s, 30, 0.3), []);
  assert.ok(wordProgress(lines[0].words[0], 10.2) > 0.49 && wordProgress(lines[0].words[0], 10.2) < 0.51);
});

test("affichage par page et défilement", () => {
  const lines = timed("a\nb\nc\nd", [10, 11, 12, 13]);
  const page = schedule(lines, { display: "page", lines: 2, preRoll: 2, hold: 1 });
  assert.deepEqual(
    visibleAt(page, 10.5).map((v) => v.index),
    [0, 1],
  );
  assert.deepEqual(
    visibleAt(page, 12.2).map((v) => v.index),
    [2, 3],
  );
  const scroll = schedule(lines, { display: "scroll", lines: 3, preRoll: 2, hold: 1 });
  const v = visibleAt(scroll, 11.6);
  const focus = v.find((x) => x.focus);
  assert.equal(focus.index, 1);
  assert.ok(v.some((x) => x.index === 0) && v.some((x) => x.index === 2));
});

test("compte à rebours et titre d'introduction", () => {
  const lines = timed("a b\nc d", [10, 30]);
  const s = schedule(lines, { display: "alternate", lines: 2, preRoll: 2.5, hold: 1 });
  assert.equal(countdownAt(s, 8.5).index, 0);
  assert.equal(countdownAt(s, 5), null);
  assert.equal(countdownAt(s, 28).index, 1, "après un long silence");
  assert.equal(titleAlpha(s, 0, 4), 1);
  assert.equal(titleAlpha(s, 5, 4), 0);
});

test("son : pics, WAV, détection de voix, retrait du centre", () => {
  const sr = 8000;
  const n = sr * 4;
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  // « voix » au centre de 1 à 2 s, bruit léger partout
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const voice = t >= 1 && t < 2 ? 0.5 * Math.sin(2 * Math.PI * 800 * t) : 0;
    const noise = ((Math.sin(i * 12.9898) * 43758.5453) % 1) * 0.01;
    L[i] = voice + noise;
    R[i] = voice - noise;
  }
  const peaks = computePeaks([L, R], sr, 10);
  assert.equal(peaks.length, 40);
  assert.ok(peaks[15] > 0.45 && peaks[5] < 0.05);
  const segs = detectActivity([L, R], sr);
  assert.equal(segs.length, 1);
  assert.ok(Math.abs(segs[0].start - 1) < 0.1 && Math.abs(segs[0].end - 2) < 0.1, JSON.stringify(segs));
  const [kl] = centerCancel(L, R, sr);
  const kp = computePeaks([kl], sr, 10);
  assert.ok(kp[15] < 0.1, "la voix au centre est retirée");
  const wav = new DataView(encodeWav([L], sr));
  assert.equal(String.fromCharCode(wav.getUint8(0), wav.getUint8(1), wav.getUint8(2), wav.getUint8(3)), "RIFF");
  assert.equal(wav.getUint32(24, true), sr);
  assert.equal(wav.byteLength, 44 + n * 2);
  const speech = new DataView(speechWav([L, R], sr));
  assert.equal(speech.getUint32(24, true), 16000);
  const m = mix([
    { channels: [L, R], gain: 1 },
    { channels: [L, R], gain: 1 },
  ]);
  assert.ok(Math.max(...m[0]) <= 0.99);
});

test("style : tailles d'export, fusion, préréglages", () => {
  assert.deepEqual(frameSize("16:9", "1080p"), { width: 1920, height: 1080 });
  assert.deepEqual(frameSize("16:9", "4K"), { width: 3840, height: 2160 });
  assert.deepEqual(frameSize("9:16", "720p"), { width: 720, height: 1280 });
  assert.deepEqual(frameSize("1:1", "1080p"), { width: 1080, height: 1080 });
  const s = mergeStyle(defaultStyle(), { font: { size: 80 }, duo: { enabled: true } });
  assert.equal(s.font.size, 80);
  assert.equal(s.font.family, "Montserrat");
  assert.equal(s.duo.singers.length, 3);
  for (const p of PRESETS) assert.ok(normalizeStyle(mergeStyle(defaultStyle(), p.patch)).layout.display);
});

test("retour à la ligne équilibré", () => {
  assert.deepEqual(wrapRows([100, 100, 100], 10, 1000), [[0, 1, 2]]);
  assert.deepEqual(wrapRows([100, 100, 100, 100], 10, 250), [
    [0, 1],
    [2, 3],
  ]);
  assert.deepEqual(
    wrapRows([100, 100, 100, 100], 10, 330),
    [
      [0, 1],
      [2, 3],
    ],
    "pas de mot orphelin",
  );
});

/** Contexte 2D factice : enregistre les textes dessinés. */
function fakeCtx() {
  const calls = [];
  const handler = {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === "measureText") return (s) => ({ width: s.length * 30 });
      if (prop === "createLinearGradient" || prop === "createRadialGradient") return () => ({ addColorStop() {} });
      return (...args) => calls.push([prop, ...args]);
    },
    set(target, prop, v) {
      target[prop] = v;
      return true;
    },
  };
  return { ctx: new Proxy({ letterSpacing: "0px" }, handler), calls };
}

test("rendu : dessine fond, titre, lignes, sans erreur dans tous les modes", () => {
  const lines = timed("Dans la nuit\nJe pense à toi\nEncore", [5, 7, 9]);
  for (const display of ["single", "alternate", "page", "scroll"]) {
    for (const highlight of ["wipe", "word", "line", "none"]) {
      const style = mergeStyle(defaultStyle(), { layout: { display }, highlight, mode: "karaoke", duo: { enabled: true } });
      const project = { title: "Titre", artist: "Artiste", lines, style };
      const r = new Renderer();
      for (const t of [0, 3, 5.2, 7.3, 9.1, 20]) {
        const { ctx, calls } = fakeCtx();
        r.draw(ctx, 1920, 1080, t, project, {});
        const texts = calls.filter((c) => c[0] === "fillText").map((c) => c[1]);
        if (t === 0) assert.ok(texts.includes("Titre"), `${display} : titre à 0 s`);
        if (t === 5.2) assert.ok(texts.includes("nuit"), `${display}/${highlight} : ligne chantée visible`);
      }
    }
  }
});

test("rendu : tous les effets de chant, animations, fonds, effets et médias", () => {
  const lines = timed("Dans la nuit\nJe pense à toi\nEncore", [5, 7, 9]);
  const sr = 11025;
  const samples = new Float32Array(sr * 12).map((_, i) => 0.5 * Math.sin((2 * Math.PI * 80 * i) / sr));
  const audio = { samples, sampleRate: sr };
  const img = { source: {}, width: 800, height: 800 };
  const highlights = ["wipe", "word", "line", "bounce", "scale", "glow", "underline", "none"];
  const anims = ["fade", "slide-up", "slide-down", "slide-left", "slide-right", "zoom", "drop", "blur", "typewriter", "none"];
  const particles = ["none", "bokeh", "snow", "stars", "sparkles", "hearts", "embers"];
  const vizs = ["none", "bars", "mirror", "wave", "circle"];
  for (let i = 0; i < 10; i++) {
    const style = mergeStyle(defaultStyle(), {
      highlight: highlights[i % highlights.length],
      pastLines: ["sung", "dim", "text", "hide"][i % 4],
      font: { italic: i % 2 === 0, transform: ["none", "uppercase", "lowercase", "capitalize"][i % 4], wordSpacing: 4 },
      colors: { sungGradient: i % 3 === 0, glow: i % 2 ? 20 : 0, sungOutline: i % 2 ? "#ff0000" : "", textOpacity: 0.7 },
      box: { enabled: i % 2 === 1, full: i % 4 === 1 },
      layout: { animation: anims[i], display: ["single", "alternate", "page", "scroll"][i % 4], x: 0.1 },
      background: { type: ["color", "gradient", "image", "video"][i % 4], gradientType: i % 2 ? "radial" : "linear", animate: true, vignette: 0.4, tintOpacity: 0.2, brightness: 1.2 },
      effects: { particles: particles[i % particles.length], visualizer: vizs[i % vizs.length], progress: true, beatZoom: 0.05 },
      top: { enabled: true, spin: 33, pulse: 0.1, shape: ["rect", "rounded", "circle"][i % 3] },
      logo: { enabled: true, position: ["top-left", "top-right", "bottom-left", "bottom-right"][i % 4] },
      duo: { enabled: i % 2 === 0, showNames: true },
      outro: { enabled: true },
    });
    const project = { title: "Titre", artist: "Artiste", lines, style, duration: 12 };
    const r = new Renderer();
    for (const t of [0, 5.05, 5.2, 7.3, 11.5]) {
      const { ctx, calls } = fakeCtx();
      r.draw(ctx, 1080, 1920, t, project, { bg: img, top: img, logo: img, audio, watermark: { text: "Fait avec Lyric Studio" } });
      const texts = calls.filter((c) => c[0] === "fillText").map((c) => c[1]);
      assert.ok(texts.includes("Fait avec Lyric Studio"), "filigrane");
      if (t === 11.5) assert.ok(texts.some((x) => /merci/i.test(x)), `fin de vidéo (${i})`);
    }
  }
});

test("texte : majuscules, minuscules, initiales, italique", () => {
  assert.equal(transformText("je t'aime à paris", "uppercase"), "JE T'AIME À PARIS");
  assert.equal(transformText("Dans La NUIT", "lowercase"), "dans la nuit");
  assert.equal(transformText("dans la nuit d'été", "capitalize"), "Dans La Nuit D'Été");
  assert.match(fontString({ family: "Lobster", italic: true, weight: 400 }, 50), /^italic 400 50px "Lobster"/);
});

test("anciens projets : réglages convertis, styles partageables, polices et formules", () => {
  const old = normalizeStyle({ font: { uppercase: true }, layout: { animation: "slide" }, background: { gradient: ["#000", "#fff"] } });
  assert.equal(old.font.transform, "uppercase");
  assert.equal(old.font.uppercase, undefined);
  assert.equal(old.layout.animation, "slide-up");
  assert.equal(old.background.gradient.length, 3);
  const s = shareableStyle(mergeStyle(defaultStyle(), { background: { type: "image", media: "a.jpg" }, top: { enabled: true, media: "b.jpg" } }));
  assert.equal(s.background.media, null);
  assert.equal(s.background.type, "gradient");
  assert.equal(s.top.enabled, false);
  assert.ok(FONTS.length >= 60);
  assert.equal(new Set(FONTS.map((f) => f.name)).size, FONTS.length, "pas de police en double");
  for (const p of Object.values(DEFAULT_PLANS)) assert.ok(p.name && p.maxResolution && p.aiMinutes >= 0);
  assert.equal(needsAudio(defaultStyle()), false);
  assert.equal(needsAudio(mergeStyle(defaultStyle(), { effects: { visualizer: "bars" } })), true);
});

test("son : FFT, spectre et forme d'onde pour le visualiseur", () => {
  const re = new Float32Array(8).fill(1);
  const im = new Float32Array(8);
  fft(re, im);
  assert.ok(Math.abs(re[0] - 8) < 1e-5 && Math.abs(re[3]) < 1e-5);
  const sr = 44100;
  const tone = (f) => new Float32Array(sr * 2).map((_, i) => 0.8 * Math.sin((2 * Math.PI * f * i) / sr));
  const low = analysisTrack([tone(100)], sr);
  const high = analysisTrack([tone(3000)], sr);
  assert.equal(low.sampleRate, 11025);
  const a = spectrumAt(low, 1, 32);
  const b = spectrumAt(high, 1, 32);
  const argmax = (x) => x.indexOf(Math.max(...x));
  assert.ok(argmax(Array.from(a.bands)) < argmax(Array.from(b.bands)), "les graves à gauche, les aigus à droite");
  assert.ok(a.bass > 0.5 && b.bass < 0.3, `basses : ${a.bass} / ${b.bass}`);
  assert.equal(spectrumAt(low, 50, 32).bands.every((v) => v === 0), true, "silence après la fin");
  assert.equal(waveAt(low, 1, 64).length, 64);
  assert.equal(peakOf([new Float32Array([0.1, -0.7, 0.3])]).toFixed(2), "0.70");
});
