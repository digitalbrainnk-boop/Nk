// Le cerveau : construit le contexte (identité, style, connaissances, mémoire
// du client, exemples réels) et demande à Claude la prochaine réponse.
import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { allExamples, getSettings, listKnowledge, listMessages } from "./db.js";

let client = null;
let clientKey = null;
function getClient() {
  const key = getSettings().anthropic_api_key || process.env.ANTHROPIC_API_KEY || null;
  if (!client || key !== clientKey) {
    client = key ? new Anthropic({ apiKey: key }) : new Anthropic();
    clientKey = key;
  }
  return client;
}

const ReplySchema = z.object({
  messages: z
    .array(z.string())
    .describe(
      "Les bulles à envoyer, dans l'ordre (1 à 4 messages courts comme un humain). Tableau vide si aucune réponse n'est nécessaire.",
    ),
  memory: z
    .string()
    .describe(
      "Mémoire à jour sur ce client (prénom, occasion, chanson demandée, budget, délais, étape de la commande, préférences). Concis, en puces.",
    ),
  needs_human: z
    .boolean()
    .describe("true si le propriétaire doit intervenir lui-même."),
  reason: z.string().describe("Pourquoi le propriétaire doit intervenir (vide sinon)."),
});

export const CHANNEL_LABELS = {
  whatsapp: "WhatsApp",
  whatsapp_cloud: "WhatsApp Business",
  telegram: "Telegram",
  messenger: "Messenger (Facebook)",
  instagram: "Instagram",
  facebook_comment: "commentaire public sur Facebook",
  test: "test (bac à sable)",
};

// Partie stable du prompt (mise en cache) : ne dépend pas du client.
function buildSystemPrompt(s) {
  const knowledge = listKnowledge()
    .map((k) => `### ${k.title}\n${k.content}`)
    .join("\n\n");
  const owner = s.owner_name || "le propriétaire";
  return `Tu réponds aux messages des clients et prospects de ${owner}, à sa place, sur ses comptes (WhatsApp, Telegram, Facebook, Instagram). Ton but : qu'ils aient l'impression de parler directement à ${owner} — même ton, mêmes expressions, même façon d'écrire — et les accompagner jusqu'à la commande.

## Activité
${s.business_description || "(Pas encore décrite. Reste prudent et propose d'en dire plus plus tard.)"}

## Façon d'écrire de ${owner}
${s.style_profile || "(Profil de style pas encore généré : écris de façon chaleureuse, simple et naturelle, comme sur WhatsApp.)"}

## Connaissances (prix, délais, process...)
${knowledge || "(Aucune fiche pour l'instant.)"}

## Comment répondre
- Écris comme une personne sur une messagerie : messages courts, naturels, pas de listes à puces, pas de gras, pas de titres, pas de formules de service client robotiques. Si ${owner} découpe ses réponses en plusieurs petits messages, fais pareil (1 à 4 bulles).
- Réponds dans la langue et le registre du client (tutoiement/vouvoiement comme ${owner} le fait).
- Appuie-toi sur les exemples réels de conversations fournis : ils montrent comment ${owner} répond vraiment. Reprends son vocabulaire, ses emojis, sa ponctuation, sa longueur de messages.
- N'invente jamais un prix, un délai, une promotion, une disponibilité ou une promesse qui n'est pas dans les connaissances ou les exemples. Si tu ne sais pas, dis naturellement que tu vérifies et reviens vers lui, et mets needs_human à true.
- Mets needs_human à true aussi pour : confirmation ou litige de paiement, remboursement, réclamation, client énervé, demande hors de l'activité, ou tout ce qui engage ${owner}.
- Pose les questions utiles pour une chanson personnalisée (pour qui, occasion, prénoms, anecdotes, style musical, date souhaitée) au fil de la discussion, pas toutes d'un coup.
- Les messages vocaux du client te sont donnés transcrits ; réponds au contenu comme si tu les avais écoutés.
- Si le dernier message n'appelle pas de réponse (ex. « ok merci 👍 » après une conclusion), renvoie un tableau messages vide.
- Honnêteté : si quelqu'un demande sincèrement s'il parle à un robot ou à une IA, ne mens pas — dis que c'est l'assistant de ${owner} qui répond pour l'instant et que ${owner} peut prendre le relais. Ne prétends jamais avoir fait une action dans le monde réel que tu n'as pas faite.
- Les messages marqués comme écrits par ${owner} lui-même font partie de la conversation : reste cohérent avec ce qu'il a dit.
- Mets à jour la mémoire du client à chaque fois : garde l'essentiel, retire ce qui est obsolète.
${s.extra_rules ? `\n## Consignes supplémentaires de ${owner}\n${s.extra_rules}` : ""}`;
}

