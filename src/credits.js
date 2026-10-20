// Coût en crédits Kie.ai : on lit le solde avant et après une opération
// (réponse, vocal, chanson) et on enregistre la différence. 1 crédit ≈ 0,005 $.
// C'est une estimation : si deux clients sont servis en même temps, le coût
// peut être partagé entre eux.
import { getSettings, logCredits } from "./db.js";
import { kieKey } from "./openai-compat.js";

export const USD_PER_CREDIT = 0.005;
const SETTLE_MS = Number(process.env.KIE_CREDIT_SETTLE_MS || 2500);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let lastBalance = null;

export async function getBalance() {
  const key = kieKey();
  if (!key) return null;
  try {
    const res = await fetch("https://api.kie.ai/api/v1/chat/credit", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json();
    const n = Number(data?.data);
    if (data?.code === 200 && Number.isFinite(n)) {
      lastBalance = n;
      return n;
    }
  } catch {}
  return null;
}

export const cachedBalance = () => lastBalance;

/**
 * Exécute `fn` et note les crédits dépensés pour ce contact. La mesure finale
 * se fait en arrière-plan pour ne pas ralentir la réponse au client.
 */
export async function withCredits({ contactId, kind }, fn) {
  const usesKie = kind !== "reply" || getSettings().brain === "kie";
  const before = usesKie ? await getBalance() : null;
  const result = await fn();
  if (before !== null) {
    (async () => {
      await sleep(SETTLE_MS); // Kie met parfois un instant à débiter
      const after = await getBalance();
      if (after === null) return;
      const spent = Math.round((before - after) * 100) / 100;
      if (spent > 0) logCredits({ contactId, kind, credits: spent, balanceAfter: after });
    })().catch(() => {});
  }
  return result;
}
