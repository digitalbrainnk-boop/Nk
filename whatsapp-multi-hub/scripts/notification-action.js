// Actions des notifications Android (lancées par Termux:API) :
//   node notification-action.js reply      <ligne> <discussion>   (texte sur l'entrée standard)
//   node notification-action.js read       <ligne> <discussion>
//   node notification-action.js dismissed  <ligne> <discussion>
// Le texte de réponse arrive sous la forme "…" produite par Termux:API (voir
// src/notify/termux.js) : il est décodé ici, jamais interprété par un shell.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { ROOT_DIR, loadConfig } from "../src/config.js";

dotenv.config({ path: path.join(ROOT_DIR, ".env"), quiet: true });

/** Inverse exact de NotificationAPI.shellEscape : retire les guillemets et le \ ajouté devant chaque ". */
export function decodeReply(raw) {
  let text = String(raw).replace(/\r?\n$/, "");
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) text = text.slice(1, -1);
  return text.replace(/\\"/g, '"');
}

function toast(message) {
  // termux-toast se trouve à côté de node (…/usr/bin) ; rien de grave s'il manque.
  const bin = path.join(path.dirname(process.execPath), "termux-toast");
  if (!fs.existsSync(bin)) return;
  spawn(bin, ["-s", message], { stdio: "ignore", detached: true }).unref();
}

async function main() {
  const [mode, sessionId, chatId] = process.argv.slice(2);
  if (!["reply", "read", "dismissed"].includes(mode) || !sessionId || !chatId) {
    console.error("Usage : notification-action.js reply|read|dismissed <ligne> <discussion>");
    process.exit(2);
  }
  const config = loadConfig();
  const host = process.env.ACTION_HOST || "127.0.0.1";
  const call = async (method, url, body) => {
    const res = await fetch(`http://${host}:${config.port}${url}`, {
      method,
      headers: { Authorization: `Bearer ${config.apiToken}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error?.message || `erreur ${res.status}`);
    return data;
  };
  const enc = encodeURIComponent;

  if (mode === "reply") {
    const text = decodeReply(fs.readFileSync(0, "utf8"));
    if (!text.trim()) return;
    try {
      await call("POST", `/api/sessions/${enc(sessionId)}/messages`, { to: chatId, text });
      await call("POST", `/api/sessions/${enc(sessionId)}/chats/${enc(chatId)}/read`, {}).catch(() => {});
      toast("Message envoyé ✓");
    } catch (err) {
      toast(`Message NON envoyé : ${err.message}`);
      process.exitCode = 1;
    }
  } else if (mode === "read") {
    await call("POST", `/api/sessions/${enc(sessionId)}/chats/${enc(chatId)}/read`, {}).catch((err) => toast(`Erreur : ${err.message}`));
  } else {
    await call("POST", "/api/notifications/dismissed", { sessionId, chatId }).catch(() => {});
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main().catch((err) => {
    toast(`Multi-Lignes : ${err.message}`);
    process.exit(1);
  });
}
