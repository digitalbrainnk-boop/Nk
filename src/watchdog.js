// Surveillance automatique (toutes les minutes) et bilan de la journée.
// Elle relit l'état des conversations et des commandes, relance ce qui est
// resté bloqué (réponse non envoyée, texte promis, composition ratée, chanson
// pas livrée) et te prévient sur ton WhatsApp quand elle n'arrive pas à régler
// le problème toute seule.
import {
  activeOrder,
  db,
  isIgnored,
  getContact,
  getSettings,
  listIncidents,
  markIncidentNotified,
  reportIncident,
  resolveIncidentsExcept,
  saveOrder,
  setSettings,
  updateContact,
} from "./db.js";
import {
  channelMode,
  isBusy,
  messageOwner,
  proposeLyrics,
  schedule,
  sendSong,
  startComposition,
} from "./router.js";
import { emit } from "./events.js";

const MIN = 60_000;
const who = (c) => {
  if (!c) return "client inconnu";
  const phone = c.meta?.phone ? ` +${c.meta.phone}` : "";
  return `${c.name || c.external_id}${phone} (${c.channel})`;
};

// Le texte d'un message de l'agent qui promet le texte de la chanson dans X minutes.
const PROMISE = /(texte|paroles)/i;
const PROMISE_TIME = /(\d+\s*(min|minutes)|quelques minutes|tout de suite|dans un instant)/i;

