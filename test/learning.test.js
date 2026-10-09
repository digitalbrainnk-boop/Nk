import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPairs, parseWhatsAppExport, participants } from "../src/learning.js";

const android = `12/03/2024 14:05 - Les messages et les appels sont chiffrés de bout en bout.
12/03/2024 14:05 - Awa: Bonsoir
12/03/2024 14:06 - Awa: C'est combien une chanson pour mon mari ?
12/03/2024 14:10 - Nk Music: Bonsoir ma sœur 🙏
12/03/2024 14:10 - Nk Music: C'est 25 000 la chanson
avec le refrain personnalisé
12/03/2024 14:12 - Awa: <Médias omis>
12/03/2024 14:13 - Awa: D'accord je réfléchis
`;

const ios = `[12/03/2024 14:05:33] Awa: Salut
[12/03/2024 14:06:01] Nk Music: Salut, ça va ?
`;

test("parse un export Android, messages multi-lignes et médias ignorés", () => {
  const msgs = parseWhatsAppExport(android);
  assert.equal(msgs.length, 5);
  assert.equal(msgs[3].text, "C'est 25 000 la chanson\navec le refrain personnalisé");
  assert.deepEqual(participants(msgs).map((p) => p.name).sort(), ["Awa", "Nk Music"]);
});

test("parse un export iOS", () => {
  const msgs = parseWhatsAppExport(ios);
  assert.deepEqual(msgs.map((m) => m.author), ["Awa", "Nk Music"]);
});

test("construit des paires client -> réponse du propriétaire", () => {
  const pairs = buildPairs(parseWhatsAppExport(android), "Nk Music");
  assert.equal(pairs.length, 1);
  assert.match(pairs[0].client_text, /combien/);
  assert.match(pairs[0].owner_reply, /^Bonsoir ma sœur 🙏\nC'est 25 000/);
});
