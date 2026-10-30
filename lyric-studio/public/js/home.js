// Accueil : nouveau projet (fichier audio/vidéo ou chanson Suno), liste des projets, réglages.
import { h, toast, modal, fmtTime, progressBar, field, confirmBox } from "./ui.js";
import { api, upload } from "./api.js";

const ACCEPT = "audio/*,video/*,.mp3,.wav,.flac,.aac,.m4a,.ogg,.opus,.mp4,.mov,.mkv,.webm,.m4v";

export async function renderHome(root, caps) {
  let file = null;
  const fileInput = h("input", { type: "file", accept: ACCEPT, hidden: true, onchange: () => pick(fileInput.files[0]) });
  const dropLabel = h(
    "div",
    { class: "drop-label" },
    h("strong", {}, "Dépose ta chanson ici"),
    h("span", {}, "ou clique pour choisir · MP3, WAV, FLAC, AAC, MP4, MOV, MKV"),
  );
  const drop = h(
    "div",
    {
      class: "dropzone",
      tabindex: "0",
      role: "button",
      onclick: () => fileInput.click(),
      onkeydown: (e) => (e.key === "Enter" || e.key === " ") && fileInput.click(),
      ondragover: (e) => (e.preventDefault(), drop.classList.add("over")),
      ondragleave: () => drop.classList.remove("over"),
      ondrop: (e) => {
        e.preventDefault();
        drop.classList.remove("over");
        pick(e.dataTransfer.files[0]);
      },
    },
    h("div", { class: "drop-icon" }, "🎵"),
    dropLabel,
    fileInput,
  );
  const title = h("input", { type: "text", placeholder: "Titre (facultatif)" });
  const artist = h("input", { type: "text", placeholder: "Artiste (facultatif)" });
  const lyrics = h("textarea", {
    rows: 7,
    placeholder:
      "Paroles (facultatif) : colle-les ici, une ligne par ligne à l'écran.\nSans paroles, l'IA les écoute et les écrit.\n\nDuo : A: ou B: en début de ligne.",
  });
  let mode = "lyric";
  let aspect = "16:9";
  const seg = (options, get, set) => {
    const buttons = options.map(([v, t]) =>
      h(
        "button",
        {
          type: "button",
          class: `seg-btn${get() === v ? " on" : ""}`,
          onclick: () => (set(v), buttons.forEach((b, i) => b.classList.toggle("on", options[i][0] === v))),
        },
        t,
      ),
    );
    return h("div", { class: "seg" }, buttons);
  };
  const create = h("button", { class: "btn primary big", onclick: () => submit() }, "Créer la vidéo");
  const bar = progressBar();
  bar.el.hidden = true;

  function pick(f) {
    if (!f) return;
    file = f;
    dropLabel.replaceChildren(h("strong", {}, f.name), h("span", {}, `${(f.size / 1e6).toFixed(1)} Mo · cliquer pour changer`));
    drop.classList.add("has-file");
    if (!title.value) title.value = f.name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ");
  }

  async function submit() {
    if (!file) return toast("Choisis d'abord un fichier audio ou vidéo.", "info");
    const form = new FormData();
    form.append("title", title.value.trim());
    form.append("artist", artist.value.trim());
    form.append("lyrics", lyrics.value);
    form.append("mode", mode);
    form.append("aspect", aspect);
    form.append("file", file);
    create.disabled = true;
    bar.el.hidden = false;
    try {
      const p = await upload("/api/projects", form, (x) => bar.set(x * 0.95, x < 1 ? `Envoi… ${Math.round(x * 100)} %` : "Préparation…"));
      location.hash = `#/p/${p.id}`;
    } catch (e) {
      toast(e.message, "error", 6000);
      create.disabled = false;
      bar.el.hidden = true;
    }
  }

  // Chanson Suno
  const taskId = h("input", { type: "text", placeholder: "Numéro de tâche Suno (taskId)" });
  const audioId = h("input", { type: "text", placeholder: "Version (audioId, facultatif)" });
  const sunoBtn = h(
    "button",
    {
      class: "btn primary",
      onclick: async () => {
        if (!taskId.value.trim()) return toast("Indique le numéro de tâche Suno.", "info");
        sunoBtn.disabled = true;
        sunoBtn.textContent = "Import…";
        try {
          const p = await api("/api/projects/suno", {
            method: "POST",
            json: { taskId: taskId.value.trim(), audioId: audioId.value.trim() },
          });
          location.hash = `#/p/${p.id}`;
        } catch (e) {
          toast(e.message, "error", 7000);
          sunoBtn.disabled = false;
          sunoBtn.textContent = "Importer";
        }
      },
    },
    "Importer",
  );
  const sunoBox = h(
    "div",
    { class: "suno-box" },
    h(
      "p",
      { class: "hint" },
      "Chanson créée avec Suno via Kie.ai : le son, la pochette, les paroles et leur minutage exact sont récupérés (synchro parfaite, sans IA en plus).",
    ),
    caps.kie ? null : h("p", { class: "hint warn" }, "Ajoute d'abord ta clé Kie.ai dans les Réglages."),
    h("div", { class: "grid2" }, taskId, audioId),
    sunoBtn,
  );
  let tab = "file";
  const fileBox = h(
    "div",
    {},
    drop,
    h("div", { class: "grid2" }, title, artist),
    h(
      "div",
      { class: "grid2" },
      field(
        "Type",
        seg(
          [
            ["lyric", "🎤 Vidéo lyrique"],
            ["karaoke", "🎶 Karaoké"],
          ],
          () => mode,
          (v) => (mode = v),
        ),
      ),
      field(
        "Format",
        seg(
          [
            ["16:9", "16:9"],
            ["9:16", "9:16"],
            ["1:1", "1:1"],
          ],
          () => aspect,
          (v) => (aspect = v),
        ),
      ),
    ),
    field("Paroles", lyrics),
    h("div", { class: "row gap" }, create, bar.el),
  );
  sunoBox.hidden = true;
  const tabs = h(
    "div",
    { class: "tabs" },
    [
      ["file", "Fichier audio / vidéo"],
      ["suno", "Chanson Suno"],
    ].map(([id, label]) =>
      h(
        "button",
        {
          class: `tab${id === tab ? " on" : ""}`,
          onclick: (e) => {
            tab = id;
            fileBox.hidden = id !== "file";
            sunoBox.hidden = id !== "suno";
            e.target.parentElement.querySelectorAll(".tab").forEach((b) => b.classList.toggle("on", b === e.target));
          },
        },
        label,
      ),
    ),
  );

  const grid = h("div", { class: "projects" }, h("p", { class: "hint" }, "Chargement…"));
  const page = h(
    "div",
    { class: "home" },
    h(
      "header",
      { class: "home-head" },
      h("h1", {}, h("span", { class: "logo" }, "🎤"), " Lyric Studio"),
      h("p", { class: "tagline" }, "Vidéos lyriques et karaoké synchronisés mot par mot"),
      h("button", { class: "btn", onclick: () => openSettings(caps) }, "⚙ Réglages"),
    ),
    h("section", { class: "card new-project" }, h("h2", {}, "Nouvelle vidéo"), tabs, fileBox, sunoBox),
    h("section", {}, h("h2", {}, "Mes projets"), grid),
  );
  root.replaceChildren(page);
  await loadProjects(grid);
}

