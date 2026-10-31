// Administration : chiffres, demandes d'abonnement à valider, clients, formules et prix,
// réglages du site (nom, contact, paiement, conditions) et clés des services d'IA.
import { h, toast, modal, field, fmtSize, confirmBox, promptBox, safeStorage } from "./ui.js";
import { api } from "./api.js";
import { session, loadConfig, fmtDate } from "./session.js";

const TABS = [
  ["stats", "Tableau de bord"],
  ["requests", "Demandes"],
  ["users", "Clients"],
  ["plans", "Formules et prix"],
  ["site", "Site et IA"],
];

export async function renderAdmin(root, nav) {
  let tab = safeStorage.get("admin-tab") || "stats";
  const body = h("div", { class: "admin-body" });
  const tabs = h(
    "div",
    { class: "tabs" },
    TABS.map(([id, label]) =>
      h(
        "button",
        {
          class: `tab${id === tab ? " on" : ""}`,
          onclick: (e) => {
            tab = id;
            safeStorage.set("admin-tab", id);
            tabs.querySelectorAll(".tab").forEach((b) => b.classList.toggle("on", b === e.target));
            show();
          },
        },
        label,
      ),
    ),
  );
  const show = () => {
    body.replaceChildren(h("p", { class: "hint" }, "Chargement…"));
    const views = { stats: statsView, requests: requestsView, users: usersView, plans: plansView, site: siteView };
    views[tab](body).catch((e) => body.replaceChildren(h("p", { class: "warn" }, e.message)));
  };
  root.replaceChildren(h("div", { class: "app-page" }, nav(), h("div", { class: "home wide" }, h("h1", {}, "Administration"), tabs, body)));
  show();
}

// ---------- Tableau de bord ----------
async function statsView(body) {
  const s = await api("/api/admin/stats");
  const caps = session.caps;
  const tile = (label, value, hint) =>
    h(
      "div",
      { class: "tile" },
      h("div", { class: "tile-value" }, String(value)),
      h("div", { class: "tile-label" }, label),
      hint && h("small", { class: "hint" }, hint),
    );
  body.replaceChildren(
    h(
      "div",
      { class: "tiles" },
      tile("Clients", s.users, `${s.newUsers} nouveaux en 30 jours`),
      tile("Abonnés payants", s.paying),
      tile("Demandes à vérifier", s.pending),
      tile("Projets", s.projects, fmtSize(s.storage)),
      tile("Exports ce mois", s.exports),
      tile("Minutes d'IA ce mois", s.aiMinutes),
    ),
    h(
      "section",
      { class: "card" },
      h("h2", {}, "Serveur"),
      h(
        "table",
        { class: "kv" },
        h(
          "tr",
          {},
          h("th", {}, "Transcription IA"),
          h("td", {}, caps.transcription.length ? `✓ ${caps.transcription.join(", ")}` : "✗ aucune clé : onglet « Site et IA »"),
        ),
        h("tr", {}, h("th", {}, "ffmpeg"), h("td", {}, caps.ffmpeg ? "✓ installé" : "✗ absent (vidéos MKV/MOV, finition des exports)")),
        h(
          "tr",
          {},
          h("th", {}, "Demucs (voix séparée)"),
          h("td", {}, caps.demucs ? "✓ installé" : "✗ absent : pip install demucs (serveur puissant conseillé)"),
        ),
        h("tr", {}, h("th", {}, "Suno (Kie.ai)"), h("td", {}, caps.kie ? "✓ clé enregistrée" : "— pas de clé")),
      ),
    ),
  );
}

