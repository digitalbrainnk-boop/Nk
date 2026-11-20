import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pino from "pino";
import { loadConfig } from "../src/config.js";

export const silentLogger = pino({ level: "silent" });

export function tempConfig(overrides = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wa-multi-test-"));
  return loadConfig({}, { dataDir, apiToken: "test-token-0123456789", port: 0, ...overrides });
}

/** Message brut au format Baileys. */
export function rawMessage({ jid = "33611111111@s.whatsapp.net", id, text, fromMe = false, ts = Date.now(), pushName = "Alice", alt } = {}) {
  return {
    key: { remoteJid: jid, id, fromMe, ...(alt ? { remoteJidAlt: alt } : {}) },
    message: { conversation: text },
    messageTimestamp: Math.floor(ts / 1000),
    pushName: fromMe ? undefined : pushName,
  };
}
