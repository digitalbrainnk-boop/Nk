// Notifications Android natives quand le serveur tourne dans Termux (application
// Termux:API). Elles ne passent ni par Chrome ni par Internet : c'est le téléphone
// lui-même qui les affiche, comme celles de WhatsApp, avec « Répondre » directement
// depuis la notification.
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ROOT_DIR } from "../config.js";
import { messagePreview } from "../push.js";

const MAX_LINES = 6; // derniers messages affichés dans une notification
const REALERT_AFTER_MS = 30_000; // une même discussion ne resonne pas plus souvent
// Délimiteur du texte de réponse : voir replyAction().
const REPLY_DELIMITER = "MULTI_LIGNES_FIN_DE_REPONSE";

/** Préfixe Termux (…/usr), ou null hors de Termux. */
export function termuxPrefix(env = process.env) {
  const prefix = env.PREFIX || "";
  return prefix.includes("com.termux") ? prefix : null;
}

/** Entoure une valeur de guillemets simples pour le shell (sans aucune interprétation). */
export const shellQuote = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;

/**
 * Ce que Termux:API fait du texte tapé dans « Répondre » : il remplace $REPLY par
 * "texte" en n'échappant que les guillemets (voir NotificationAPI.shellEscape).
 * Reproduit ici pour les tests.
 */
export const termuxReplySubstitution = (action, reply) => action.split("$REPLY").join(`"${reply.replace(/"/g, '\\"')}"`);

/** Lancement d'une commande avec délai maximal (les commandes termux-* bloquent si Termux:API manque). */
function runCommand(command, args, { timeoutMs = 10_000 } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      return resolve({ code: -1, stdout: "", stderr: err.message, timedOut: false });
    }
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ code: -1, stdout, stderr, timedOut: true });
    }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: err.message, timedOut: false });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut: false });
    });
  });
}

export class TermuxNotifier {
  /**
   * @param {object} opts
   * @param {string|null} opts.prefix préfixe Termux (null = pas dans Termux)
   * @param {() => number} opts.getPort port du serveur (pour « Ouvrir » et « Répondre »)
   * @param {Function} [opts.run] remplaçable dans les tests
   */
  constructor({ dataDir, prefix = termuxPrefix(), getPort, logger, run = runCommand, nodePath = process.execPath }) {
    this.prefix = prefix;
    this.getPort = getPort;
    this.log = logger.child({ module: "notifications" });
    this.run = run;
    this.nodePath = nodePath;
    this.actionScript = path.join(ROOT_DIR, "scripts", "notification-action.js");
    this.file = path.join(dataDir, "notifications.json");
    this.buffers = new Map(); // id de notification -> { lines, count, lastAlert }
    this.working = null; // null = pas encore vérifié, true/false ensuite
    this.lastError = null;
    this.lastCheck = 0;
    this.settings = { enabled: true, preview: true };
    try {
      this.settings = { ...this.settings, ...JSON.parse(fs.readFileSync(this.file, "utf8")) };
    } catch {
      // réglages par défaut
    }
  }

  bin(name) {
    return path.join(this.prefix, "bin", name);
  }

  /** La commande termux-notification est installée (paquet « termux-api »). */
  get installed() {
    return Boolean(this.prefix) && fs.existsSync(this.bin("termux-notification"));
  }

  /** Les notifications natives sont utilisées (sinon : notifications Chrome). */
  get active() {
    return this.installed && this.settings.enabled && this.working !== false;
  }

  get status() {
    return {
      termux: Boolean(this.prefix),
      installed: this.installed,
      working: this.working,
      enabled: this.settings.enabled,
      preview: this.settings.preview,
      lastError: this.lastError,
    };
  }

  updateSettings(patch) {
    for (const key of ["enabled", "preview"]) if (typeof patch?.[key] === "boolean") this.settings[key] = patch[key];
    fs.writeFileSync(this.file, JSON.stringify(this.settings, null, 2), { mode: 0o600 });
    return this.status;
  }

  /** Vérifie que l'application Termux:API répond (sinon les commandes restent bloquées). */
  async check({ force = false } = {}) {
    if (!this.installed) return false;
    if (!force && this.working !== null && Date.now() - this.lastCheck < 60_000) return this.working;
    this.lastCheck = Date.now();
    const result = await this.run(this.bin("termux-notification-list"), [], { timeoutMs: 8000 });
    this.setWorking(result);
    return this.working;
  }

  setWorking(result) {
    const ok = result.code === 0 && !result.timedOut;
    if (ok !== this.working) {
      if (ok) this.log.info("Notifications Android actives (Termux:API)");
      else this.log.warn("Termux:API ne répond pas : installe l'application Termux:API (F-Droid) et autorise ses notifications.");
    }
    this.working = ok;
    this.lastError = ok ? null : result.timedOut ? "Termux:API ne répond pas." : (result.stderr || "").trim().slice(0, 200) || `code ${result.code}`;
  }