// ---------- Demandes d'abonnement ----------
async function requestsView(body) {
  const status = h("select", {}, h("option", { value: "pending" }, "En attente"), h("option", { value: "all" }, "Toutes"));
  const list = h("div", {});
  const load = async () => {
    const rows = await api(`/api/admin/requests?status=${status.value}`);
    if (!rows.length) return list.replaceChildren(h("p", { class: "empty" }, "Aucune demande."));
    list.replaceChildren(
      h(
        "table",
        { class: "table" },
        h(
          "tr",
          {},
          h("th", {}, "Date"),
          h("th", {}, "Client"),
          h("th", {}, "Formule"),
          h("th", {}, "Durée"),
          h("th", {}, "Référence / message"),
          h("th", {}, ""),
        ),
        rows.map((r) =>
          h(
            "tr",
            {},
            h("td", {}, fmtDate(r.created_at)),
            h("td", {}, h("strong", {}, r.name || "—"), h("br"), r.email, r.phone && [h("br"), r.phone]),
            h("td", {}, session.config.plans[r.plan]?.name || r.plan),
            h("td", {}, `${r.months} mois`),
            h("td", {}, r.reference || "—", r.note && [h("br"), h("small", { class: "hint" }, r.note)]),
            h(
              "td",
              { class: "actions" },
              r.status === "pending"
                ? [
                    h(
                      "button",
                      {
                        class: "btn primary small",
                        onclick: async () => {
                          if (
                            !(await confirmBox(
                              `As-tu bien reçu le paiement de ${r.email} (réf. ${r.reference || "—"}) ? La formule sera activée ${r.months} mois.`,
                              { ok: "Oui, activer" },
                            ))
                          )
                            return;
                          await api(`/api/admin/requests/${r.id}/approve`, { method: "POST" }).catch((e) => toast(e.message, "error"));
                          toast("Formule activée.", "ok");
                          load();
                        },
                      },
                      "✓ Paiement reçu",
                    ),
                    h(
                      "button",
                      {
                        class: "btn small",
                        onclick: async () => {
                          await api(`/api/admin/requests/${r.id}/reject`, { method: "POST" }).catch((e) => toast(e.message, "error"));
                          load();
                        },
                      },
                      "Refuser",
                    ),
                  ]
                : r.status === "approved"
                  ? "✅ validée"
                  : "❌ refusée",
            ),
          ),
        ),
      ),
    );
  };
  status.addEventListener("change", load);
  body.replaceChildren(h("div", { class: "row gap" }, h("span", {}, "Afficher :"), status), list);
  await load();
}

// ---------- Clients ----------
async function usersView(body) {
  const q = h("input", { type: "search", placeholder: "Rechercher (e-mail, nom, téléphone)" });
  const list = h("div", {});
  const plans = session.config.plans;
  const load = async () => {
    const rows = await api(`/api/admin/users?q=${encodeURIComponent(q.value)}`);
    list.replaceChildren(
      h(
        "table",
        { class: "table" },
        h(
          "tr",
          {},
          h("th", {}, "Client"),
          h("th", {}, "Formule"),
          h("th", {}, "Ce mois"),
          h("th", {}, "Projets"),
          h("th", {}, "Inscrit"),
          h("th", {}, ""),
        ),
        rows.map((u) =>
          h(
            "tr",
            { class: u.disabled ? "disabled" : "" },
            h(
              "td",
              {},
              h("strong", {}, u.name || "—"),
              u.role === "admin" && h("span", { class: "badge" }, "admin"),
              h("br"),
              u.email,
              u.phone && [h("br"), u.phone],
            ),
            h(
              "td",
              {},
              plans[u.plan]?.name || u.plan,
              u.plan_until && u.plan !== "free"
                ? [h("br"), h("small", { class: u.plan_until < Date.now() ? "warn" : "hint" }, `jusqu'au ${fmtDate(u.plan_until)}`)]
                : null,
            ),
            h("td", {}, `${Math.round(u.ai_seconds / 60)} min IA · ${u.exports} exports`),
            h("td", {}, `${u.projects} · ${fmtSize(u.storage)}`),
            h("td", {}, fmtDate(u.created_at)),
            h("td", { class: "actions" }, h("button", { class: "btn small", onclick: () => editUser(u, load) }, "Gérer")),
          ),
        ),
      ),
    );
  };
  let timer;
  q.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(load, 300);
  });
  body.replaceChildren(q, list);
  await load();
}