async function loadProjects(grid) {
  let list;
  try {
    list = await api("/api/projects");
  } catch (e) {
    grid.replaceChildren(h("p", { class: "hint warn" }, e.message));
    return;
  }
  if (!list.length) return grid.replaceChildren(h("p", { class: "empty" }, "Aucun projet pour l'instant : importe une chanson ci-dessus."));
  grid.replaceChildren(
    ...list.map((p) =>
      h(
        "article",
        { class: "project-card" },
        h(
          "a",
          { href: `#/p/${p.id}`, class: `thumb aspect-${p.aspect.replace(":", "-")}` },
          p.thumb ? h("img", { src: p.thumb, alt: "", loading: "lazy" }) : h("span", { class: "thumb-ph" }, "🎵"),
        ),
        h(
          "div",
          { class: "project-info" },
          h("a", { href: `#/p/${p.id}`, class: "project-title" }, p.title || "Sans titre"),
          h("small", {}, [p.artist, p.duration ? fmtTime(p.duration, 0) : null, `${p.lines} lignes`].filter(Boolean).join(" · ")),
          h(
            "div",
            { class: "badges" },
            h("span", { class: `badge ${p.mode}` }, p.mode === "karaoke" ? "Karaoké" : "Lyrique"),
            h("span", { class: "badge" }, p.aspect),
            !p.synced && h("span", { class: "badge warn" }, "à synchroniser"),
          ),
        ),
        h(
          "div",
          { class: "project-actions" },
          h(
            "button",
            {
              class: "icon-btn",
              title: "Dupliquer",
              onclick: async () => {
                await api(`/api/projects/${p.id}/duplicate`, { method: "POST" }).catch((e) => toast(e.message, "error"));
                loadProjects(grid);
              },
            },
            "⧉",
          ),
          h(
            "button",
            {
              class: "icon-btn",
              title: "Supprimer",
              onclick: async () => {
                if (!(await confirmBox(`Supprimer « ${p.title} » et ses fichiers ?`, { ok: "Supprimer", danger: true }))) return;
                await api(`/api/projects/${p.id}`, { method: "DELETE" }).catch((e) => toast(e.message, "error"));
                loadProjects(grid);
              },
            },
            "🗑",
          ),
        ),
      ),
    ),
  );
}

