// Parolier de secours (sans clé IA) : modèles rimés par occasion, nourris des souvenirs.
import type { AiLyricsBrief, GeneratedLyrics, Occasion, VoiceType } from "../types";

const TITLES: Record<Occasion, (n: string) => string> = {
  birthday: (n) => `Joyeux anniversaire ${n}`,
  wedding: (n) => `${n}, pour la vie`,
  love: (n) => `${n}, mon soleil`,
  tribute: (n) => `À jamais ${n}`,
  mothers_day: (n) => `Maman ${n}`,
  fathers_day: (n) => `Papa ${n}`,
  lullaby: (n) => `Dors, ${n}`,
  graduation: (n) => `Bravo ${n}`,
  friendship: (n) => `${n}, mon frère de cœur`,
  faith: (n) => `Merci pour ${n}`,
  other: (n) => `La chanson de ${n}`,
};

const CHORUS: Record<Occasion, (n: string) => string[]> = {
  birthday: (n) => [`Joyeux anniversaire, ${n}, c'est ta fête aujourd'hui`, `Que la musique t'emporte, que tout s'illumine ici`, `On lève nos verres et nos cœurs pour toi`, `${n}, cette chanson, elle est faite pour toi`],
  wedding: (n) => [`${n}, je te dis oui pour la vie`, `Main dans la main, nos deux cœurs réunis`, `Devant le ciel et devant nos familles`, `Notre amour danse et brille`],
  love: (n) => [`${n}, tu es mon soleil, ma lumière`, `Avec toi, chaque jour est une prière`, `Je t'aime plus fort que les mots`, `Tu es mon plus beau cadeau`],
  tribute: (n) => [`${n}, ta voix résonne encore en nous`, `Ton sourire veille, tendre et doux`, `On porte ton nom comme une flamme`, `Pour toujours au fond de l'âme`],
  mothers_day: (n) => [`Maman ${n}, reine de ma vie`, `Tes mains m'ont porté, tes mots m'ont grandi`, `Pour tout ton amour, mille fois merci`, `Maman, tu es mon paradis`],
  fathers_day: (n) => [`Papa ${n}, mon roc, mon repère`, `Tu m'as montré le chemin sur la terre`, `Ta force et ton cœur me guident encore`, `Papa, tu vaux tout l'or`],
  lullaby: (n) => [`Dors, ${n}, ferme les yeux tout doux`, `Les étoiles veillent sur nous`, `Maman est là, papa aussi`, `Fais de beaux rêves, mon petit`],
  graduation: (n) => [`Bravo ${n}, tu l'as fait, tu as gagné`, `Toutes ces nuits à travailler`, `Aujourd'hui le monde t'ouvre ses portes`, `Ta victoire, elle est forte`],
  friendship: (n) => [`${n}, mon ami, mon frère de cœur`, `Dans les galères comme dans le bonheur`, `On a ri, on a pleuré ensemble`, `L'amitié qui nous rassemble`],
  faith: (n) => [`Merci Seigneur pour ${n}`, `Pour chaque grâce, chaque matin`, `Ta lumière guide nos chemins`, `Alléluia, merci sans fin`],
  other: (n) => [`${n}, cette chanson est pour toi`, `Écoute-la, elle parle de toi`, `De nos souvenirs et de nos joies`, `${n}, chante avec moi`],
};

const RHYME_TAILS = [
  "et ton sourire illumine nos vies",
  "un souvenir gravé pour la vie",
  "et dans nos cœurs, rien n'est fini",
  "comme un trésor, comme un merci",
];

const FILLERS = ["Tous ces moments partagés", "Nos rires et nos secrets", "Chaque jour à tes côtés", "La douceur de ta présence"];

/** Quatre vers tirés des souvenirs racontés (complétés si besoin, jamais répétés). */
function memoryLines(anecdotes: string): string[] {
  const parts = anecdotes
    .split(/[.!?\n;]+/)
    .map((s) => s.trim().replace(/\s+/g, " "))
    .filter((s) => s.length > 3)
    .map((s) => (s.length > 64 ? `${s.slice(0, 61).replace(/\s+\S*$/, "")}…` : s))
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1));
  const unique = [...new Set(parts)];
  return [...unique, ...FILLERS].slice(0, 4);
}

export function templateLyrics(brief: AiLyricsBrief, voice: VoiceType): GeneratedLyrics {
  const name = brief.recipientName.trim();
  const nick = brief.nicknames?.split(/[,;/]/)[0]?.trim() || name;
  const m = memoryLines(brief.anecdotes);
  const chorus = CHORUS[brief.occasion](name).join("\n");
  const duo = voice === "duo";
  const tag = (label: string, part?: string) => (duo && part ? `[${label} - ${part}]` : `[${label}]`);

  const lyrics = [
    tag("Couplet 1", "Lui"),
    `${nick}, je me souviens…`,
    m[0],
    RHYME_TAILS[0],
    m[1],
    RHYME_TAILS[1],
    "",
    tag("Refrain", "Ensemble"),
    chorus,
    "",
    tag("Couplet 2", "Elle"),
    "Et je repense encore à tout ça…",
    m[2],
    RHYME_TAILS[2],
    m[3],
    RHYME_TAILS[3],
    "",
    tag("Refrain", "Ensemble"),
    chorus,
    "",
    tag("Pont", "Ensemble"),
    `${nick}, ${nick}, écoute bien`,
    "Cette mélodie, c'est notre lien",
    "",
    tag("Refrain", "Ensemble"),
    chorus,
    "",
    "[Outro]",
    brief.senderName ? `Avec tout mon amour, ${brief.senderName}` : `Pour toi, ${name}, pour toujours`,
  ].join("\n");

  return { title: TITLES[brief.occasion](name), lyrics, source: "template" };
}
