// Tableau de bord — JavaScript sans framework.
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const CHANNELS = {
  whatsapp: "WhatsApp",
  whatsapp_cloud: "WA Business",
  telegram: "Telegram",
  messenger: "Messenger",
  instagram: "Instagram",
  facebook_comment: "Commentaire FB",
  test: "Test",
};
const AUTHORS = { client: "Client", agent: "Agent IA", owner: "Toi" };

let settings = {};
let contacts = [];
let currentId = null;
let testContactId = null;

async function api(path, opts = {}) {
  const init = { ...opts, headers: { ...(opts.headers || {}) } };
  if (opts.body && !(opts.body instanceof FormData)) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(opts.body);
  }
  const res = await fetch(path, init);
  if (res.status === 401 && path !== "/api/login") {
    showLogin();
    throw new Error("Non connecté");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.add("hidden"), 3500);
}

function time(ts) {
  const d = new Date(ts);
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
}

// ---------- Connexion ----------
function showLogin() {
  $("#login").classList.remove("hidden");
  $("#app").classList.add("hidden");
}
$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await api("/api/login", { method: "POST", body: { password: $("#login-pass").value } });
    start();
  } catch (err) {
    $("#login-error").textContent = err.message;
  }
});

// ---------- Onglets ----------
$$(".tabs button").forEach((b) =>
  b.addEventListener("click", () => {
    $$(".tabs button").forEach((x) => x.classList.toggle("active", x === b));
    $$(".tab").forEach((t) => t.classList.toggle("hidden", t.id !== `tab-${b.dataset.tab}`));
    if (b.dataset.tab === "channels") loadChannels();
    if (b.dataset.tab === "learn") loadLearn();
    if (b.dataset.tab === "business") loadKnowledge();
  }),
);

// ---------- Conversations ----------
async function loadContacts() {
  contacts = await api("/api/contacts");
  renderContacts();
}

function renderContacts() {
  const q = $("#search").value.toLowerCase();
  const list = contacts.filter((c) => c.channel !== "test" && (!q || `${c.name} ${c.external_id} ${c.last_text}`.toLowerCase().includes(q)));
  const alerts = list.filter((c) => c.needs_human || c.drafts).length;
  $("#badge").textContent = alerts;
  $("#badge").classList.toggle("hidden", !alerts);
  $("#contacts").innerHTML =
    list
      .map(
        (c) => `
    <div class="contact ${c.id === currentId ? "active" : ""}" data-id="${c.id}">
      <div class="top"><span class="name">${esc(c.name || c.external_id)}</span><span class="tag">${CHANNELS[c.channel] || c.channel}</span></div>
      <div class="top"><span class="preview">${c.last_author === "client" ? "" : "↩ "}${esc(c.last_text || "")}</span>
        <span>${c.needs_human ? '<span class="tag alert">besoin de toi</span>' : ""}${c.drafts ? `<span class="tag draft">${c.drafts} à valider</span>` : ""}${c.last_at ? `<span class="tag">${time(c.last_at)}</span>` : ""}</span></div>
    </div>`,
      )
      .join("") || '<p class="muted" style="padding:14px">Aucune conversation pour l\'instant.</p>';
  $$("#contacts .contact").forEach((el) => el.addEventListener("click", () => openContact(Number(el.dataset.id))));
}
$("#search").addEventListener("input", renderContacts);

function bubble(m, { actions = true } = {}) {
  const cls = m.status === "draft" ? "draft" : m.status === "rejected" ? "rejected" : m.author;
  let media = "";
  if (m.media_path && m.kind === "image") media = `<img src="/api/media/${m.id}" alt="photo" />`;
  if (m.media_path && m.kind === "audio") media = `<audio controls src="/api/media/${m.id}"></audio>`;
  const label = m.kind === "audio" ? "🎤 " : m.kind === "comment" ? "💬 " : "";
  const draftUi =
    m.status === "draft" && actions
      ? `<div class="draft-actions" data-id="${m.id}" data-text="${esc(m.text)}">
           <button class="primary small" data-act="approve">Envoyer</button>
           <button class="small" data-act="edit">Corriger</button>
           <button class="small danger" data-act="reject">Rejeter</button></div>`
      : "";
  return `<div class="bubble ${cls}">${media}${label}${esc(m.text)}
    <div class="meta">${AUTHORS[m.author] || m.author}${m.status === "draft" ? " · brouillon" : ""} · ${time(m.created_at)}</div>${draftUi}</div>`;
}