  static idFor(sessionId, chatId) {
    return `ml-${crypto.createHash("sha1").update(`${sessionId}|${chatId}`).digest("hex").slice(0, 16)}`;
  }

  // --- Actions déclenchées depuis la notification -----------------------------------

  actionCommand(mode, sessionId, chatId) {
    return `${shellQuote(this.nodePath)} ${shellQuote(this.actionScript)} ${mode} ${shellQuote(sessionId)} ${shellQuote(chatId)}`;
  }

  openAction(sessionId, chatId) {
    const url = `http://localhost:${this.getPort()}/#open=${encodeURIComponent(sessionId)}|${encodeURIComponent(chatId)}`;
    return `${shellQuote(this.bin("termux-open-url"))} ${shellQuote(url)}`;
  }

  /**
   * « Répondre » : Termux:API colle le texte tapé à la place de $REPLY, entre
   * guillemets mais SANS neutraliser $, ` ou \. On le place donc dans un
   * « here-document » à délimiteur entre apostrophes : le shell le transmet tel
   * quel au script, sans rien interpréter ni exécuter.
   */
  replyAction(sessionId, chatId) {
    return `${this.actionCommand("reply", sessionId, chatId)} <<'${REPLY_DELIMITER}'\n$REPLY\n${REPLY_DELIMITER}`;
  }

  // --- Affichage --------------------------------------------------------------------

  async notifyMessage({ session, chat, message, imagePath }) {
    if (!this.installed || !this.settings.enabled) return false;
    if (this.working === null || (this.working === false && Date.now() - this.lastCheck > 60_000)) await this.check();
    if (!this.working) return false;

    const id = TermuxNotifier.idFor(session.id, chat.id);
    const buffer = this.buffers.get(id) ?? { lines: [], count: 0, lastAlert: 0 };
    const preview = messagePreview(message);
    buffer.lines = [...buffer.lines, chat.isGroup && message.authorName ? `${message.authorName} : ${preview}` : preview].slice(-MAX_LINES);
    buffer.count += 1;
    this.buffers.set(id, buffer);
    if (this.buffers.size > 500) this.buffers.delete(this.buffers.keys().next().value);

    const label = session.meta.label;
    const who = chat.name || (chat.phone ? `+${chat.phone}` : "Nouveau message");
    const show = this.settings.preview;
    const title = show ? `${who}${buffer.count > 1 ? ` (${buffer.count})` : ""} · ${label}` : `Multi-Lignes · ${label}`;
    const content = show ? buffer.lines.join("\n") : buffer.count > 1 ? `${buffer.count} nouveaux messages` : "Nouveau message";

    const args = [
      "--id", id,
      "--title", title,
      "--content", content,
      "--group", `multi-lignes-${session.id}`,
      "--priority", "high",
      "--icon", "chat",
      "--sound",
      "--vibrate", "0,250,120,250",
      "--action", this.openAction(session.id, chat.id),
      "--button1", "Répondre",
      "--button1-action", this.replyAction(session.id, chat.id),
      "--button2", "Marquer comme lu",
      "--button2-action", this.actionCommand("read", session.id, chat.id),
      "--on-delete", this.actionCommand("dismissed", session.id, chat.id),
    ];
    if (/^#[0-9a-f]{6}$/i.test(session.meta.color || "")) args.push("--led-color", session.meta.color.slice(1));
    // Plusieurs messages d'affilée : la notification se met à jour sans resonner.
    if (Date.now() - buffer.lastAlert < REALERT_AFTER_MS) args.push("--alert-once");
    else buffer.lastAlert = Date.now();
    if (show && imagePath) args.push("--image-path", imagePath);

    const result = await this.run(this.bin("termux-notification"), args);
    this.lastCheck = Date.now();
    this.setWorking(result);
    return this.working;
  }

  /** Retire la notification d'une discussion (lue dans l'app, ou réponse envoyée). */
  async remove(sessionId, chatId) {
    const id = TermuxNotifier.idFor(sessionId, chatId);
    const had = this.buffers.delete(id);
    if (!had || !this.installed || !this.working) return;
    await this.run(this.bin("termux-notification-remove"), [id], { timeoutMs: 8000 });
  }

  /** Notification fermée d'un geste : on repart de zéro pour cette discussion. */
  dismissed(sessionId, chatId) {
    this.buffers.delete(TermuxNotifier.idFor(sessionId, chatId));
  }

  async test() {
    if (!this.installed) return false;
    const result = await this.run(this.bin("termux-notification"), [
      "--id", "ml-test",
      "--title", "Multi-Lignes",
      "--content", "Les notifications fonctionnent ✅",
      "--priority", "high",
      "--icon", "chat",
      "--sound",
      "--vibrate", "0,200",
    ]);
    this.lastCheck = Date.now();
    this.setWorking(result);
    return this.working;
  }
}