// Normalisation simple pour retrouver les exemples proches du message client.
function tokens(text) {
  return new Set(
    text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2),
  );
}

export function pickExamples(queryText, count = 8) {
  const examples = allExamples();
  if (!examples.length) return [];
  const q = tokens(queryText);
  const scored = examples.map((e) => {
    const t = tokens(e.client_text);
    let overlap = 0;
    for (const w of q) if (t.has(w)) overlap++;
    return { e, score: overlap / Math.sqrt(t.size + 1) };
  });
  scored.sort((a, b) => b.score - a.score);
  const best = scored.slice(0, count - 2).map((x) => x.e);
  // Quelques exemples au hasard pour garder la variété du ton.
  const rest = scored.slice(count - 2);
  for (let i = 0; i < 2 && rest.length; i++) {
    best.push(rest.splice(Math.floor(Math.random() * rest.length), 1)[0].e);
  }
  return best;
}

function imageBlock(m) {
  try {
    if (!m.media_path || !/^image\/(jpeg|png|gif|webp)$/.test(m.media_type || "")) return null;
    const data = fs.readFileSync(m.media_path).toString("base64");
    return { type: "image", source: { type: "base64", media_type: m.media_type, data } };
  } catch {
    return null;
  }
}

function describe(m, ownerName) {
  if (m.kind === "audio") return `[message vocal] ${m.text || "(inaudible)"}`;
  if (m.kind === "image") return `[photo]${m.text ? " " + m.text : ""}`;
  if (m.kind === "other") return `[pièce jointe]${m.text ? " " + m.text : ""}`;
  if (m.author === "owner") return m.text;
  return m.text;
}

// Transforme l'historique stocké en tours user/assistant pour l'API.
function buildHistory(contact, s) {
  const msgs = listMessages(contact.id, s.history_messages).filter(
    (m) => m.status === "sent" || m.status === "received",
  );
  const lastImages = new Set(
    msgs
      .filter((m) => m.kind === "image" && m.author === "client")
      .slice(-3)
      .map((m) => m.id),
  );
  const turns = [];
  for (const m of msgs) {
    const role = m.author === "client" ? "user" : "assistant";
    const content = [];
    if (role === "user" && lastImages.has(m.id)) {
      const img = imageBlock(m);
      if (img) content.push(img);
    }
    let text = describe(m, s.owner_name);
    if (m.author === "owner") text = `(écrit par ${s.owner_name || "le propriétaire"} lui-même) ${text}`;
    content.push({ type: "text", text: text || "…" });
    const prev = turns[turns.length - 1];
    if (prev && prev.role === role) prev.content.push(...content);
    else turns.push({ role, content });
  }
  if (!turns.length || turns[0].role !== "user") {
    turns.unshift({ role: "user", content: [{ type: "text", text: "(début de la conversation)" }] });
  }
  // L'API attend que le dernier tour soit celui du client.
  if (turns[turns.length - 1].role !== "user") {
    turns.push({
      role: "user",
      content: [{ type: "text", text: "(pas de nouveau message du client)" }],
    });
  }
  return turns;
}

function formatExamples(examples) {
  if (!examples.length) return "(aucun exemple importé pour l'instant)";
  return examples
    .map((e) => `<exemple>\nClient : ${e.client_text}\nRéponse réelle : ${e.owner_reply}\n</exemple>`)
    .join("\n");
}

/**
 * Génère la réponse pour un contact.
 * @returns {Promise<{messages: string[], memory: string, needs_human: boolean, reason: string}>}
 */