function editUser(u, reload) {
  const plans = session.config.plans;
  const plan = h(
    "select",
    {},
    Object.entries(plans).map(([id, p]) => h("option", { value: id }, p.name)),
  );
  plan.value = u.plan;
  const until = h("input", { type: "date", value: u.plan_until ? new Date(u.plan_until).toISOString().slice(0, 10) : "" });
  const role = h("select", {}, h("option", { value: "user" }, "Client"), h("option", { value: "admin" }, "Administrateur"));
  role.value = u.role;
  const disabled = h("input", { type: "checkbox", checked: !!u.disabled });
  const quick = (months) => {
    const base = u.plan_until && u.plan_until > Date.now() ? new Date(u.plan_until) : new Date();
    base.setDate(base.getDate() + months * 30);
    until.value = base.toISOString().slice(0, 10);
  };
  modal({
    title: u.email,
    wide: true,
    body: h(
      "div",
      {},
      h("div", { class: "grid2" }, field("Formule", plan), field("Valable jusqu'au (vide = sans fin)", until)),
      h(
        "div",
        { class: "row gap wrap" },
        h("small", { class: "hint" }, "Prolonger :"),
        ...[1, 3, 6, 12].map((m) => h("button", { class: "btn small", onclick: () => quick(m) }, `+${m} mois`)),
      ),
      h(
        "div",
        { class: "grid2" },
        field("Rôle", role),
        h("label", { class: "toggle" }, disabled, h("span", { class: "toggle-ui" }), h("span", {}, "Compte suspendu")),
      ),
      h("hr"),
      h(
        "div",
        { class: "row gap wrap" },
        h(
          "button",
          {
            class: "btn",
            onclick: async () => {
              if (!(await confirmBox(`Créer un mot de passe provisoire pour ${u.email} ? Ses sessions seront fermées.`))) return;
              const r = await api(`/api/admin/users/${u.id}/password`, { method: "POST" }).catch((e) => toast(e.message, "error"));
              if (r)
                modal({
                  title: "Mot de passe provisoire",
                  body: h(
                    "div",
                    {},
                    h("p", {}, "Transmets-le au client (il pourra le changer dans « Mon compte ») :"),
                    h("p", { class: "temp-pass" }, r.password),
                  ),
                  actions: [{ label: "OK", primary: true, onClick: (c) => c() }],
                });
            },
          },
          "🔑 Mot de passe provisoire",
        ),
        h(
          "button",
          {
            class: "btn danger",
            onclick: async () => {
              if (
                !(await confirmBox(`Supprimer définitivement ${u.email}, ses projets et ses fichiers ?`, { ok: "Supprimer", danger: true }))
              )
                return;
              await api(`/api/admin/users/${u.id}`, { method: "DELETE" }).catch((e) => toast(e.message, "error"));
              document.querySelector(".overlay")?.remove();
              reload();
            },
          },
          "Supprimer le compte",
        ),
      ),
    ),
    actions: [
      { label: "Annuler", onClick: (c) => c() },
      {
        label: "Enregistrer",
        primary: true,
        onClick: async (close) => {
          try {
            await api(`/api/admin/users/${u.id}`, {
              method: "PATCH",
              json: { plan: plan.value, plan_until: until.value || "", role: role.value, disabled: disabled.checked },
            });
            close();
            toast("Client mis à jour.", "ok");
            reload();
          } catch (e) {
            toast(e.message, "error");
          }
        },
      },
    ],
  });
}

// ---------- Formules et prix ----------
const PLAN_FIELDS = [
  ["name", "Nom", "text"],
  ["price", "Prix (texte, ex. 5 000 FCFA)", "text"],
  ["period", "Période (mois, an…)", "text"],
  ["features", "Phrase d'accroche", "text"],
  ["maxProjects", "Projets au plus", "number"],
  ["maxMinutes", "Durée d'une chanson (min)", "number"],
  ["aiMinutes", "Minutes d'IA par mois", "number"],
  ["exportsPerMonth", "Exports par mois", "number"],
  ["storageMb", "Stockage (Mo)", "number"],
  ["maxResolution", "Qualité maximale", "res"],
  ["watermark", "Filigrane sur les vidéos", "bool"],
  ["stems", "Voix séparée par IA (serveur avec Demucs)", "bool"],
  ["suno", "Import Suno (Kie.ai)", "bool"],
];