async function openContact(id) {
  currentId = id;
  $(".split").classList.add("open");
  const { contact: c, messages } = await api(`/api/contacts/${id}`);
  if (c.unread) api(`/api/contacts/${id}`, { method: "PATCH", body: { unread: 0 } });
  const paused = c.paused_until > Date.now();
  const forever = c.paused_until > Date.now() + 365 * 86400_000;
  $("#thread").innerHTML = `
    <div class="thread-head">
      <div><button class="ghost small" id="back">←</button> <span class="who">${esc(c.name || c.external_id)}</span>
        <span class="tag">${CHANNELS[c.channel] || c.channel}</span> <span class="muted">${esc(c.meta?.phone || "")}</span></div>
      <div class="btns" style="margin:0">
        <span class="status ${paused ? "" : "ok"}">${paused ? (forever ? "Agent en pause" : `Tu as la main jusqu'à ${new Date(c.paused_until).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`) : "Agent actif"}</span>
        <button class="small" id="toggle-pause">${paused ? "Réactiver l'agent" : "Mettre l'agent en pause"}</button>
        <button class="small" id="regen">Proposer une réponse</button>
      </div>
    </div>
    ${c.needs_human ? `<div class="alert-box"><span>🔔 ${esc(c.needs_human_reason || "L'agent a besoin de toi")}</span><button class="small" id="clear-alert">C'est réglé</button></div>` : ""}
    <div class="thread-body">
      <div style="display:flex;flex-direction:column;overflow:hidden">
        <div class="bubbles" id="bubbles">${messages.map((m) => bubble(m)).join("")}</div>
        <div class="thinking hidden" id="thinking">L'agent rédige une réponse…</div>
        <form class="composer" id="composer"><input id="manual" placeholder="Écrire toi-même (l'agent apprendra de ta réponse)…" /><button class="primary">Envoyer</button></form>
      </div>
      <div class="side">
        <h3>🧠 Mémoire sur ce client</h3>
        <textarea id="memory" rows="14">${esc(c.memory)}</textarea>
        <button class="small" id="save-memory">Enregistrer</button>
        <h3>Danger</h3>
        <button class="small danger" id="delete-contact">Supprimer la conversation</button>
      </div>
    </div>`;
  const b = $("#bubbles");
  b.scrollTop = b.scrollHeight;
  $("#back").onclick = () => $(".split").classList.remove("open");
  $("#toggle-pause").onclick = async () => {
    await api(`/api/contacts/${id}`, { method: "PATCH", body: { paused: !paused } });
    openContact(id);
  };
  $("#regen").onclick = async () => {
    await api(`/api/contacts/${id}/regenerate`, { method: "POST" });
    toast("L'agent prépare une réponse…");
  };
  $("#clear-alert")?.addEventListener("click", async () => {
    await api(`/api/contacts/${id}`, { method: "PATCH", body: { needs_human: false } });
    openContact(id);
    loadContacts();
  });
  $("#save-memory").onclick = async () => {
    await api(`/api/contacts/${id}`, { method: "PATCH", body: { memory: $("#memory").value } });
    toast("Mémoire enregistrée");
  };
  $("#delete-contact").onclick = async () => {
    if (!confirm("Supprimer cette conversation de l'agent ? (rien n'est supprimé sur ton téléphone)")) return;
    await api(`/api/contacts/${id}`, { method: "DELETE" });
    currentId = null;
    $("#thread").innerHTML = '<div class="empty">Choisis une conversation.</div>';
    loadContacts();
  };
  $("#composer").onsubmit = async (e) => {
    e.preventDefault();
    const text = $("#manual").value.trim();
    if (!text) return;
    $("#manual").value = "";
    try {
      await api(`/api/contacts/${id}/send`, { method: "POST", body: { text } });
    } catch (err) {
      toast(err.message);
    }
  };
  bindDraftActions($("#bubbles"), () => openContact(id));
}

function bindDraftActions(root, refresh) {
  root.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const box = btn.closest(".draft-actions");
    const id = box.dataset.id;
    try {
      if (btn.dataset.act === "approve") {
        const ta = box.querySelector("textarea");
        await api(`/api/messages/${id}/approve`, { method: "POST", body: ta ? { text: ta.value } : {} });
      } else if (btn.dataset.act === "reject") {
        await api(`/api/messages/${id}/reject`, { method: "POST" });
      } else if (btn.dataset.act === "edit") {
        const text = box.dataset.text;
        box.innerHTML = `<textarea rows="3">${esc(text)}</textarea><button class="primary small" data-act="approve">Envoyer la correction</button>`;
        return;
      }
      refresh();
      loadContacts();
    } catch (err) {
      toast(err.message);
    }
  });
}

// ---------- Temps réel ----------
function listen() {
  const es = new EventSource("/api/events");
  es.onmessage = (e) => {
    const ev = JSON.parse(e.data);
    if (ev.type === "message" || ev.type === "contact") {
      clearTimeout(listen.t);
      listen.t = setTimeout(loadContacts, 300);
      if (ev.contact_id === currentId) openContactSoft(currentId);
      if (ev.contact_id === testContactId) loadTest();
    }
    if (ev.type === "thinking") {
      if (ev.contact_id === currentId) $("#thinking")?.classList.toggle("hidden", !ev.on);
      if (ev.contact_id === testContactId) $("#test-thinking").classList.toggle("hidden", !ev.on);
    }
    if (ev.type === "channel" && !$("#tab-channels").classList.contains("hidden")) loadChannels();
  };
}
// Rafraîchit la discussion ouverte sans perdre ce qui est en cours de frappe.
async function openContactSoft(id) {
  const typing = $("#manual")?.value;
  const editing = $("#bubbles textarea");
  if (editing) return;
  await openContact(id);
  if (typing) $("#manual").value = typing;
}

// ---------- Bac à sable ----------
async function loadTest() {
  if (!testContactId) return;
  const { messages } = await api(`/api/contacts/${testContactId}`);
  $("#test-thread").innerHTML = messages.map((m) => bubble(m, { actions: false })).join("");
  $("#test-thread").scrollTop = $("#test-thread").scrollHeight;
}
$("#test-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("#test-input").value.trim();
  if (!text) return;
  $("#test-input").value = "";
  try {
    const r = await api("/api/test/message", { method: "POST", body: { name: $("#test-name").value, text } });
    testContactId = r.contact.id;
    loadTest();
  } catch (err) {
    toast(err.message);
  }
});
$("#test-name").addEventListener("change", () => {
  testContactId = null;
  $("#test-thread").innerHTML = "";
});
$("#test-reset").addEventListener("click", async () => {
  if (testContactId) await api(`/api/contacts/${testContactId}`, { method: "DELETE" });
  testContactId = null;
  $("#test-thread").innerHTML = "";
});

// ---------- Apprentissage ----------
async function loadLearn() {
  const stats = await api("/api/learn/stats");
  const labels = { export: "conversations importées", "whatsapp-history": "historique WhatsApp synchronisé", live: "tes réponses en direct", correction: "tes corrections de brouillons" };
  const total = stats.reduce((a, s) => a + s.n, 0);
  $("#learn-stats").innerHTML = total
    ? `<b>${total}</b> exemples d'échanges réels :<br>` + stats.map((s) => `• ${s.n} — ${labels[s.source] || s.source}`).join("<br>") +
      ` <button class="ghost small" id="clear-ex">tout effacer</button>`
    : "Aucun exemple pour l'instant.";
  $("#clear-ex")?.addEventListener("click", async () => {
    if (!confirm("Effacer tous les exemples appris ?")) return;
    await api("/api/learn/examples", { method: "DELETE" });
    loadLearn();
  });
  $("#style-profile").value = settings.style_profile || "";
}