export async function generateReply(contact) {
  const s = getSettings();
  const turns = buildHistory(contact, s);
  const lastClientText = turns
    .filter((t) => t.role === "user")
    .slice(-2)
    .flatMap((t) => t.content.filter((c) => c.type === "text").map((c) => c.text))
    .join(" ");
  const examples = pickExamples(lastClientText);
  const channel = CHANNEL_LABELS[contact.channel] || contact.channel;
  const date = new Date().toLocaleString("fr-FR", { dateStyle: "full", timeStyle: "short" });

  const context = `Contexte de cette conversation (non visible par le client) :
- Canal : ${channel}${contact.channel === "facebook_comment" ? " — réponse PUBLIQUE et brève ; propose de continuer en message privé si besoin de détails" : ""}
- Nom affiché du client : ${contact.name || "inconnu"}
- Date et heure : ${date}
- Mémoire sur ce client :
${contact.memory || "(nouveau contact, rien en mémoire)"}

Exemples réels de la façon dont ${s.owner_name || "le propriétaire"} répond :
${formatExamples(examples)}

Écris maintenant la prochaine réponse au client.`;

  const response = await getClient().beta.messages.parse({
    model: s.model || "claude-opus-5-5",
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: s.effort || "medium", format: betaZodOutputFormat(ReplySchema) },
    system: [{ type: "text", text: buildSystemPrompt(s), cache_control: { type: "ephemeral" } }],
    // Le contexte variable arrive en message système en fin de conversation
    // pour ne pas casser le cache du début.
    messages: [...turns, { role: "system", content: context }],
  });

  if (response.stop_reason === "refusal") {
    return { messages: [], memory: contact.memory, needs_human: true, reason: "L'IA a refusé de répondre à ce message." };
  }
  const out = response.parsed_output;
  if (!out) {
    return { messages: [], memory: contact.memory, needs_human: true, reason: "Réponse de l'IA illisible." };
  }
  out.messages = out.messages.map((m) => m.trim()).filter(Boolean);
  return out;
}

/** Analyse un lot d'échanges réels et rédige le profil de style + des fiches. */
export async function buildStyleProfile(ownerName) {
  const s = getSettings();
  const examples = allExamples();
  if (!examples.length) throw new Error("Importe d'abord des conversations.");
  const sample = [...examples].sort(() => Math.random() - 0.5).slice(0, 250);
  const corpus = sample
    .map((e) => `Client : ${e.client_text}\n${ownerName} : ${e.owner_reply}`)
    .join("\n---\n");

  const Profile = z.object({
    style_profile: z.string().describe("Portrait détaillé de la façon d'écrire, en français, prêt à servir de consigne."),
    business_facts: z
      .array(z.object({ title: z.string(), content: z.string() }))
      .describe("Faits sur l'activité repérés dans les échanges (prix, délais, process, moyens de paiement...)."),
  });

  const stream = getClient().beta.messages.stream({
    model: s.model || "claude-opus-5-5",
    max_tokens: 32000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "high", format: betaZodOutputFormat(Profile) },
    messages: [
      {
        role: "user",
        content: `Voici des échanges réels entre ${ownerName} (compositeur de chansons personnalisées) et ses clients.

<echanges>
${corpus}
</echanges>

1. Rédige le profil d'écriture de ${ownerName} pour qu'une IA puisse répondre exactement comme lui : ton, tutoiement/vouvoiement, longueur et découpage des messages, salutations et formules récurrentes, emojis, ponctuation, fautes ou abréviations habituelles, manière de présenter ses offres, de relancer, de conclure. Cite des expressions typiques entre guillemets.
2. Liste les faits sur l'activité que tu peux déduire (prix, délais, étapes, moyens de paiement, ce qui est inclus). Ne retiens que ce qui est clairement présent dans les échanges.`,
      },
    ],
  });
  const final = await stream.finalMessage();
  const text = final.content.find((b) => b.type === "text")?.text;
  if (!text) throw new Error("Pas de réponse de l'IA.");
  return Profile.parse(JSON.parse(text));
}