async function plansView(body) {
  const s = await api("/api/admin/settings");
  const plans = structuredClone(s.plans);
  const render = () => {
    const cols = Object.entries(plans).map(([id, p]) =>
      h(
        "section",
        { class: "card plan-edit" },
        h(
          "div",
          { class: "row gap" },
          h("h3", {}, p.name || id),
          h("small", { class: "hint" }, `(${id})`),
          id !== "free" &&
            h("button", { class: "icon-btn", title: "Supprimer cette formule", onclick: () => (delete plans[id], render()) }, "🗑"),
        ),
        PLAN_FIELDS.map(([k, label, type]) => {
          let input;
          if (type === "bool") {
            input = h("input", { type: "checkbox", checked: !!p[k], onchange: () => (p[k] = input.checked) });
            return h("label", { class: "toggle" }, input, h("span", { class: "toggle-ui" }), h("span", {}, label));
          }
          if (type === "res") {
            input = h(
              "select",
              { onchange: () => (p[k] = input.value) },
              ["720p", "1080p", "4K"].map((r) => h("option", { value: r }, r)),
            );
            input.value = p[k];
          } else
            input = h("input", {
              type,
              value: String(p[k] ?? ""),
              min: "0",
              oninput: () => (p[k] = type === "number" ? Number(input.value) : input.value),
            });
          return field(label, input);
        }),
      ),
    );
    body.replaceChildren(
      h(
        "p",
        { class: "hint" },
        "La formule « free » est celle de chaque nouveau compte. Les prix sont du texte libre (monnaie, réductions…).",
      ),
      h("div", { class: "plans-edit" }, cols),
      h(
        "div",
        { class: "row gap wrap" },
        h(
          "button",
          {
            class: "btn",
            onclick: async () => {
              const id = await promptBox("Nouvelle formule", {
                placeholder: "business",
                hint: "Identifiant en lettres minuscules, sans espace.",
              });
              if (!id || !/^[a-z][a-z0-9_-]{1,20}$/.test(id) || plans[id]) return toast("Identifiant invalide ou déjà pris.", "error");
              plans[id] = { ...plans.pro, name: id[0].toUpperCase() + id.slice(1) };
              render();
            },
          },
          "+ Ajouter une formule",
        ),
        h(
          "button",
          {
            class: "btn primary",
            onclick: async () => {
              try {
                await api("/api/admin/settings", { method: "PUT", json: { plans } });
                await loadConfig();
                toast("Formules enregistrées.", "ok");
              } catch (e) {
                toast(e.message, "error");
              }
            },
          },
          "Enregistrer les formules",
        ),
      ),
    );
  };
  render();
}

// ---------- Site et IA ----------
const WHISPER_PRESETS = [
  ["https://api.groq.com/openai/v1/audio/transcriptions", "whisper-large-v3", "Groq (gratuit, rapide)"],
  ["https://api.openai.com/v1/audio/transcriptions", "whisper-1", "OpenAI"],
];