/** Un tour de vérification. Renvoie la liste des problèmes vus. */
export async function runWatchdog(now = Date.now()) {
  const s = getSettings();
  if (!s.watchdog_enabled) return [];
  const seen = new Set();
  const found = [];
  const flag = async ({ key, contactId, kind, text, fix, notifyAfter = 3, fixedMsg }) => {
    seen.add(key);
    const inc = reportIncident({ key, contactId, kind, text });
    found.push(inc);
    // On réessaie aux premiers tours, puis de temps en temps.
    if (fix && (inc.attempts <= Math.max(notifyAfter, 5) || inc.attempts % 5 === 0)) {
      try {
        await fix();
        if (fixedMsg) await messageOwner(`🔧 Corrigé automatiquement — ${who(getContact(contactId))} : ${fixedMsg}`).catch(() => {});
      } catch (e) {
        console.error(`Surveillance (${kind}) :`, e.message);
        reportIncident({ key, contactId, kind, text: `${text} — ${e.message}` });
      }
    }
    if (!inc.notified && inc.attempts >= notifyAfter) {
      await tell(inc, `⚠️ Problème détecté — ${who(getContact(contactId))}\n${inc.text}${fix ? "\n(J'ai réessayé plusieurs fois sans succès : jette un œil à la conversation.)" : ""}`);
    }
  };

  const testIds = new Set(db.prepare("SELECT id FROM contacts WHERE channel = 'test'").all().map((r) => r.id));
  const skip = (c) => !c || testIds.has(c.id) || isIgnored(c) || channelMode(c.channel) === "off";

  // 1. Messages de clients restés sans réponse (erreur du cerveau, coupure…).
  const grace = ((Number(s.debounce_seconds) || 0) + (Number(s.max_reply_delay_seconds) || 0)) * 1000 + 2 * MIN;
  const pending = db
    .prepare(
      `SELECT contact_id, MIN(created_at) AS first FROM messages
       WHERE author = 'client' AND answered = 0 AND created_at > ? GROUP BY contact_id`,
    )
    .all(now - 12 * 60 * MIN);
  for (const p of pending) {
    const c = getContact(p.contact_id);
    if (skip(c) || c.paused_until > now || isBusy(c.id) || now - p.first < grace) continue;
    const err = String(c.needs_human_reason || "").startsWith("Erreur") ? ` (${c.needs_human_reason})` : "";
    await flag({
      key: `unanswered:${c.id}`,
      contactId: c.id,
      kind: "reponse",
      text: `Message du client sans réponse depuis ${Math.round((now - p.first) / MIN)} min${err}.`,
      fix: async () => schedule(c.id, 0),
    });
  }

  const orders = db
    .prepare("SELECT * FROM orders WHERE stage NOT IN ('livree', 'annulee') AND special = '' AND updated_at > ?")
    .all(now - 7 * 24 * 60 * MIN);
  for (const o of orders) {
    const c = getContact(o.contact_id);
    if (skip(c)) continue;
    let opts = {};
    try {
      opts = JSON.parse(o.lyrics_notes || "{}");
    } catch {}

    // 2. Le texte n'arrive pas à s'écrire (le tour des textes réessaie chaque minute).
    if (o.lyrics_status === "writing" && opts.error) {
      await flag({ key: `lyrics:${o.id}`, contactId: c.id, kind: "texte", text: `Le texte de la chanson n'arrive pas à s'écrire : ${opts.error}` });
    }

    // 3. Paiement vérifié mais chanson pas composée (Suno a échoué, coupure…).
    const paid = o.paid > 0 || !s.compose_requires_payment;
    if (o.lyrics && o.lyrics_status === "validated" && paid) {
      await flag({
        key: `compose:${o.id}`,
        contactId: c.id,
        kind: "composition",
        text: "Le paiement est vérifié mais la chanson n'est pas composée.",
        notifyAfter: 2,
        fix: async () => {
          if (String(c.needs_human_reason || "").startsWith("La composition a échoué")) updateContact(c.id, { needs_human: 0, needs_human_reason: null });
          await startComposition(c.id);
        },
      });
    }

    // 4. Composition bloquée (l'agent a redémarré pendant que Suno travaillait).
    if (o.lyrics_status === "composing" && now - o.updated_at > 25 * MIN) {
      await flag({
        key: `stuck:${o.id}`,
        contactId: c.id,
        kind: "composition",
        text: "La composition est bloquée depuis plus de 25 minutes.",
        notifyAfter: 3,
        fix: async () => {
          db.prepare("UPDATE messages SET status = 'rejected', text = '❌ Composition interrompue (relancée automatiquement)' WHERE contact_id = ? AND status = 'generating'").run(c.id);
          saveOrder({ id: o.id, lyrics_status: "validated" }); // le point 3 la relance au prochain tour
        },
        fixedMsg: "la composition était bloquée, je la relance.",
      });
    }

    // 5. Chanson composée mais pas livrée alors que l'envoi automatique est activé.
    if (o.lyrics_status === "composed" && s.song_auto_send && o.stage === "creation" && now - o.updated_at > 3 * MIN) {
      const song = db
        .prepare(
          `SELECT * FROM messages WHERE contact_id = ? AND author = 'agent' AND kind = 'audio' AND status = 'draft'
           AND media_path IS NOT NULL AND text NOT LIKE '%Démo%' AND created_at > ? ORDER BY id LIMIT 1`,
        )
        .get(c.id, o.updated_at - 30 * MIN);
      if (song) {
        await flag({
          key: `deliver:${o.id}`,
          contactId: c.id,
          kind: "livraison",
          text: "La chanson est prête mais n'a pas pu être envoyée au client.",
          notifyAfter: 2,
          fix: async () => sendSong(getContact(c.id), song),
        });
      }
    }

    // 6. Paiement annoncé : rappel si tu n'as pas encore vérifié.
    if (o.lyrics_status === "payment_claimed" && now - o.updated_at > 30 * MIN) {
      await flag({
        key: `payment:${o.id}`,
        contactId: c.id,
        kind: "paiement",
        text: `Ce client attend depuis ${Math.round((now - o.updated_at) / MIN)} min que tu vérifies son paiement (réagis avec ${s.payment_confirm_emoji || "✅"} à mon message, ou bouton « Paiement vérifié »).`,
        notifyAfter: 1,
      });
    }

    // 7. L'agent a promis le texte « dans X minutes » mais ne l'a jamais écrit.
    if (s.song_flow && !o.lyrics && !o.lyrics_status) {
      const last = db
        .prepare("SELECT * FROM messages WHERE contact_id = ? AND author IN ('agent', 'owner') AND status = 'sent' ORDER BY id DESC LIMIT 1")
        .get(c.id);
      const age = last ? now - last.created_at : 0;
      if (last?.author === "agent" && PROMISE.test(last.text) && PROMISE_TIME.test(last.text) && age > 15 * MIN && age < 24 * 60 * MIN) {
        await flag({
          key: `promise:${o.id}`,
          contactId: c.id,
          kind: "texte",
          text: "L'agent a promis le texte de la chanson mais ne l'a pas écrit.",
          notifyAfter: 2,
          fix: async () => proposeLyrics(c.id),
          fixedMsg: "le texte promis n'était pas parti, je viens de l'écrire et de l'envoyer.",
        });
      }
    }
  }

  // Ce qui n'est plus vu est réglé : on te le dit si on t'avait prévenu.
  for (const i of resolveIncidentsExcept(seen)) {
    if (i.notified) await messageOwner(`✅ Réglé — ${who(getContact(i.contact_id))} : ${i.text}`).catch(() => {});
  }
  if (found.length) emit("incidents", { count: found.length });
  await maybeDailyReport(now);
  return found;
}

async function tell(inc, text) {
  const ok = await messageOwner(text).catch(() => null);
  if (ok) markIncidentNotified(inc.id);
}

// ---------- Bilan de la journée ----------

