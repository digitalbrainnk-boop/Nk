import { Check, Gift, Headphones, PenLine, Smartphone, Sparkles, Wand2 } from "lucide-react";
import Link from "next/link";
import { HeroVisual } from "@/components/landing/HeroVisual";
import { Reveal } from "@/components/landing/Reveal";
import { ACTIVE_PLANS, OPERATORS, SONG_PRICES, STYLES, VOICES } from "@/lib/constants";
import { formatPrice } from "@/lib/pricing";

const STEPS = [
  { icon: PenLine, title: "Racontez", text: "Écrivez vos paroles ou confiez vos souvenirs au parolier IA : prénoms, anecdotes, l'émotion voulue." },
  { icon: Headphones, title: "Composez", text: "Après le paiement, le studio compose deux versions de votre chanson, avec la voix de votre choix." },
  { icon: Gift, title: "Offrez", text: "Téléchargez en HD sur votre téléphone, envoyez sur WhatsApp ou partagez la page cadeau et son QR code." },
];

const PRICE = formatPrice(SONG_PRICES.XOF, "XOF");

const FAQ = [
  { q: "Combien ça coûte ?", a: `${PRICE} la chanson, livrée en deux versions au choix. Vous relisez et retouchez vos paroles gratuitement, puis vous payez : le studio compose alors votre chanson.` },
  { q: "Combien de temps faut-il ?", a: "Quelques minutes pour remplir le formulaire, puis 1 à 5 minutes de composition après le paiement." },
  { q: "Comment payer depuis mon pays ?", a: "Par Mobile Money dans votre monnaie (Orange Money, Wave, MTN MoMo, Moov, Airtel Money, M-Pesa… selon le pays), ou par carte Visa / Mastercard depuis n'importe quel pays d'Afrique." },
  { q: "Comment garder la chanson sur mon téléphone ?", a: "Un bouton « Télécharger & Sauvegarder » ouvre l'enregistrement natif : app Fichiers sur iPhone et iPad, Téléchargements et lecteurs de musique sur Android. Le MP3 contient le titre, l'artiste et la pochette." },
  { q: "Puis-je installer l'application ?", a: "Oui : sur Android et ordinateur, touchez « Installer l'app ». Sur iPhone et iPad, Safari → Partager → « Sur l'écran d'accueil »." },
  { q: "À qui appartient la chanson ?", a: "Vous pouvez l'offrir, la partager et la diffuser dans un cadre personnel (fête, cérémonie, réseaux sociaux). Pour un usage commercial, contactez-nous." },
];

