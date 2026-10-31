// Mes vidéos : nouveau projet (fichier audio/vidéo ou chanson Suno), consommation de la formule, liste des projets.
import { h, toast, fmtTime, fmtSize, progressBar, field, confirmBox } from "./ui.js";
import { api, upload } from "./api.js";
import { session, upgradePrompt, loadMe } from "./session.js";

const ACCEPT = "audio/*,video/*,.mp3,.wav,.flac,.aac,.m4a,.ogg,.opus,.mp4,.mov,.mkv,.webm,.m4v";

/** Jauges de la formule (projets, minutes d'IA, exports, stockage). */
export function usageBars() {
  const { plan, usage, storage, projects, user } = session.me;
  if (user.role === "admin") return h("p", { class: "hint" }, "Administrateur : aucune limite.");
  const bar = (label, used, max, fmt = String) => {
    const x = max > 0 ? Math.min(1, used / max) : 1;
    return h(
      "div",
      { class: `usage${x >= 1 ? " full" : x > 0.8 ? " high" : ""}` },
      h("div", { class: "usage-head" }, h("span", {}, label), h("span", {}, `${fmt(used)} / ${fmt(max)}`)),
      h("div", { class: "usage-track" }, h("div", { class: "usage-fill", style: { width: `${x * 100}%` } })),
    );
  };
  return h(
    "div",
    { class: "usage-grid" },
    bar("Projets", projects, plan.maxProjects),
    bar("Minutes d'IA ce mois", Math.round(usage.ai_seconds / 60), plan.aiMinutes),
    bar("Exports ce mois", usage.exports, plan.exportsPerMonth),
    bar("Stockage", storage, plan.storageMb * 1024 * 1024, fmtSize),
  );
}

export async function renderHome(root, nav) {
  const caps = session.caps;
  await loadMe().catch(() => {});
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
      location.hash = `#p-${p.id}`;
    } catch (e) {
      if (e.upgrade) upgradePrompt(e.message);
      else toast(e.message, "error", 6000);
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
          location.hash = `#p-${p.id}`;
        } catch (e) {
          if (e.upgrade) upgradePrompt(e.message);
          else toast(e.message, "error", 7000);
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
  const me = session.me;
  const page = h(
    "div",
    { class: "home" },
    h(
      "section",
      { class: "card plan-summary" },
      h(
        "div",
        { class: "row gap wrap" },
        h("h2", {}, `Bonjour${me.user.name ? ` ${me.user.name}` : ""} 👋`),
        h("span", { class: `badge plan-${me.plan.id}` }, `Formule ${me.plan.name}`),
        me.user.role !== "admin" && me.plan.id === "free" && h("a", { class: "btn primary small", href: "#compte" }, "Passer à Pro"),
      ),
      usageBars(),
    ),
    h("section", { class: "card new-project" }, h("h2", {}, "Nouvelle vidéo"), caps.kie ? tabs : null, fileBox, sunoBox),
    h("section", {}, h("h2", {}, "Mes projets"), grid),
  );
  root.replaceChildren(h("div", { class: "app-page" }, nav(), page));
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
          { href: `#p-${p.id}`, class: `thumb aspect-${p.aspect.replace(":", "-")}` },
          p.thumb ? h("img", { src: p.thumb, alt: "", loading: "lazy" }) : h("span", { class: "thumb-ph" }, "🎵"),
        ),
        h(
          "div",
          { class: "project-info" },
          h("a", { href: `#p-${p.id}`, class: "project-title" }, p.title || "Sans titre"),
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
                await api(`/api/projects/${p.id}/duplicate`, { method: "POST" }).catch((e) =>
                  e.upgrade ? upgradePrompt(e.message) : toast(e.message, "error"),
                );
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
