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
  let res;
  try {
    res = await fetch(path, init);
  } catch {
    // Le serveur ne répond plus : en général l'agent a été arrêté dans Termux.
    throw new Error("L'agent est arrêté : ouvre Termux et tape « agent » puis Entrée, puis réessaie.");
  }
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
    if (b.dataset.tab === "sales") loadSales();
    if (b.dataset.tab === "apps") loadApps();
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
        <span>${c.ignored ? '<span class="tag">🚫 ignoré</span>' : ""}${c.needs_human ? '<span class="tag alert">besoin de toi</span>' : ""}${c.drafts ? `<span class="tag draft">${c.drafts} à valider</span>` : ""}${c.last_at ? `<span class="tag">${time(c.last_at)}</span>` : ""}</span></div>
    </div>`,
      )
      .join("") || '<p class="muted" style="padding:14px">Aucune conversation pour l\'instant.</p>';
  $$("#contacts .contact").forEach((el) => el.addEventListener("click", () => openContact(Number(el.dataset.id))));
}
$("#search").addEventListener("input", renderContacts);

function bubble(m, { actions = true } = {}) {
  if (m.kind === "note") return `<div class="note">${esc(m.text)} · ${time(m.created_at)}</div>`;
  const cls = m.status === "draft" ? "draft" : m.status === "rejected" ? "rejected" : m.status === "generating" ? "draft" : m.author;
  let media = "";
  if (m.media_path && m.kind === "image") media = `<img src="/api/media/${m.id}" alt="photo" />`;
  if (m.media_path && (m.kind === "audio" || m.kind === "voice")) media = `<audio controls src="/api/media/${m.id}"></audio>`;
  const label = (m.kind === "audio" && m.author === "client") || m.kind === "voice" ? "🎤 " : m.kind === "comment" ? "💬 " : "";
  const isSong = m.kind === "audio" && m.author === "agent";
  const draftUi =
    m.status === "draft" && actions && isSong
      ? `<div class="draft-actions" data-id="${m.id}">
           <button class="primary small" data-act="approve">Envoyer au client</button>
           <button class="small danger" data-act="reject">Rejeter</button></div>`
      : m.status === "draft" && actions
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
        <span class="tag">${CHANNELS[c.channel] || c.channel}</span> <span class="muted">${esc(c.meta?.phone || "")}</span>
        ${c.credits_used ? `<span class="tag" title="Crédits Kie utilisés pour ce client (estimation)">≈ ${credits(c.credits_used)}</span>` : ""}</div>
      <div class="btns" style="margin:0">
        <span class="status ${paused || c.ignored ? "" : "ok"}">${c.ignored ? "🚫 L'agent ne répond jamais à ce contact" : paused ? (forever ? "Agent en pause" : `Tu as la main jusqu'à ${new Date(c.paused_until).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`) : "Agent actif"}</span>
        <button class="small" id="toggle-ignore">${c.ignored ? "✅ Répondre à nouveau à ce contact" : "🚫 Ne jamais répondre à ce contact"}</button>
        <button class="small" id="toggle-pause">${paused ? "Réactiver l'agent" : "Mettre l'agent en pause"}</button>
        <button class="small" id="regen">Proposer une réponse</button>
        <button class="small primary" id="song-open">🎵 Créer la chanson</button>
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
        <div id="song-panel" class="hidden">
          <h3>🎵 Chanson avec Suno</h3>
          <p class="muted">L'IA peut écrire les paroles à partir de la conversation. Relis, corrige, puis lance Suno. Tu écoutes avant d'envoyer.</p>
          <button class="small" id="song-brief">✍️ Écrire les paroles avec l'IA</button>
          <div class="row"><label>Titre</label><input id="song-title" /></div>
          <div class="row"><label>Style (en anglais, ex : afro pop, joyful, male vocals)</label><input id="song-style" /></div>
          <div class="row"><label>Paroles</label><textarea id="song-lyrics" rows="10"></textarea></div>
          <label class="check"><input type="checkbox" id="song-instr" /> Instrumental (sans paroles)</label>
          <button class="primary small" id="song-go">Lancer Suno</button>
          <hr />
        </div>
        <div id="order-box"></div>
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
  $("#toggle-ignore").onclick = async () => {
    await api(`/api/contacts/${id}/ignore`, { method: "POST", body: { ignore: !c.ignored } });
    toast(c.ignored ? "L'agent répondra de nouveau à ce contact" : "C'est noté : l'agent ne répondra plus jamais à ce contact");
    settings = await api("/api/settings");
    fillSettings();
    openContact(id);
    loadContacts();
  };
  $("#toggle-pause").onclick = async () => {
    await api(`/api/contacts/${id}`, { method: "PATCH", body: { paused: !paused } });
    openContact(id);
  };
  $("#song-open").onclick = () => {
    $("#song-panel").classList.toggle("hidden");
    $(".side").style.display = "block"; // aussi visible sur téléphone
  };
  $("#song-brief").onclick = async () => {
    const btn = $("#song-brief");
    btn.disabled = true;
    btn.textContent = "L'IA écrit…";
    try {
      const b = await api(`/api/contacts/${id}/song/brief`, { method: "POST" });
      $("#song-title").value = b.title;
      $("#song-style").value = b.style;
      $("#song-lyrics").value = b.lyrics;
    } catch (err) {
      toast(err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = "✍️ Écrire les paroles avec l'IA";
    }
  };
  $("#song-go").onclick = async () => {
    try {
      await api(`/api/contacts/${id}/song`, {
        method: "POST",
        body: { title: $("#song-title").value, style: $("#song-style").value, lyrics: $("#song-lyrics").value, instrumental: $("#song-instr").checked },
      });
      toast("Suno crée la chanson… elle apparaîtra dans la conversation.");
    } catch (err) {
      toast(err.message);
    }
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
  loadOrderBox(id);
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

// ---------- Commande du client ----------
const STAGES = {
  nouveau: "Nouvelle demande",
  devis: "Devis envoyé",
  acompte: "Acompte payé",
  creation: "Chanson en création",
  livree: "Livrée",
  annulee: "Annulée",
};
const credits = (n) => `${(Math.round(Number(n || 0) * 10) / 10).toLocaleString("fr-FR")} crédits`;
const money = (n) => `${Math.round(Number(n) || 0).toLocaleString("fr-FR")} ${settings.currency || "FCFA"}`;

async function loadOrderBox(contactId) {
  const box = $("#order-box");
  if (!box) return;
  const orders = await api(`/api/orders?contact=${contactId}`);
  const o = orders.find((x) => !["livree", "annulee"].includes(x.stage)) || orders[0];
  const field = (k, label, type = "text") =>
    `<div class="row"><label>${label}</label><input data-k="${k}" type="${type}" value="${esc(o?.[k] ?? "")}" /></div>`;
  box.innerHTML = `<h3>📦 Commande</h3>
    ${o ? "" : '<p class="muted">Aucune commande. Elle se crée toute seule quand le client demande une chanson.</p>'}
    <div class="row"><label>Étape</label><select data-k="stage">${Object.entries(STAGES)
      .map(([k, v]) => `<option value="${k}" ${(o?.stage || "nouveau") === k ? "selected" : ""}>${v}</option>`)
      .join("")}</select></div>
    ${field("title", "Chanson")}${field("occasion", "Occasion")}
    <div class="pair">${field("price", `Prix (${esc(settings.currency || "FCFA")})`, "number")}${field("paid", "Déjà payé", "number")}</div>
    ${field("due_date", "Pour quand")}${field("notes", "Notes")}
    <div class="btns"><button class="small primary" id="order-save">${o ? "Enregistrer" : "Créer la commande"}</button>
    ${orders.length > 1 ? `<span class="muted">${orders.length} commandes au total</span>` : ""}</div>
    <p class="muted">Seul toi peux marquer un paiement : l'agent ne le fait jamais.</p><hr />`;
  $("#order-save").onclick = async () => {
    const body = { id: o?.id, contact_id: contactId };
    for (const el of $$("#order-box [data-k]")) body[el.dataset.k] = el.type === "number" ? Number(el.value) || 0 : el.value;
    try {
      await api("/api/orders", { method: "POST", body });
      toast("Commande enregistrée");
      loadOrderBox(contactId);
    } catch (err) {
      toast(err.message);
    }
  };
}

// ---------- Ventes ----------
let salesFilter = "open";
async function loadSales() {
  const [st, orders, cr] = await Promise.all([api("/api/sales"), api("/api/orders"), api("/api/credits").catch(() => null)]);
  const tile = (label, value, sub = "", hero = false) =>
    `<div class="kpi ${hero ? "hero" : ""}"><div class="kpi-label">${label}</div><div class="kpi-value">${value}</div>${sub ? `<div class="kpi-sub">${sub}</div>` : ""}</div>`;
  $("#kpis").innerHTML =
    tile("Encaissé ce mois", money(st.paid_month), `Total : ${money(st.paid_total)}`, true) +
    tile("Reste à encaisser", money(st.due_total), "sur les commandes en cours") +
    tile("Commandes en cours", st.open_orders, `${st.by_stage.devis} devis · ${st.by_stage.acompte + st.by_stage.creation} payées`) +
    tile("Livrées ce mois", st.delivered_month, `${st.songs_made} chansons créées au total`) +
    tile("Clients", st.clients, `+${st.new_clients_week} cette semaine · ${st.active_week} actifs`) +
    tile("Besoin de toi", st.needs_human, st.needs_human ? "voir Conversations" : "tout est géré ✓") +
    (cr
      ? tile(
          "Crédits Kie restants",
          cr.balance !== null ? credits(cr.balance) : "—",
          `Ce mois : ${credits(cr.month)} (≈ ${(cr.month * cr.usd_per_credit).toFixed(2)} $) · ≈ ${credits(cr.per_conversation)} par conversation · ≈ ${credits(cr.per_reply)} par réponse`,
        )
      : "");
  drawPaidChart(st.weeks);

  const groups = { open: "En cours", ...STAGES, all: "Toutes" };
  const counts = { open: st.open_orders, all: orders.length, ...st.by_stage };
  $("#stage-filter").innerHTML = Object.entries(groups)
    .filter(([k]) => !["nouveau", "devis", "acompte", "creation"].includes(k) || counts[k])
    .map(([k, v]) => `<button class="chip ${salesFilter === k ? "on" : ""}" data-f="${k}">${v} <b>${counts[k] ?? 0}</b></button>`)
    .join("");
  $$("#stage-filter .chip").forEach((b) => (b.onclick = () => ((salesFilter = b.dataset.f), loadSales())));
  const shown = orders.filter((o) =>
    salesFilter === "all" ? true : salesFilter === "open" ? !["livree", "annulee"].includes(o.stage) : o.stage === salesFilter,
  );
  $("#orders-table").innerHTML =
    `<thead><tr><th>Client</th><th>Chanson</th><th>Étape</th><th class="num">Prix</th><th class="num">Payé</th><th>Pour quand</th></tr></thead><tbody>` +
    (shown
      .map(
        (o) => `<tr data-contact="${o.contact_id}">
          <td>${esc(o.contact_name || o.external_id)} <span class="tag">${CHANNELS[o.channel] || o.channel}</span></td>
          <td>${esc(o.title || o.occasion || "—")}</td>
          <td><span class="stage stage-${o.stage}">${STAGES[o.stage]}</span></td>
          <td class="num">${o.price ? money(o.price) : "—"}</td>
          <td class="num">${o.paid ? money(o.paid) : "—"}</td>
          <td>${esc(o.due_date || "—")}</td></tr>`,
      )
      .join("") || `<tr><td colspan="6" class="muted">Aucune commande ici.</td></tr>`) +
    "</tbody>";
  $$("#orders-table tr[data-contact]").forEach(
    (tr) =>
      (tr.onclick = () => {
        $('.tabs button[data-tab="conversations"]').click();
        openContact(Number(tr.dataset.contact));
      }),
  );
}

// Colonnes simples en SVG : une seule série, valeur au survol.
function drawPaidChart(weeks) {
  const el = $("#chart-paid");
  const W = Math.max(280, el.clientWidth || 600);
  const H = 180;
  const pad = { l: 8, r: 8, t: 22, b: 26 };
  const max = Math.max(1, ...weeks.map((w) => w.paid));
  const band = (W - pad.l - pad.r) / weeks.length;
  const bw = Math.min(24, band * 0.6);
  const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const fmtDay = (t) => new Date(t).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
  const bars = weeks
    .map((w, i) => {
      const x = pad.l + band * i + (band - bw) / 2;
      const top = y(w.paid);
      const h = H - pad.b - top;
      const r = Math.min(4, h);
      const path = h > 0
        ? `M${x},${H - pad.b} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${H - pad.b} Z`
        : "";
      const isLast = i === weeks.length - 1;
      return `<g class="col" data-i="${i}">
        <rect class="hit" x="${pad.l + band * i}" y="${pad.t}" width="${band}" height="${H - pad.t - pad.b}" />
        ${path ? `<path class="bar" d="${path}" />` : ""}
        ${isLast && w.paid ? `<text class="val" x="${x + bw / 2}" y="${top - 6}" text-anchor="middle">${Math.round(w.paid).toLocaleString("fr-FR")}</text>` : ""}
        ${i % 2 === 1 || isLast ? `<text class="axis" x="${x + bw / 2}" y="${H - 8}" text-anchor="middle">${isLast ? "Cette sem." : fmtDay(w.start + 7 * 86400_000)}</text>` : ""}
      </g>`;
    })
    .join("");
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Montants encaissés par semaine">
    <line class="base" x1="${pad.l}" x2="${W - pad.r}" y1="${H - pad.b}" y2="${H - pad.b}" />${bars}</svg>
    <div class="tip hidden" id="chart-tip"></div>`;
  const tip = $("#chart-tip");
  $$("#chart-paid .col").forEach((g) => {
    g.addEventListener("mouseenter", () => {
      const w = weeks[g.dataset.i];
      tip.innerHTML = `<b>Semaine du ${fmtDay(w.start)}</b><br>Encaissé : ${money(w.paid)}<br>Livrées : ${w.delivered}`;
      tip.classList.remove("hidden");
      const box = g.getBoundingClientRect();
      const host = el.getBoundingClientRect();
      tip.style.left = `${Math.min(host.width - 170, Math.max(0, box.left - host.left + box.width / 2 - 85))}px`;
      tip.style.top = "0px";
    });
    g.addEventListener("mouseleave", () => tip.classList.add("hidden"));
  });
}
$("#run-followups").addEventListener("click", async () => {
  const r = await api("/api/followups/run", { method: "POST" });
  toast(r.sent ? `${r.sent} relance(s) envoyée(s) ou préparée(s)` : "Personne à relancer pour l'instant");
  loadSales();
});

// ---------- Applications connectées ----------
let apps = { webhooks: [], actions: [], events: {}, log: [] };
const HOOK_TEMPLATES = {
  sheets: { name: "Google Sheets (Make)", events: ["order.updated", "order.paid"] },
  zapier: { name: "Zapier", events: ["order.paid", "needs_human"] },
  other: { name: "Mon application", events: ["message.received"] },
};
const ACTION_TEMPLATES = {
  agenda: {
    name: "Disponibilités",
    description: "Vérifie si je suis disponible à une date (input = la date demandée par le client). Utilise-la avant de promettre une date de livraison.",
    method: "POST",
  },
  catalogue: {
    name: "Catalogue",
    description: "Renvoie mes offres, prix et exemples de chansons (input = ce que le client cherche).",
    method: "GET",
  },
  other: { name: "Mon action", description: "Explique ici à l'agent quand utiliser cette action et quoi lui donner.", method: "POST" },
};

async function loadApps() {
  apps = await api("/api/integrations");
  renderApps();
}

function renderApps() {
  $("#hooks").innerHTML =
    apps.webhooks
      .map(
        (h, i) => `<div class="kn" data-hook="${i}">
      <div class="pair"><input data-f="name" value="${esc(h.name)}" placeholder="Nom" />
        <label class="check" style="margin:0"><input type="checkbox" data-f="enabled" ${h.enabled !== false ? "checked" : ""} /> Actif</label></div>
      <input data-f="url" value="${esc(h.url)}" placeholder="https://hook.eu1.make.com/…" />
      <div class="chips">${Object.entries(apps.events)
        .map(([k, v]) => `<label class="chip"><input type="checkbox" data-ev="${k}" ${(h.events || []).includes(k) ? "checked" : ""} /> ${v}</label>`)
        .join("")}</div>
      ${h.secret ? `<p class="muted">Clé de signature (en-tête X-Agent-Signature) : <code>${esc(h.secret)}</code></p>` : ""}
      <div class="btns"><button class="small" data-act="test-hook">Tester</button><button class="small danger" data-act="del-hook">Supprimer</button></div>
    </div>`,
      )
      .join("") || '<p class="muted">Aucune application pour l\'instant.</p>';

  $("#actions").innerHTML =
    apps.actions
      .map((a, i) => {
        const [hk, hv] = Object.entries(a.headers || {})[0] || ["", ""];
        return `<div class="kn" data-action="${i}">
      <div class="pair"><input data-f="name" value="${esc(a.name)}" placeholder="Nom de l'action" />
        <label class="check" style="margin:0"><input type="checkbox" data-f="enabled" ${a.enabled !== false ? "checked" : ""} /> Active</label></div>
      <textarea data-f="description" rows="2" placeholder="Quand l'agent doit l'utiliser">${esc(a.description)}</textarea>
      <div class="pair"><select data-f="method" style="width:110px"><option ${a.method !== "GET" ? "selected" : ""}>POST</option><option ${a.method === "GET" ? "selected" : ""}>GET</option></select>
        <input data-f="url" value="${esc(a.url)}" placeholder="https://…" /></div>
      <div class="pair"><input data-f="hk" value="${esc(hk)}" placeholder="En-tête (facultatif, ex : Authorization)" />
        <input data-f="hv" value="${esc(hv)}" placeholder="Valeur (ex : Bearer ta-clé)" /></div>
      <div class="pair"><input data-f="test-input" placeholder="Essai : ce que l'agent enverrait" />
        <button class="small" data-act="test-action">Tester</button><button class="small danger" data-act="del-action">Supprimer</button></div>
      <div class="muted" data-out></div>
    </div>`;
      })
      .join("") || '<p class="muted">Aucune action pour l\'instant.</p>';

  $("#apps-log").innerHTML = apps.log.length
    ? apps.log
        .map(
          (l) => `${l.ok ? "✅" : "❌"} ${time(l.at)} — ${esc(l.kind === "action" ? "Action" : "Envoi")} « ${esc(l.name)} »${l.event ? ` (${esc(l.event)})` : ""}${l.status ? ` · ${l.status}` : ""}${l.error ? ` · ${esc(l.error)}` : ""}`,
        )
        .join("<br>")
    : "Rien pour l'instant.";
}

// Relit le formulaire dans `apps` avant d'enregistrer ou de redessiner.
function readApps() {
  $$("#hooks [data-hook]").forEach((el) => {
    const h = apps.webhooks[el.dataset.hook];
    h.name = el.querySelector('[data-f="name"]').value;
    h.url = el.querySelector('[data-f="url"]').value.trim();
    h.enabled = el.querySelector('[data-f="enabled"]').checked;
    h.events = $$("[data-ev]", el).filter((c) => c.checked).map((c) => c.dataset.ev);
  });
  $$("#actions [data-action]").forEach((el) => {
    const a = apps.actions[el.dataset.action];
    const f = (k) => el.querySelector(`[data-f="${k}"]`);
    a.name = f("name").value;
    a.description = f("description").value;
    a.method = f("method").value;
    a.url = f("url").value.trim();
    a.enabled = f("enabled").checked;
    a.headers = f("hk").value.trim() ? { [f("hk").value.trim()]: f("hv").value } : {};
  });
}
async function saveApps() {
  readApps();
  await api("/api/integrations", { method: "PUT", body: { webhooks: apps.webhooks, actions: apps.actions } });
  await loadApps();
  toast("Applications enregistrées ✓");
}
$("#apps-save").addEventListener("click", () => saveApps().catch((e) => toast(e.message)));
$$("[data-tpl-hook]").forEach((b) =>
  b.addEventListener("click", () => {
    readApps();
    apps.webhooks.push({ ...HOOK_TEMPLATES[b.dataset.tplHook], url: "", enabled: true });
    renderApps();
  }),
);
$$("[data-tpl-action]").forEach((b) =>
  b.addEventListener("click", () => {
    readApps();
    apps.actions.push({ ...ACTION_TEMPLATES[b.dataset.tplAction], url: "", headers: {}, enabled: true });
    renderApps();
  }),
);
$("#tab-apps").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  const hookEl = btn.closest("[data-hook]");
  const actEl = btn.closest("[data-action]");
  try {
    if (btn.dataset.act === "del-hook") {
      readApps();
      apps.webhooks.splice(hookEl.dataset.hook, 1);
      renderApps();
    } else if (btn.dataset.act === "del-action") {
      readApps();
      apps.actions.splice(actEl.dataset.action, 1);
      renderApps();
    } else if (btn.dataset.act === "test-hook") {
      const i = Number(hookEl.dataset.hook);
      await saveApps();
      const r = await api(`/api/integrations/webhooks/${apps.webhooks[i].id}/test`, { method: "POST" });
      toast(r.ok ? "✅ Ton application a bien reçu le test" : `❌ ${r.error || `Erreur ${r.status}`}`);
      loadApps();
    } else if (btn.dataset.act === "test-action") {
      const i = Number(actEl.dataset.action);
      const input = actEl.querySelector('[data-f="test-input"]').value;
      await saveApps();
      const r = await api(`/api/integrations/actions/${apps.actions[i].id}/test`, { method: "POST", body: { input } });
      const out = $(`#actions [data-action="${i}"] [data-out]`);
      out.innerHTML = `${r.ok ? "✅" : "❌"} Réponse : <code>${esc(r.result)}</code>`;
    }
  } catch (err) {
    toast(err.message);
  }
});

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
    if (ev.type === "error") toast(`⚠️ ${ev.message}`);
    if (ev.type === "order") {
      if (ev.contact_id === currentId && !$("#order-box :focus")) loadOrderBox(currentId);
      if (!$("#tab-sales").classList.contains("hidden")) loadSales();
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
  const song = $("#song-panel") && {
    open: !$("#song-panel").classList.contains("hidden"),
    title: $("#song-title").value,
    style: $("#song-style").value,
    lyrics: $("#song-lyrics").value,
    instr: $("#song-instr").checked,
  };
  await openContact(id);
  if (typing) $("#manual").value = typing;
  if (song) {
    $("#song-panel").classList.toggle("hidden", !song.open);
    if (song.open) $(".side").style.display = "block";
    $("#song-title").value = song.title;
    $("#song-style").value = song.style;
    $("#song-lyrics").value = song.lyrics;
    $("#song-instr").checked = song.instr;
  }
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
  const phone = $("#wa-phone").value.replace(/\D/g, "").replace(/^0+/, "");
  if (phone.length < 10 || phone.length > 15)
    return toast("Numéro incomplet : mets l'indicatif du pays au début (ex. 226… pour le Burkina, 225… pour la Côte d'Ivoire)");
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
function fillIgnored() {
  const el = $("#ignored_list");
  if (el && document.activeElement !== el) el.value = (settings.ignored_contacts || []).join("\n");
}
function fillSettings() {
  fillIgnored();
  $$("input[id], textarea[id], select[id]").forEach((el) => {
    if (!(el.id in settings)) return;
    if (el.type === "checkbox") el.checked = !!settings[el.id];
    else el.value = settings[el.id] ?? "";
  });
  if (settings.env?.anthropic_api_key && !settings.anthropic_api_key) $("#anthropic_api_key").placeholder = "Déjà fournie par le serveur (.env)";
  if (settings.env?.kie_api_key && !settings.kie_api_key) $("#kie_api_key").placeholder = "Déjà fournie au démarrage (.env) ✓";
  toggleBrain();
}
function toggleBrain() {
  const b = $("#brain").value;
  $("#brain-openai").classList.toggle("hidden", b !== "openai");
  $("#brain-claude").classList.toggle("hidden", b !== "claude");
  $("#brain-kie").classList.toggle("hidden", b !== "kie");
}
$("#brain").addEventListener("change", toggleBrain);
$("#llm-test").addEventListener("click", async () => {
  const out = $("#llm-test-result");
  // On enregistre d'abord ce qui est saisi pour tester la bonne configuration.
  const patch = {};
  for (const k of ["brain", "kie_api_key", "kie_chat_model", "suno_model", "llm_url", "llm_api_key", "llm_model", "anthropic_api_key", "model"]) patch[k] = $(`#${k}`).value;
  await saveSettings(patch);
  fillSettings();
  out.textContent = "Test en cours…";
  if (patch.brain === "claude") {
    out.textContent = "Pour Claude, le test se fait dans l'onglet Tester.";
    return;
  }
  const r = await api("/api/llm/test", { method: "POST" });
  out.innerHTML = r.ok
    ? `✅ Ça marche !${r.model ? ` (modèle : ${esc(r.model)})` : ""} Réponse : « ${esc(r.text)} »`
    : `<span class="error">❌ ${esc(r.error)}</span>`;
});

async function saveSettings(patch) {
  try {
    const r = await api("/api/settings", { method: "PUT", body: patch });
    settings = await api("/api/settings");
    toast(r.moved ? "Ce n'était pas une clé Claude : elle a été rangée comme clé Kie.ai et Kie est maintenant utilisé ✓" : "Enregistré ✓");
    if (r.moved) fillSettings();
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

// ---------- Numéros ignorés ----------
$("#ignored-save").addEventListener("click", async () => {
  const list = $("#ignored_list").value.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean);
  await saveSettings({ ignored_contacts: list });
  loadContacts();
});

// ---------- Clé Kie.ai ----------
function hasAiKey() {
  return !!(settings.kie_api_key || settings.anthropic_api_key || settings.llm_api_key || settings.env?.kie_api_key || settings.env?.anthropic_api_key);
}
function updateKeyBanner() {
  $("#key-banner").classList.toggle("hidden", hasAiKey());
}
// Enregistre la clé Kie, choisit Kie comme cerveau, puis teste la connexion.
async function saveKieKey(key, out) {
  key = key.trim();
  if (!key || key.startsWith("••••••")) return toast("Colle d'abord ta clé Kie.ai");
  out.textContent = "Enregistrement et recherche du bon modèle Kie… (jusqu’à 1 minute)";
  await api("/api/settings", { method: "PUT", body: { kie_api_key: key, brain: "kie" } });
  settings = await api("/api/settings");
  fillSettings();
  updateKeyBanner();
  const r = await api("/api/llm/test", { method: "POST" });
  out.innerHTML = r.ok
    ? `✅ Ta clé Kie marche ! Réponse de l'agent : « ${esc(r.text)} »`
    : `<span class="error">❌ ${esc(r.error)}</span>`;
  // Le bandeau disparaît une fois la clé enregistrée : on affiche aussi le résultat en notification.
  toast(r.ok ? "✅ Ta clé Kie marche ! Va dans « Tester » pour parler à ton agent." : `❌ ${r.error}`);
}
$("#kie-save").addEventListener("click", () => saveKieKey($("#kie_api_key").value, $("#llm-test-result")).catch((e) => toast(e.message)));
$("#banner-save").addEventListener("click", () => saveKieKey($("#banner-key").value, $("#banner-result")).catch((e) => toast(e.message)));

// ---------- Voix ----------
async function loadVoices() {
  try {
    const voices = await api("/api/tts/voices");
    $("#tts_voice").innerHTML = voices.map((v) => `<option value="${v}">${v}</option>`).join("");
    $("#tts_voice").value = settings.tts_voice || "Brian";
  } catch {}
}
$("#tts-preview").addEventListener("click", async () => {
  const btn = $("#tts-preview");
  await saveSettings({ tts_voice: $("#tts_voice").value });
  btn.disabled = true;
  btn.textContent = "Création de la voix…";
  try {
    const r = await api("/api/tts/preview", { method: "POST" });
    const a = $("#tts-audio");
    a.src = r.url;
    a.classList.remove("hidden");
    a.play().catch(() => {});
  } catch (err) {
    toast(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Écouter cette voix";
  }
});

// ---------- Démarrage ----------
async function start() {
  try {
    settings = await api("/api/settings");
  } catch {
    return;
  }
  $("#login").classList.add("hidden");
  $("#app").classList.remove("hidden");
  await loadVoices();
  fillSettings();
  updateKeyBanner();
  bindDraftActions($("#test-thread"), loadTest);
  await loadContacts();
  listen();
}
start();