const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function dayStart(day) {
  const [y, m, d] = String(day).split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
}

/** Ce qui s'est passé dans la journée (heure du téléphone). */
export function dailyReport(day = dayKey(new Date())) {
  const s = getSettings();
  const from = dayStart(day);
  const to = from + 24 * 60 * MIN;
  const songs = (status) =>
    db
      .prepare(
        `SELECT m.contact_id, COUNT(*) AS n, MAX(m.text) AS title FROM messages m JOIN contacts c ON c.id = m.contact_id
         WHERE m.author = 'agent' AND m.kind = 'audio' AND m.media_path IS NOT NULL AND m.status = ?
           AND m.created_at >= ? AND m.created_at < ? AND c.channel != 'test'
         GROUP BY m.contact_id ORDER BY MIN(m.created_at)`,
      )
      .all(status, from, to)
      .map((r) => ({ contact: getContact(r.contact_id), versions: r.n, title: String(r.title || "").replace(/^🎵\s*/, ""), order: activeOrder(r.contact_id) || lastOrder(r.contact_id) }));
  const sent = songs("sent");
  const waiting = songs("draft").filter((w) => !sent.some((x) => x.contact.id === w.contact.id));
  const open = db
    .prepare(
      `SELECT o.* FROM orders o JOIN contacts c ON c.id = o.contact_id
       WHERE o.stage NOT IN ('livree', 'annulee') AND c.channel != 'test' AND o.updated_at > ?`,
    )
    .all(now() - 30 * 24 * 60 * MIN);
  const by = (st) => open.filter((o) => !o.special && o.lyrics_status === st).map((o) => getContact(o.contact_id));
  const special = open.filter((o) => o.special).map((o) => ({ contact: getContact(o.contact_id), what: o.special }));
  const incidents = listIncidents({ since: from }).filter((i) => i.updated_at < to);

  const money = (n) => `${Math.round(n).toLocaleString("fr-FR")} ${s.currency || "FCFA"}`;
  const names = (list) => list.map((c) => `  • ${who(c)}`).join("\n");
  const lines = [`📊 Bilan du ${day.split("-").reverse().join("/")}`, ""];
  lines.push(`🎵 Chansons composées et envoyées : ${sent.length}`);
  sent.forEach((x, i) =>
    lines.push(`  ${i + 1}. ${who(x.contact)} — « ${x.title} »${x.order?.price ? ` — ${money(x.order.price)}` : ""}${x.order?.paid ? " (payé)" : ""}`),
  );
  if (waiting.length) {
    lines.push("", `🎧 Composées, à écouter et envoyer par toi : ${waiting.length}`);
    waiting.forEach((x) => lines.push(`  • ${who(x.contact)} — « ${x.title} »`));
  }
  const pend = [
    ["✍️ Texte en cours d'écriture", by("writing")],
    ["📤 Texte envoyé, attend la réponse du client", by("proposed")],
    ["💳 Texte validé, attend le paiement", by("validated")],
    ["💰 Paiement à vérifier par toi", by("payment_claimed")],
    ["🎶 En composition", by("composing")],
  ].filter(([, l]) => l.length);
  if (pend.length) {
    lines.push("", "⏳ En cours :");
    for (const [label, l] of pend) lines.push(`${label} (${l.length}) :`, names(l));
  }
  if (special.length) {
    lines.push("", `🎬 À faire par toi (vidéo lyrics, montage…) : ${special.length}`);
    special.forEach((x) => lines.push(`  • ${who(x.contact)} — ${x.what}`));
  }
  lines.push("", incidents.length ? `⚠️ Problèmes repérés aujourd'hui : ${incidents.length}` : "✅ Aucun problème repéré aujourd'hui.");
  incidents.forEach((i) => lines.push(`  • ${i.status === "resolved" ? "✅ réglé" : "❗ en cours"} — ${who(getContact(i.contact_id))} : ${i.text}`));
  return { day, sent, waiting, special, incidents, text: lines.join("\n") };
}

function lastOrder(contactId) {
  return db.prepare("SELECT * FROM orders WHERE contact_id = ? ORDER BY id DESC LIMIT 1").get(contactId);
}
const now = () => Date.now();

/** Envoie le bilan une fois par jour, à l'heure choisie. */
async function maybeDailyReport(at) {
  const s = getSettings();
  if (!s.daily_report_enabled) return;
  const d = new Date(at);
  const today = dayKey(d);
  if (s.last_report_day === today || d.getHours() < (Number(s.daily_report_hour) || 21)) return;
  const ok = await messageOwner(dailyReport(today).text).catch(() => null);
  if (ok) setSettings({ last_report_day: today });
}