async function siteView(body) {
  const s = await api("/api/admin/settings");
  const inputs = {};
  const text = (k, attrs = {}) =>
    (inputs[k] = h("input", { type: "text", value: s[k] || "", autocomplete: "off", spellcheck: "false", ...attrs }));
  const area = (k, rows = 4) => (inputs[k] = h("textarea", { rows, value: s[k] || "" }));
  const secret = (k) => {
    const el = text(k, {
      type: "password",
      placeholder: s[k] ? `enregistrée (${s[k]}) — laisser vide pour la garder` : "colle la clé ici",
    });
    el.value = "";
    return el;
  };
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
  const provider = (inputs.transcription_provider = h(
    "select",
    {},
    h("option", { value: "auto" }, "Automatique (ElevenLabs si sa clé est là)"),
    h("option", { value: "whisper" }, "Whisper (Groq / OpenAI)"),
    h("option", { value: "elevenlabs" }, "ElevenLabs Scribe"),
  ));
  provider.value = s.transcription_provider || "auto";
  const signup = h("input", { type: "checkbox", checked: !!s.signup_open });
  body.replaceChildren(
    h(
      "section",
      { class: "card" },
      h("h2", {}, "Le site"),
      h(
        "div",
        { class: "grid2" },
        field("Nom de l'application", text("app_name")),
        field("Filigrane des vidéos gratuites", text("watermark_text"), "{app} = nom de l'application"),
      ),
      field("Slogan", text("tagline")),
      h(
        "div",
        { class: "grid2" },
        field("WhatsApp du support (format international)", text("support_whatsapp", { placeholder: "+225 07 00 00 00 00" })),
        field("E-mail du support", text("support_email")),
      ),
      h("label", { class: "toggle" }, signup, h("span", { class: "toggle-ui" }), h("span", {}, "Inscriptions ouvertes")),
      field("Instructions de paiement (montrées au client qui veut une formule payante)", area("payment_instructions", 4)),
    ),
    h(
      "section",
      { class: "card" },
      h("h2", {}, "Synchronisation par IA"),
      h(
        "p",
        { class: "hint" },
        "Une clé suffit. Groq est gratuit (console.groq.com/keys). ElevenLabs Scribe est le plus précis sur le chant. Ces clés servent à tous les clients : les quotas des formules limitent la dépense.",
      ),
      field("Service préféré", provider),
      h("div", { class: "grid2" }, field("Whisper", preset), field("Clé Whisper", secret("transcription_api_key"))),
      h("div", { class: "grid2" }, field("Adresse", text("transcription_url")), field("Modèle", text("transcription_model"))),
      field("Clé ElevenLabs", secret("elevenlabs_api_key")),
      field(
        "Clé Kie.ai (Suno)",
        secret("kie_api_key"),
        "Import des chansons Suno avec paroles horodatées et séparation de la voix par Suno.",
      ),
    ),
    h(
      "section",
      { class: "card" },
      h("h2", {}, "Application Android"),
      h(
        "p",
        { class: "hint" },
        "Sans rien faire, tes clients peuvent déjà installer l'application depuis Chrome (bouton « Installer l'application »). Pour le Play Store ou un fichier APK : crée le paquet sur pwabuilder.com avec l'adresse de ton site, puis colle ici le nom du paquet et l'empreinte SHA-256 qu'il te donne (voir DEPLOIEMENT.md).",
      ),
      h(
        "div",
        { class: "grid2" },
        field("Nom du paquet (ex. com.tonsite.lyrics)", text("android_package")),
        field("Empreinte(s) SHA-256 (séparées par des virgules)", text("android_sha256")),
      ),
      field("Lien de téléchargement (Play Store ou APK)", text("android_app_url"), "Affiché sur la page d'accueil."),
    ),
    h(
      "section",
      { class: "card" },
      h("h2", {}, "Conditions"),
      h(
        "p",
        { class: "hint" },
        "Laisse vide pour utiliser le texte proposé par défaut (à faire relire selon ton pays). Première ligne = titre.",
      ),
      field("Conditions d'utilisation", area("terms", 8)),
      field("Politique de confidentialité", area("privacy", 8)),
    ),
    h(
      "button",
      {
        class: "btn primary big",
        onclick: async () => {
          const patch = { signup_open: signup.checked };
          for (const [k, el] of Object.entries(inputs)) {
            if (el.type === "password" && !el.value) continue;
            patch[k] = el.value;
          }
          try {
            await api("/api/admin/settings", { method: "PUT", json: patch });
            await loadConfig();
            session.caps = await api("/api/capabilities");
            toast("Réglages enregistrés.", "ok");
            siteView(body);
          } catch (e) {
            toast(e.message, "error");
          }
        },
      },
      "Enregistrer",
    ),
  );
}