const WHISPER_PRESETS = [
  ["https://api.groq.com/openai/v1/audio/transcriptions", "whisper-large-v3", "Groq (gratuit, rapide)"],
  ["https://api.openai.com/v1/audio/transcriptions", "whisper-1", "OpenAI"],
];

export async function openSettings(caps) {
  const s = await api("/api/settings");
  const inputs = {};
  const text = (k, attrs = {}) =>
    (inputs[k] = h("input", { type: "text", value: s[k] || "", autocomplete: "off", spellcheck: "false", ...attrs }));
  const secret = (k) => text(k, { type: "password", placeholder: s[k] ? "clé enregistrée (laisser tel quel)" : "colle ta clé ici" });
  const preset = h(
    "select",
    {
      onchange: () => {
        const p = WHISPER_PRESETS[Number(preset.value)];
        if (p) {
          inputs.transcription_url.value = p[0];
          inputs.transcription_model.value = p[1];
        }
      },
    },
    WHISPER_PRESETS.map((p, i) => h("option", { value: String(i) }, p[2])),
    h("option", { value: "x" }, "Autre service compatible"),
  );
  const idx = WHISPER_PRESETS.findIndex((p) => p[0] === s.transcription_url);
  preset.value = idx >= 0 ? String(idx) : "x";
  const provider = h(
    "select",
    {},
    h("option", { value: "auto" }, "Automatique (ElevenLabs si sa clé est là)"),
    h("option", { value: "whisper" }, "Whisper (Groq / OpenAI)"),
    h("option", { value: "elevenlabs" }, "ElevenLabs Scribe"),
  );
  provider.value = s.transcription_provider || "auto";
  inputs.transcription_provider = provider;
  const ok = (b) => h("span", { class: b ? "ok" : "warn" }, b ? "✓ installé" : "✗ absent");
  const body = h(
    "div",
    { class: "settings" },
    h("h3", {}, "Transcription mot par mot (synchro automatique)"),
    h(
      "p",
      { class: "hint" },
      "Une de ces clés suffit. Groq est gratuit : console.groq.com/keys. ElevenLabs Scribe est le plus précis sur le chant.",
    ),
    field("Service préféré", provider),
    h("div", { class: "grid2" }, field("Whisper", preset), field("Clé Whisper", secret("transcription_api_key"))),
    h("div", { class: "grid2" }, field("Adresse", text("transcription_url")), field("Modèle", text("transcription_model"))),
    field("Clé ElevenLabs", secret("elevenlabs_api_key")),
    h("h3", {}, "Suno (Kie.ai)"),
    field(
      "Clé Kie.ai",
      secret("kie_api_key"),
      "Import des chansons Suno avec leurs paroles horodatées, et séparation de la voix par Suno.",
    ),
    h("h3", {}, "Sur cet ordinateur"),
    h(
      "table",
      { class: "kv" },
      h("tr", {}, h("th", {}, "ffmpeg"), h("td", {}, ok(caps.ffmpeg), " — vidéos MKV/MOV, finition des exports")),
      h("tr", {}, h("th", {}, "Demucs"), h("td", {}, ok(caps.demucs), " — séparation de la voix gratuite (pip install demucs)")),
    ),
  );
  modal({
    title: "Réglages",
    body,
    wide: true,
    actions: [
      { label: "Annuler", onClick: (c) => c() },
      {
        label: "Enregistrer",
        primary: true,
        onClick: async (close) => {
          const patch = {};
          for (const [k, el] of Object.entries(inputs)) {
            if (el.type === "password" && !el.value && s[k]) continue;
            patch[k] = el.value;
          }
          try {
            await api("/api/settings", { method: "PUT", json: patch });
            Object.assign(caps, await api("/api/capabilities"));
            toast("Réglages enregistrés.", "ok");
            close();
          } catch (e) {
            toast(e.message, "error");
          }
        },
      },
    ],
  });
  // Les champs de clé gardent la valeur masquée : on les vide pour ne pas renvoyer « •••• ».
  for (const k of ["transcription_api_key", "elevenlabs_api_key", "kie_api_key"]) inputs[k].value = "";
}
