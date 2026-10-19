// Alertes au propriétaire du site, par e-mail (sendmail du serveur : o2switch, cPanel, la plupart des VPS).
//   - crédit Kie sous KIE_CREDIT_ALERT (50 par défaut) : un e-mail au passage sous le seuil,
//     puis un rappel par jour tant qu'il n'est pas rechargé ;
//   - composition refusée faute de crédit : un e-mail par chanson payée en attente.
// Le crédit est relu après chaque lancement et chaque fin de composition (lecture gratuite chez Kie).
import { spawn } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { BRAND } from "../constants";
import type { SongRecord } from "../types";
import { config } from "./env";
import * as kie from "./kie";
import { alerts } from "./store";

const REMINDER_MS = 24 * 3600_000;
/** Lectures du crédit espacées d'au moins une minute (plusieurs compositions à la fois). */
const CHECK_EVERY_MS = 60_000;
const CREDIT_ALERT = "kie-credit";

const encodeHeader = (s: string) => `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`;
const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").trim();

function siteHost(): string {
  try {
    return new URL(config.publicBaseUrl()).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Envoie un e-mail au propriétaire. Renvoie false (et le note dans le journal) s'il n'a pas pu partir. */
export async function emailOwner(subject: string, body: string): Promise<boolean> {
  const bin = config.sendmailPath();
  try {
    await access(bin, constants.X_OK);
  } catch {
    console.warn(`[DB.Mélo] Alerte non envoyée (pas de sendmail sur ce serveur) : ${subject}`);
    return false;
  }
  const host = siteHost();
  const from = host ? `alertes@${host}` : "";
  const message = [
    ...(from ? [`From: ${encodeHeader(BRAND.name)} <${from}>`] : []),
    `To: ${oneLine(config.alertEmail())}`,
    `Subject: ${encodeHeader(oneLine(subject))}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    body,
    "",
  ].join("\n");
  return new Promise((resolve) => {
    const child = spawn(bin, ["-t", "-i", ...(from ? ["-f", from] : [])], { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    const timer = setTimeout(() => child.kill(), 20_000);
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      console.warn(`[DB.Mélo] Alerte non envoyée : ${e.message}`);
      resolve(false);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) console.warn(`[DB.Mélo] Alerte non envoyée (sendmail ${code}) : ${oneLine(stderr)}`);
      resolve(code === 0);
    });
    child.stdin.on("error", () => {});
    child.stdin.end(message);
  });
}

const creditsPerSong = () => (config.versionsMode() === "styles" ? 24 : 12);
const formatCredits = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
const signature = () => `— ${BRAND.name}${config.publicBaseUrl() ? ` (${config.publicBaseUrl()})` : ""}`;

let lastCheck = 0;

/** Relit le crédit Kie et prévient le propriétaire s'il passe sous le seuil. */
export async function checkKieCredit(opts: { force?: boolean } = {}): Promise<void> {
  const threshold = config.kieCreditAlert();
  if (!threshold || config.demoMusic()) return;
  const now = Date.now();
  if (!opts.force && now - lastCheck < CHECK_EVERY_MS) return;
  lastCheck = now;

  const credits = await kie.getCredit();
  if (!Number.isFinite(credits)) return;
  if (!(await alerts.get(CREDIT_ALERT))) await alerts.put({ id: CREDIT_ALERT, low: false, lastAlertAt: 0 });
  let send = false;
  await alerts.update(CREDIT_ALERT, (a) => {
    a.credits = credits;
    a.checkedAt = now;
    if (credits >= threshold) {
      a.low = false; // rechargé : la prochaine baisse sous le seuil donnera une nouvelle alerte
    } else if (!a.low || now - a.lastAlertAt >= REMINDER_MS) {
      a.low = true;
      a.lastAlertAt = now;
      send = true;
    }
  });
  if (!send) return;

  const songsLeft = Math.floor(credits / creditsPerSong());
  await emailOwner(
    `⚠️ ${BRAND.name} : plus que ${formatCredits(credits)} crédits Kie`,
    [
      "Bonjour,",
      "",
      `Il reste ${formatCredits(credits)} crédits sur ton compte Kie.ai (alerte réglée sous ${formatCredits(threshold)}).`,
      `Une chanson en utilise environ ${creditsPerSong()} : ${songsLeft <= 0 ? "la prochaine commande ne pourra pas être composée" : `de quoi composer encore ${songsLeft} chanson${songsLeft > 1 ? "s" : ""} environ`}.`,
      "",
      "Recharge ton compte sur https://kie.ai pour que les prochaines commandes soient composées sans attente.",
      "",
      "Tu recevras un rappel chaque jour tant que le crédit reste sous le seuil.",
      signature(),
    ].join("\n"),
  );
}

/** Kie a refusé une chanson payée faute de crédit : alerte immédiate, avec le lien pour la relancer. */
export async function alertNoCredit(song: SongRecord, base: string): Promise<void> {
  if (config.demoMusic()) return;
  const link = `${config.publicBaseUrl() || base}/chanson/${song.id}`;
  await emailOwner(
    `⛔ ${BRAND.name} : crédit Kie épuisé, une chanson payée attend`,
    [
      "Bonjour,",
      "",
      `Kie.ai a refusé de composer la chanson « ${song.config.title} » : crédit insuffisant.`,
      "Le client a déjà payé.",
      "",
      "1. Recharge ton compte sur https://kie.ai",
      `2. Ouvre la chanson et touche « Relancer la composition » : ${link}`,
      "",
      signature(),
    ].join("\n"),
  );
}
