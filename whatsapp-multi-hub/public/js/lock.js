// Code de verrouillage de l'application.
// Le jeton d'accès est chiffré sur l'appareil (AES-GCM, clé dérivée du code par
// PBKDF2) : sans le code, il est illisible, même en fouillant le navigateur.
const VAULT_KEY = "multi-lignes:vault";
const ATTEMPTS_KEY = "multi-lignes:lock-attempts";
const ITERATIONS = 310000;
const MAX_ATTEMPTS = 10; // au-delà, le jeton est effacé de l'appareil

const enc = new TextEncoder();
const dec = new TextDecoder();
const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

let currentKey = null; // clé en mémoire tant que l'application est déverrouillée

function read(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "null");
  } catch {
    return null;
  }
}
function write(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // stockage indisponible
  }
}

async function deriveKey(pin, salt, iterations) {
  const base = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);
}

async function encryptWith(key, token, vault) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(token));
  write(VAULT_KEY, { ...vault, iv: toB64(iv), ct: toB64(ct) });
}

export const lockSupported = () => Boolean(window.isSecureContext && crypto?.subtle);
export const hasVault = () => Boolean(read(VAULT_KEY)?.ct);
export const pinLength = () => read(VAULT_KEY)?.len ?? 4;

/** Active le verrouillage : chiffre le jeton avec un nouveau code. */
export async function sealToken(pin, token) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  currentKey = await deriveKey(pin, salt, ITERATIONS);
  await encryptWith(currentKey, token, { v: 1, salt: toB64(salt), iterations: ITERATIONS, len: pin.length });
  write(ATTEMPTS_KEY, null);
}

/** Rechiffre un nouveau jeton (après un changement de jeton) sans redemander le code. */
export async function resealToken(token) {
  const vault = read(VAULT_KEY);
  if (!vault || !currentKey) throw new Error("Application verrouillée");
  await encryptWith(currentKey, token, vault);
}

/** Temps d'attente imposé après plusieurs codes faux (ms). */
export function lockoutRemaining() {
  const a = read(ATTEMPTS_KEY);
  return a?.until ? Math.max(0, a.until - Date.now()) : 0;
}

/**
 * Tente d'ouvrir avec un code.
 * @returns {Promise<{ token?: string, wiped?: boolean, left?: number }>}
 */
export async function openVault(pin) {
  const vault = read(VAULT_KEY);
  if (!vault) return { wiped: true };
  try {
    const key = await deriveKey(pin, fromB64(vault.salt), vault.iterations);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(vault.iv) }, key, fromB64(vault.ct));
    currentKey = key;
    write(ATTEMPTS_KEY, null);
    return { token: dec.decode(plain) };
  } catch {
    const a = read(ATTEMPTS_KEY) ?? { count: 0 };
    const count = a.count + 1;
    if (count >= MAX_ATTEMPTS) {
      clearVault();
      return { wiped: true };
    }
    // Dès 5 erreurs : 30 s d'attente, puis le double à chaque nouvelle erreur.
    const until = count >= 5 ? Date.now() + 30000 * 2 ** (count - 5) : 0;
    write(ATTEMPTS_KEY, { count, until });
    return { left: MAX_ATTEMPTS - count };
  }
}

export function clearVault() {
  currentKey = null;
  write(VAULT_KEY, null);
  write(ATTEMPTS_KEY, null);
}

/** Oublie la clé en mémoire (verrouillage). */
export function forgetKey() {
  currentKey = null;
}