$("#learn-files").addEventListener("change", async () => {
  const files = $("#learn-files").files;
  if (!files.length) return;
  const fd = new FormData();
  for (const f of files) fd.append("files", f);
  try {
    const p = await api("/api/learn/preview", { method: "POST", body: fd });
    if (!p.messages) {
      $("#learn-preview").innerHTML = '<p class="error">Aucun message reconnu dans ce fichier.</p>';
      return;
    }
    $("#learn-preview").innerHTML = `<p>${p.messages} messages trouvés. <b>Lequel de ces noms est le tien ?</b></p>
      <div class="btns">${p.participants
        .slice(0, 12)
        .map((x) => `<button class="pick" data-name="${esc(x.name)}">${esc(x.name)} (${x.count})</button>`)
        .join("")}</div>`;
    $$("#learn-preview .pick").forEach((b) =>
      b.addEventListener("click", async () => {
        const fd2 = new FormData();
        for (const f of files) fd2.append("files", f);
        fd2.append("owner", b.dataset.name);
        const r = await api("/api/learn/import", { method: "POST", body: fd2 });
        $("#learn-preview").innerHTML = `<p>✅ ${r.pairs} échanges analysés, ${r.added} nouveaux exemples ajoutés.</p>`;
        $("#learn-files").value = "";
        settings = await api("/api/settings");
        loadLearn();
      }),
    );
  } catch (err) {
    toast(err.message);
  }
});

