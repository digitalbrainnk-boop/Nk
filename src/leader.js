// Un seul « chef » à la fois : chez un hébergeur (Passenger), plusieurs copies de
// l'agent peuvent tourner en même temps (au redémarrage, par exemple). Seule celle
// qui tient le verrou se connecte à WhatsApp / Telegram et lance les tâches
// régulières ; les autres se contentent d'afficher le tableau de bord.
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./db.js";

const LOCK = path.join(DATA_DIR, "agent.lock");
const STALE_MS = 90_000;
let leader = false;

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}

function tryAcquire() {
  try {
    const cur = JSON.parse(fs.readFileSync(LOCK, "utf8"));
    const fresh = Date.now() - cur.at < STALE_MS;
    if (cur.pid !== process.pid && fresh && alive(cur.pid)) return false;
  } catch {}
  fs.writeFileSync(LOCK, JSON.stringify({ pid: process.pid, at: Date.now() }));
  // Relecture : si deux copies écrivent en même temps, une seule garde le verrou.
  try {
    return JSON.parse(fs.readFileSync(LOCK, "utf8")).pid === process.pid;
  } catch {
    return false;
  }
}

function release() {
  try {
    if (leader && JSON.parse(fs.readFileSync(LOCK, "utf8")).pid === process.pid) fs.rmSync(LOCK, { force: true });
  } catch {}
  leader = false;
}

export const isLeader = () => leader;

/** Lance `start` dès que cette copie devient le chef (tout de suite si personne ne l'est). */
export function whenLeader(start) {
  const check = () => {
    if (leader) {
      // Battement de cœur : le verrou reste « frais » tant que la copie vit.
      fs.writeFileSync(LOCK, JSON.stringify({ pid: process.pid, at: Date.now() }));
      return;
    }
    if (tryAcquire()) {
      leader = true;
      console.log("👑 Cette copie de l'agent gère WhatsApp, Telegram et les tâches automatiques.");
      start();
    }
  };
  check();
  setInterval(check, 30_000).unref();
  for (const sig of ["SIGTERM", "SIGINT"]) {
    process.once(sig, () => {
      release();
      process.exit(0);
    });
  }
  process.once("exit", release);
}