export default function Home() {
  return (
    <>
      <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 pt-10 pb-16 sm:pt-16 lg:grid-cols-2">
        <Reveal>
          <p className="eyebrow">Chansons personnalisées · qualité studio</p>
          <h1 className="mt-4 font-display text-4xl leading-[1.05] font-extrabold sm:text-6xl">
            Offrez une chanson <span className="gold-text">qui n&apos;existe que pour elle</span>.
          </h1>
          <p className="mt-5 max-w-xl text-lg text-muted">
            Anniversaire, mariage, fête des mères, hommage… Racontez votre histoire, DB.Mélo l&apos;écrit, la compose et la chante. En afro-pop, zouk, coupé-décalé, gospel ou ballade.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link href="/studio" className="btn btn-gold px-7 text-base">
              <Sparkles className="size-5" /> Créer ma chanson
            </Link>
            <a href="#tarifs" className="btn btn-ghost px-7 text-base">
              Voir les tarifs
            </a>
          </div>
          <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted">
            {["Paroles relues avant de payer", `2 versions pour ${PRICE}`, "Mobile Money & carte, partout en Afrique"].map((t) => (
              <li key={t} className="flex items-center gap-1.5">
                <Check className="size-4 text-gold" /> {t}
              </li>
            ))}
          </ul>
        </Reveal>
        <Reveal delay={0.15}>
          <HeroVisual />
        </Reveal>
      </section>

      <section className="border-y border-line/60 bg-studio/40 py-5">
        <div className="no-scrollbar mx-auto flex max-w-6xl gap-3 overflow-x-auto px-4">
          {STYLES.map((s) => (
            <span key={s.id} className="chip shrink-0">
              {s.emoji} {s.label}
            </span>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-20">
        <Reveal>
          <p className="eyebrow">Comment ça marche</p>
          <h2 className="mt-3 font-display text-3xl font-bold sm:text-4xl">Trois étapes, une émotion</h2>
        </Reveal>
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            return (
              <Reveal key={s.title} delay={i * 0.1} className="card p-6">
                <span className="flex size-12 items-center justify-center rounded-2xl bg-gold/15 text-gold">
                  <Icon className="size-6" />
                </span>
                <h3 className="mt-4 font-display text-xl font-semibold">
                  {i + 1}. {s.title}
                </h3>
                <p className="mt-2 text-muted">{s.text}</p>
              </Reveal>
            );
          })}
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-4 px-4 pb-20 md:grid-cols-2">
        <Reveal className="card p-7">
          <PenLine className="size-7 text-gold" />
          <h3 className="mt-4 font-display text-2xl font-bold">Studio Paroles</h3>
          <p className="mt-2 text-muted">Votre texte, votre plume. L&apos;éditeur détecte les rimes, compte les syllabes et structure la chanson en un geste : [Couplet], [Refrain], [Pont], [Solo], [Outro].</p>
        </Reveal>
        <Reveal delay={0.1} className="card p-7">
          <Wand2 className="size-7 text-gold" />
          <h3 className="mt-4 font-display text-2xl font-bold">Parolier & Compositeur IA</h3>
          <p className="mt-2 text-muted">Un prénom, une occasion, quelques souvenirs et une émotion : le parolier écrit des couplets sur mesure, que vous retouchez librement avant la musique.</p>
        </Reveal>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-20">
        <Reveal>
          <h2 className="font-display text-3xl font-bold">Quatre voix studio</h2>
        </Reveal>
        <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          {VOICES.map((v, i) => (
            <Reveal key={v.id} delay={i * 0.06} className="card p-5">
              <span className="text-3xl">{v.emoji}</span>
              <p className="mt-2 font-semibold">{v.label}</p>
              <p className="text-sm text-muted">{v.description}</p>
            </Reveal>
          ))}
        </div>
      </section>

      <section id="tarifs" className="mx-auto max-w-6xl scroll-mt-20 px-4 pb-20">
        <Reveal>
          <p className="eyebrow">Tarif</p>
          <h2 className="mt-3 font-display text-3xl font-bold sm:text-4xl">Une chanson, un prix</h2>
        </Reveal>
        <div className="mx-auto mt-8 max-w-xl">
          {ACTIVE_PLANS.map((p) => (
            <Reveal key={p.id} className="card relative border-gold/60 p-7 text-center">
              <h3 className="font-display text-2xl font-bold">{p.name}</h3>
              <p className="text-sm text-muted">{p.tagline}</p>
              <p className="mt-4 font-display text-5xl font-extrabold text-gold-soft">{formatPrice(p.prices.XOF, "XOF")}</p>
              <p className="mt-1 text-sm text-muted">ou l&apos;équivalent dans votre monnaie</p>
              <ul className="mx-auto mt-5 max-w-sm space-y-2 text-left">
                {p.features.map((f) => (
                  <li key={f} className="flex gap-2">
                    <Check className="mt-0.5 size-5 shrink-0 text-gold" /> {f}
                  </li>
                ))}
              </ul>
              <Link href="/studio" className="btn btn-gold mt-6 w-full">
                Créer ma chanson
              </Link>
            </Reveal>
          ))}
        </div>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          {Object.values(OPERATORS).map((o) => (
            <span key={o.label} className="rounded-xl px-3 py-1.5 text-sm font-bold" style={{ background: o.color, color: o.text }}>
              {o.label}
            </span>
          ))}
          {["Visa", "Mastercard"].map((b) => (
            <span key={b} className="chip">
              {b}
            </span>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-20">
        <Reveal className="card flex flex-col items-center gap-6 p-8 text-center md:flex-row md:text-left">
          <Smartphone className="size-14 shrink-0 text-gold" />
          <div className="flex-1">
            <h2 className="font-display text-2xl font-bold">L&apos;application sur votre téléphone</h2>
            <p className="mt-2 text-muted">DB.Mélo s&apos;installe sur Android, iPhone, iPad et ordinateur, sans passer par un store. Vos chansons à portée de main, même hors ligne une fois téléchargées.</p>
          </div>
          <Link href="/studio" className="btn btn-gold">
            Essayer maintenant
          </Link>
        </Reveal>
      </section>

      <section id="faq" className="mx-auto max-w-3xl scroll-mt-20 px-4 pb-10">
        <h2 className="font-display text-3xl font-bold">Questions fréquentes</h2>
        <div className="mt-6 space-y-3">
          {FAQ.map((f) => (
            <details key={f.q} className="card group p-5">
              <summary className="cursor-pointer list-none font-semibold marker:hidden">
                <span className="flex items-center justify-between gap-4">
                  {f.q}
                  <span className="text-gold transition group-open:rotate-45">+</span>
                </span>
              </summary>
              <p className="mt-3 text-muted">{f.a}</p>
            </details>
          ))}
        </div>
      </section>
    </>
  );
}