$("#learn-profile").addEventListener("click", async () => {
  const btn = $("#learn-profile");
  btn.disabled = true;
  btn.textContent = "Analyse en cours (1 à 2 minutes)…";
  try {
    const r = await api("/api/learn/profile", { method: "POST" });
    $("#style-profile").value = r.style_profile;
    settings.style_profile = r.style_profile;
    $("#learn-facts").innerHTML = r.business_facts.length
      ? `<h2>Infos repérées dans tes conversations</h2><p class="muted">Ajoute celles qui sont justes à tes fiches de connaissances.</p>` +
        r.business_facts
          .map((f, i) => `<div class="kn"><b>${esc(f.title)}</b><div>${esc(f.content)}</div><div class="btns"><button class="small add-fact" data-i="${i}">Ajouter aux fiches</button></div></div>`)
          .join("")
      : "";
    $$(".add-fact").forEach((b) =>
      b.addEventListener("click", async () => {
        await api("/api/knowledge", { method: "POST", body: r.business_facts[b.dataset.i] });
        b.textContent = "Ajouté ✓";
        b.disabled = true;
      }),
    );
    toast("Profil généré et enregistré");
  } catch (err) {
    toast(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Analyser ma façon d'écrire";
  }
});
$("#save-profile").addEventListener("click", () => saveSettings({ style_profile: $("#style-profile").value }));

// ---------- Activité & connaissances ----------
async function loadKnowledge() {
  for (const k of ["owner_name", "business_description", "extra_rules"]) $(`#${k}`).value = settings[k] || "";
  const items = await api("/api/knowledge");
  $("#knowledge").innerHTML = items.map((k) => knowledgeCard(k)).join("") || '<p class="muted">Aucune fiche.</p>';
  bindKnowledge();
}
function knowledgeCard(k = {}) {
  return `<div class="kn" data-id="${k.id || ""}">
    <input class="kn-title" placeholder="Titre (ex : Tarifs)" value="${esc(k.title)}" />
    <textarea class="kn-content" rows="4" placeholder="Ex : Chanson simple 25 000 FCFA, avec clip 40 000 FCFA. Livraison sous 3 jours.">${esc(k.content)}</textarea>
    <div class="btns"><button class="small primary kn-save">Enregistrer</button><button class="small danger kn-del">Supprimer</button></div></div>`;
}
function bindKnowledge() {
  $$("#knowledge .kn").forEach((el) => {
    el.querySelector(".kn-save").onclick = async () => {
      const r = await api("/api/knowledge", {
        method: "POST",
        body: { id: Number(el.dataset.id) || undefined, title: el.querySelector(".kn-title").value, content: el.querySelector(".kn-content").value },
      });
      el.dataset.id = r.id;
      toast("Fiche enregistrée");
    };
    el.querySelector(".kn-del").onclick = async () => {
      if (el.dataset.id) await api(`/api/knowledge/${el.dataset.id}`, { method: "DELETE" });
      el.remove();
    };
  });
}
$("#add-knowledge").addEventListener("click", () => {
  $("#knowledge .muted")?.remove();
  $("#knowledge").insertAdjacentHTML("beforeend", knowledgeCard());
  bindKnowledge();
});
$("#save-business").addEventListener("click", () =>
  saveSettings({ owner_name: $("#owner_name").value, business_description: $("#business_description").value, extra_rules: $("#extra_rules").value }),
);

// ---------- Canaux ----------
async function loadChannels() {
  const ch = await api("/api/channels");
  const wa = ch.whatsapp;
  $("#wa-status").innerHTML = `<span class="status ${wa.status === "connecté" ? "ok" : ""}">${esc(wa.status)}</span> ${wa.me ? `<span class="muted">+${esc(wa.me)}</span>` : ""}
    ${wa.learned ? `<p class="muted">${wa.learned} exemples appris depuis ton historique.</p>` : ""}${wa.error ? `<p class="error">${esc(wa.error)}</p>` : ""}`;
  $("#wa-qr").classList.toggle("hidden", !wa.qr);
  if (wa.qr) $("#wa-qr").src = wa.qr;
  $("#wa-code").classList.toggle("hidden", !wa.pairingCode);
  $("#wa-code").textContent = wa.pairingCode || "";
  const tg = ch.telegram;
  $("#tg-status").innerHTML = `<span class="status ${tg.status === "connecté" ? "ok" : ""}">${esc(tg.status)}</span> ${esc(tg.bot || "")} ${tg.error ? `<p class="error">${esc(tg.error)}</p>` : ""}`;
  const m = ch.meta;
  $("#meta-status").innerHTML = `<span class="status ${m.facebook === "configuré" ? "ok" : ""}">Facebook : ${m.facebook}</span>
    <span class="status ${m.whatsapp_cloud === "configuré" ? "ok" : ""}">WA Business : ${m.whatsapp_cloud}</span>
    <p class="muted">Adresse du webhook à donner à Meta : <code>${esc(m.webhook_url)}</code></p>
    ${m.last_event ? `<p class="muted">Dernier événement reçu : ${new Date(m.last_event).toLocaleString("fr-FR")}</p>` : ""}${m.error ? `<p class="error">${esc(m.error)}</p>` : ""}`;
  $("#modes").innerHTML = Object.entries(CHANNELS)
    .filter(([k]) => k !== "test")
    .map(
      ([k, label]) => `<div class="mode-row"><span>${label}</span><select data-channel="${k}">
        ${["draft", "auto", "off"].map((v) => `<option value="${v}" ${(settings.channel_modes?.[k] || settings.reply_mode) === v ? "selected" : ""}>${{ draft: "Brouillon", auto: "Auto", off: "Off" }[v]}</option>`).join("")}
      </select></div>`,
    )
    .join("");
  $$("#modes select").forEach((s) =>
    s.addEventListener("change", () => saveSettings({ channel_modes: { ...(settings.channel_modes || {}), [s.dataset.channel]: s.value } })),
  );
}
$("#wa-start").addEventListener("click", () => api("/api/channels/whatsapp/start", { method: "POST" }).then(loadChannels).catch((e) => toast(e.message)));
$("#wa-pair").addEventListener("click", () => {
  const phone = $("#wa-phone").value.replace(/\D/g, "");
  if (phone.length < 8) return toast("Entre ton numéro complet avec l'indicatif du pays");
  api("/api/channels/whatsapp/start", { method: "POST", body: { phone } })
    .then(() => toast("Patiente quelques secondes, le code va s'afficher…"))
    .then(loadChannels)
    .catch((e) => toast(e.message));
});
$("#wa-stop").addEventListener("click", () => api("/api/channels/whatsapp/stop", { method: "POST", body: {} }).then(loadChannels));
$("#wa-logout").addEventListener("click", () => {
  if (confirm("Déconnecter l'agent de ton WhatsApp ?")) api("/api/channels/whatsapp/stop", { method: "POST", body: { logout: true } }).then(loadChannels);
});
$("#whatsapp_learning_only").addEventListener("change", (e) => saveSettings({ whatsapp_learning_only: e.target.checked }));

// ---------- Réglages ----------
function fillSettings() {
  $$("input[id], textarea[id], select[id]").forEach((el) => {
    if (!(el.id in settings)) return;
    if (el.type === "checkbox") el.checked = !!settings[el.id];
    else el.value = settings[el.id] ?? "";
  });
  if (settings.env?.anthropic_api_key && !settings.anthropic_api_key) $("#anthropic_api_key").placeholder = "Déjà fournie par le serveur (.env)";
}
async function saveSettings(patch) {
  try {
    await api("/api/settings", { method: "PUT", body: patch });
    settings = await api("/api/settings");
    toast("Enregistré ✓");
  } catch (err) {
    toast(err.message);
  }
}
$$(".save-settings").forEach((b) =>
  b.addEventListener("click", async () => {
    const patch = {};
    for (const k of b.dataset.keys.split(",")) {
      const el = $(`#${k}`);
      patch[k] = el.type === "checkbox" ? el.checked : el.type === "number" ? Number(el.value) : el.value;
    }
    await saveSettings(patch);
    fillSettings();
    if (!$("#tab-channels").classList.contains("hidden")) loadChannels();
  }),
);

// ---------- Démarrage ----------
async function start() {
  try {
    settings = await api("/api/settings");
  } catch {
    return;
  }
  $("#login").classList.add("hidden");
  $("#app").classList.remove("hidden");
  fillSettings();
  bindDraftActions($("#test-thread"), loadTest);
  await loadContacts();
  listen();
}
start();
