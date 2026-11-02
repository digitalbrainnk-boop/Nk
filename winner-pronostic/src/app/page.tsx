import Link from "next/link";
import { HomeSports } from "@/components/home/home-sports";
import { sportStyle } from "@/components/sport/sport-badge";
import { ButtonLink } from "@/components/ui/button";
import { ShieldIcon } from "@/components/ui/icons";
import { ACTIVE_SPORTS } from "@/lib/sports/catalog";

const QUICK_CODES = [2, 5, 10, 20];

const STEPS = [
  { n: 1, title: "Choisissez votre cote", text: "Code de 2, de 5, de 10… le niveau de risque, la période et les sports." },
  { n: 2, title: "On analyse les matchs", text: "Forces d'attaque et de défense, classement Elo, forme, absences, cotes du marché." },
  { n: 3, title: "Copiez votre coupon", text: "Chance réelle affichée, partage WhatsApp et code de chargement quand il est disponible." },
];

export default function HomePage() {
  return (
    <div className="space-y-7">
      {/* Bannière « stade » */}
      <section className="bg-pitch relative overflow-hidden rounded-(--radius-card) border border-brand/25 p-5 shadow-[0_20px_60px_-30px_rgb(34_224_125/0.6)]">
        <div className="bg-field-lines pointer-events-none absolute inset-0" aria-hidden />
        <div className="relative">
          <p className="inline-flex items-center gap-1.5 rounded-full bg-brand/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-brand">
            ⚡ Analyse multi-sports
          </p>
          <h1 className="mt-3 font-display text-[40px] font-extrabold uppercase leading-[0.92] tracking-tight">
            Code de <span className="text-gold">5</span>, <span className="text-gold">10</span>, <span className="text-gold">20</span>…
            <br />
            <span className="text-brand">analysé</span> pour vous.
          </h1>
          <p className="mt-3 max-w-md text-sm text-muted">
            Football, basket, hockey, handball, volley… Nous calculons la vraie chance de chaque sélection. Aucun pari
            pris, aucune mise gérée, aucun gain garanti.
          </p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <ButtonLink href="/coupons" size="lg" className="font-display text-base uppercase tracking-wide">
              ⚡ Générer
            </ButtonLink>
            <ButtonLink href="/coupons#analyser" variant="secondary" size="lg" className="font-display text-base uppercase tracking-wide">
              🔍 Analyser
            </ButtonLink>
          </div>
        </div>
      </section>

      {/* Codes rapides */}
      <section aria-labelledby="codes" className="space-y-2">
        <h2 id="codes" className="text-xs font-bold uppercase tracking-[0.18em] text-muted">
          Je veux un code de…
        </h2>
        <div className="grid grid-cols-4 gap-2">
          {QUICK_CODES.map((c) => (
            <Link
              key={c}
              href={`/coupons?cote=${c}`}
              className="group flex flex-col items-center rounded-xl border border-line bg-surface py-2.5 transition-colors hover:border-gold/60"
            >
              <span className="scoreboard text-3xl font-extrabold leading-none text-gold">{c}</span>
              <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted group-hover:text-ink">cote</span>
            </Link>
          ))}
        </div>
      </section>

      <HomeSports />

      {/* Comment ça marche */}
      <section aria-labelledby="comment" className="space-y-3">
        <h2 id="comment" className="font-display text-2xl font-extrabold uppercase">
          Comment ça marche
        </h2>
        <ol className="space-y-2">
          {STEPS.map((s) => (
            <li key={s.n} className="flex gap-3 rounded-(--radius-card) border border-line bg-surface p-3.5">
              <span className="scoreboard grid size-10 shrink-0 place-items-center rounded-xl bg-brand/12 text-2xl font-extrabold text-brand ring-1 ring-brand/30">
                {s.n}
              </span>
              <div>
                <h3 className="font-semibold">{s.title}</h3>
                <p className="text-sm text-muted">{s.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* Sports couverts */}
      <section aria-labelledby="sports" className="space-y-3">
        <h2 id="sports" className="font-display text-2xl font-extrabold uppercase">
          {ACTIVE_SPORTS.length} sports analysés
        </h2>
        <div className="grid grid-cols-4 gap-2">
          {ACTIVE_SPORTS.map((s) => (
            <div
              key={s.code}
              style={sportStyle(s.code)}
              className="flex flex-col items-center gap-1 rounded-xl border border-line bg-surface py-3 shadow-[inset_0_-2px_0_var(--sport)]"
            >
              <span className="text-2xl" aria-hidden>
                {s.emoji}
              </span>
              <span className="text-[11px] font-semibold">{s.shortName}</span>
            </div>
          ))}
        </div>
      </section>

      <Link href="/jeu-responsable" className="flex items-center gap-3 rounded-(--radius-card) border border-danger/30 bg-danger/5 p-4 text-sm">
        <ShieldIcon className="size-6 shrink-0 text-danger" />
        <span className="text-muted">
          <span className="font-semibold text-ink">Interdit aux moins de 18 ans.</span> Les paris sportifs peuvent entraîner
          une dépendance et des pertes d&apos;argent. Ne misez que ce que vous pouvez vous permettre de perdre.
        </span>
      </Link>
    </div>
  );
}
