import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "nk-social-"));
process.env.KIE_POLL_MS = "5";
const db = await import("../src/db.js");
const router = await import("../src/router.js");
const { runSocial } = await import("../src/social.js");

const calls = [];
let fbDown = false;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const body = init.body ? JSON.parse(init.body) : null;
  calls.push({ u, body });
  if (u.includes("/chat/completions"))
    return Response.json({ choices: [{ message: { content: JSON.stringify({ text: "🎶 Offre une chanson unique ! Écris-moi en privé. #chanson", image_prompt: "warm photo of a guitar" }) } }] });
  if (u.endsWith("/jobs/createTask")) return Response.json({ code: 200, data: { taskId: "img1" } });
  if (u.includes("/jobs/recordInfo")) return Response.json({ code: 200, data: { state: "success", resultJson: JSON.stringify({ resultUrls: ["https://cdn.x/img.png"] }) } });
  if (u.includes("graph.facebook.com") && u.includes("/me?")) return Response.json({ id: "PAGE1" });
  if (u.includes("graph.facebook.com") && u.endsWith("/PAGE1/photos"))
    return fbDown ? Response.json({ error: { message: "(#200) permission pages_manage_posts manquante" } }, { status: 403 }) : Response.json({ id: "ph1", post_id: "PAGE1_99" });
  throw new Error(`appel inattendu ${u}`);
};

const owner = [];
router.registerAdapter({ channel: "whatsapp", send: async () => "w", notifyOwner: async (t) => (owner.push(t), `n${owner.length}`) });
db.setSettings({
  brain: "kie",
  kie_api_key: "k",
  kie_chat_url: "https://api.kie.ai/gpt-5-2/v1/chat/completions",
  kie_chat_model: "gpt-5-2",
  facebook_page_token: "tok",
  social_hour: 0,
});
const DAY = 24 * 3600_000;

test("1. désactivé par défaut : rien n'est publié", async () => {
  assert.equal(db.getSettings().social_enabled, false);
  assert.equal(await runSocial(), null);
  assert.equal(calls.length, 0);
});

test("2. activé : texte + image publiés sur la page, tu reçois le texte sur WhatsApp", async () => {
  db.setSettings({ social_enabled: true });
  const p = await runSocial();
  assert.equal(p.status, "published");
  assert.equal(p.fb_id, "PAGE1_99");
  const photo = calls.find((c) => c.u.endsWith("/PAGE1/photos"));
  assert.equal(photo.body.url, "https://cdn.x/img.png");
  assert.match(photo.body.caption, /chanson unique/);
  assert.match(owner.at(-1), /Publié sur ta page Facebook/);
});

test("3. pas de nouvelle publication avant 3 jours, puis publication", async () => {
  const n = calls.length;
  assert.equal(await runSocial(Date.now() + DAY), null);
  assert.equal(calls.length, n);
  db.setSettings({ social_last_attempt: 0 });
  const p = await runSocial(Date.now() + 3 * DAY);
  assert.equal(p?.status, "published");
  // La publication précédente est donnée à l'IA pour ne pas se répéter.
  const prompt = calls.filter((c) => c.u.includes("/chat/completions")).at(-1).body.messages.map((m) => m.content).join("\n");
  assert.match(prompt, /chanson unique/);
});

test("4. échec Facebook : tu es prévenu, nouvel essai 3 h plus tard (pas chaque minute)", async () => {
  fbDown = true;
  db.setSettings({ social_last_attempt: 0 });
  const t = Date.now() + 7 * DAY;
  assert.equal(await runSocial(t), null);
  assert.match(owner.at(-1), /Publication Facebook impossible.*pages_manage_posts/);
  const n = calls.length;
  assert.equal(await runSocial(t + 60_000), null);
  assert.equal(calls.length, n);
  assert.equal(db.listSocialPosts(1)[0].status, "failed");
});

test("5. tous les jours (1) : une seule publication par jour, pas deux", async () => {
  fbDown = false;
  db.setSettings({ social_every_days: 1, social_last_attempt: 0 });
  const today10 = new Date(Date.now() + 10 * DAY);
  today10.setHours(10, 0, 0, 0);
  const p = db.addSocialPost({ text: "x", status: "published", fb_id: "f" });
  db.db.prepare("UPDATE social_posts SET created_at = ? WHERE id = ?").run(today10.getTime(), p.id);
  const today22 = new Date(today10);
  today22.setHours(22);
  assert.equal(await runSocial(today22.getTime()), null); // même jour : rien
  const tomorrow10 = new Date(today10.getTime() + DAY);
  assert.equal((await runSocial(tomorrow10.getTime()))?.status, "published");
});
