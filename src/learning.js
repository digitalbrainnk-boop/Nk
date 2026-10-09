// Apprentissage à partir d'un export de discussion WhatsApp (.txt ou .zip
// "Exporter la discussion" -> "Sans médias").
//
// Formats reconnus :
//   Android : 12/03/2024 14:05 - Nom: message
//   iOS     : [12/03/2024 14:05:33] Nom: message
//   (avec ou sans virgule, en 12h ou 24h)

const LINE =
  /^‎?\[?(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})[,\s]+(\d{1,2}:\d{2}(?::\d{2})?(?:\s?[APap]\.?[Mm]\.?)?)\]?\s*(?:-\s)?\s*([^:]{1,60}?):\s(.*)$/;

const SKIP = [
  /<M[ée]dias? omis>/i,
  /<Media omitted>/i,
  /image absente|vidéo absente|audio omis|omitted/i,
  /Ce message a été supprimé|This message was deleted|Vous avez supprimé ce message/i,
  /Les messages et les appels sont chiffrés|Messages and calls are end-to-end encrypted/i,
  /^null$/,
];

export function parseWhatsAppExport(raw) {
  const lines = raw.replace(/\r/g, "").split("\n");
  const messages = [];
  for (const line of lines) {
    const m = line.match(LINE);
    if (m) {
      messages.push({ author: m[3].replace(/^‎/, "").trim(), text: m[4] });
    } else if (messages.length && line.trim()) {
      messages[messages.length - 1].text += "\n" + line; // message sur plusieurs lignes
    }
  }
  return messages
    .map((m) => ({ ...m, text: m.text.replace(/‎/g, "").trim() }))
    .filter((m) => m.text && !SKIP.some((r) => r.test(m.text)));
}

export function participants(messages) {
  const counts = new Map();
  for (const m of messages) counts.set(m.author, (counts.get(m.author) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
}

/**
 * Regroupe les messages en paires (ce que dit le client -> ce que répond le
 * propriétaire). Les bulles consécutives d'une même personne sont fusionnées.
 */
export function buildPairs(messages, ownerName) {
  const blocks = [];
  for (const m of messages) {
    const isOwner = m.author === ownerName;
    const last = blocks[blocks.length - 1];
    if (last && last.isOwner === isOwner) last.texts.push(m.text);
    else blocks.push({ isOwner, texts: [m.text] });
  }
  const pairs = [];
  for (let i = 1; i < blocks.length; i++) {
    if (blocks[i].isOwner && !blocks[i - 1].isOwner) {
      pairs.push({
        client_text: blocks[i - 1].texts.slice(-4).join("\n"),
        owner_reply: blocks[i].texts.join("\n"),
      });
    }
  }
  return pairs;
}
