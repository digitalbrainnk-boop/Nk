// Vue « Lignes » : état de chaque compte, QR code / code d'appairage, actions.
import { STATUS_LABELS, esc, formatPhone, icons } from "../ui.js";

const BUSY = new Set(["connecting", "reconnecting", "qr", "pairing"]);

function actionButton(action, label, icon, variant = "btn-ghost") {
  return `<button type="button" class="btn ${variant}" data-action="${action}">${icon}<span>${esc(label)}</span></button>`;
}

function connectionBlock(s) {
  if (s.status === "qr" && s.qr) {
    return `<div class="pair-block">
      <img class="qr" src="${esc(s.qr)}" alt="QR code de connexion pour ${esc(s.label)}" width="240" height="240">
      <ol class="steps">
        <li>Sur le téléphone de <b>cette ligne</b>, ouvre WhatsApp Business.</li>
        <li>Menu ⋮ (ou Réglages) → <b>Appareils connectés</b> → <b>Connecter un appareil</b>.</li>
        <li>Scanne ce QR code (il change toutes les 20 secondes).</li>
      </ol>
      <p class="hint">Impossible de scanner (l'app est ouverte sur ce même téléphone) ? Annule puis utilise « Connecter par code ».</p>
    </div>`;
  }
  if (s.status === "pairing" && s.pairingCode) {
    return `<div class="pair-block">
      <p class="pair-code" aria-label="Code d'appairage">${esc(s.pairingCode)}</p>
      <ol class="steps">
        <li>Sur le téléphone de <b>cette ligne</b>, ouvre WhatsApp Business.</li>
        <li><b>Appareils connectés</b> → <b>Connecter un appareil</b> → « <b>Associer avec le numéro de téléphone</b> ».</li>
        <li>Saisis ce code (ou touche la notification WhatsApp reçue).</li>
      </ol>
      <p class="hint">Le code expire au bout de 2 à 3 minutes.</p>
    </div>`;
  }
  return "";
}

function infoLine(s) {
  if (s.status === "reconnecting" && s.nextRetryAt) {
    const sec = Math.max(0, Math.round((s.nextRetryAt - Date.now()) / 1000));
    return `<p class="line-info">Nouvel essai dans ${sec} s${s.lastError ? ` — ${esc(s.lastError)}` : ""}</p>`;
  }
  if (s.lastError && s.status !== "open") return `<p class="line-error">${esc(s.lastError)}</p>`;
  return "";
}

function actions(s) {
  const list = [];
  if (s.status === "open") {
    list.push(actionButton("open-messages", "Messages", icons.chat, "btn-line"));
    list.push(actionButton("pause", "Pause", icons.pause));
    list.push(actionButton("logout", "Délier", icons.unlink));
  } else if (BUSY.has(s.status)) {
    list.push(actionButton("pause", "Annuler", icons.pause));
  } else if (s.linked) {
    list.push(actionButton("connect-qr", "Reconnecter", icons.play, "btn-line"));
    list.push(actionButton("logout", "Délier", icons.unlink));
  } else {
    list.push(actionButton("connect-qr", "Connecter par QR", icons.qr, "btn-line"));
    list.push(actionButton("connect-code", "Connecter par code", icons.key));
  }
  list.push(actionButton("rename", "Renommer", icons.edit));
  list.push(actionButton("delete", "Supprimer", icons.trash, "btn-ghost btn-ghost-danger"));
  return list.join("");
}

function card(s, activeId) {
  const who = [formatPhone(s.phone), s.name].filter(Boolean).join(" · ") || (s.linked ? "Numéro relié" : "Aucun numéro relié");
  return `<article class="line-card ${s.id === activeId ? "is-active" : ""}" data-id="${esc(s.id)}" style="--line:${esc(s.color)}">
    <header class="line-card-head">
      <span class="line-swatch" aria-hidden="true"></span>
      <div class="line-card-title">
        <h3>${esc(s.label)}</h3>
        <p>${esc(who)}</p>
      </div>
      <span class="status-badge" data-status="${esc(s.status)}">${esc(STATUS_LABELS[s.status] ?? s.status)}</span>
    </header>
    ${infoLine(s)}
    ${connectionBlock(s)}
    <div class="line-actions">${actions(s)}</div>
  </article>`;
}

export function renderLines(root, { sessions, activeId }) {
  if (!sessions.length) {
    root.innerHTML = `<div class="empty-state"><h3>Aucune ligne pour l'instant</h3><p>Ajoute ta première ligne ci-dessous, puis relie-la au téléphone du compte WhatsApp Business.</p></div>`;
    return;
  }
  root.innerHTML = sessions.map((s) => card(s, activeId)).join("");
}
