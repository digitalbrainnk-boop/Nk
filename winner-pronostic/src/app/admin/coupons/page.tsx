import type { Metadata } from "next";
import { Suspense } from "react";
import { ActionForm } from "@/components/admin/action-form";
import { CouponTicket } from "@/components/coupons/coupon-ticket";
import { PageHeader } from "@/components/layout/page-header";
import { SubmitButton } from "@/components/ui/submit-button";
import { addBookingCode, createFeaturedCoupon, unfeatureCoupon } from "@/lib/admin/actions";
import { requireAdmin } from "@/lib/auth/dal";
import { DEFAULT_TIMEZONE } from "@/lib/constants";
import { featuredCoupons } from "@/lib/data/coupons";
import { startsInFuture, upcomingPicks } from "@/lib/data/picks";
import { getSport } from "@/lib/sports/catalog";

export const metadata: Metadata = { title: "Coupons du jour · Admin", robots: { index: false } };

const when = new Intl.DateTimeFormat("fr-FR", { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: DEFAULT_TIMEZONE });

async function Content() {
  await requireAdmin();
  const [{ picks }, coupons] = await Promise.all([upcomingPicks(48), featuredCoupons({ includeSettled: true, limit: 15 })]);
  const usable = picks.filter((p) => p.odd !== null && startsInFuture(p.startsAt));

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h2 className="font-display text-xl font-extrabold uppercase">Créer un coupon du jour</h2>
        <p className="text-xs text-muted">
          Cochez des pronostics publiés (une sélection par match). Ensuite, créez le même coupon sur 1xBet, cliquez sur « Enregistrer »
          et collez le code obtenu ci-dessous : les utilisateurs le copieront en un geste.
        </p>
        {usable.length ? (
          <ActionForm action={createFeaturedCoupon} className="space-y-3">
            <ul className="max-h-[28rem] divide-y divide-line/60 overflow-y-auto rounded-xl border border-line bg-surface">
              {usable.map((p) => (
                <li key={p.id}>
                  <label className="flex cursor-pointer items-start gap-3 px-3 py-2 text-sm">
                    <input type="checkbox" name="picks" value={p.id} className="mt-1 size-4" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs text-muted">
                        {getSport(p.sport).emoji} {p.competition} · {when.format(new Date(p.startsAt))}
                      </span>
                      <span className="block truncate font-semibold">
                        {p.home} – {p.away}
                      </span>
                      <span className="block truncate text-xs">
                        {p.label} · {Math.round(p.probability * 100)} % · conf. {p.confidence}/5
                      </span>
                    </span>
                    <span className="scoreboard text-lg font-extrabold">{p.odd?.toFixed(2)}</span>
                  </label>
                </li>
              ))}
            </ul>
            <input name="title" required minLength={3} maxLength={80} defaultValue="Coupon du jour" className="h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm" />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="premium" /> Réservé aux abonnés Premium
            </label>
            <SubmitButton pendingLabel="Création…">Créer et mettre en avant</SubmitButton>
          </ActionForm>
        ) : (
          <p className="rounded-xl border border-dashed border-line bg-surface p-3 text-sm text-muted">Aucun pronostic publié avec cote pour les prochaines 48 h.</p>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-xl font-extrabold uppercase">Coupons mis en avant</h2>
        {coupons.map((c) => (
          <div key={c.id} className="space-y-2">
            <CouponTicket title={`${c.title}${c.isPremium ? " 👑" : ""}`} legs={c.legs} totalOdds={c.totalOdds} probability={c.probability} bookingCodes={c.bookingCodes} />
            <ActionForm action={addBookingCode} className="flex flex-wrap items-end gap-2 rounded-xl border border-line bg-surface p-3">
              <input type="hidden" name="couponId" value={c.id} />
              <label className="text-xs">
                Bookmaker
                <select name="bookmaker" defaultValue="1xbet" className="mt-1 block h-9 rounded-lg border border-line bg-surface-2 px-2 text-sm">
                  <option value="1xbet">1xBet</option>
                  <option value="melbet">Melbet</option>
                  <option value="betwinner">Betwinner</option>
                  <option value="premierbet">Premier Bet</option>
                </select>
              </label>
              <label className="text-xs">
                Pays
                <input name="country" defaultValue="BF" maxLength={2} className="mt-1 block h-9 w-14 rounded-lg border border-line bg-surface-2 px-2 text-sm uppercase" />
              </label>
              <label className="min-w-0 flex-1 text-xs">
                Code de chargement
                <input name="code" required pattern="[A-Za-z0-9_\-]{3,32}" placeholder="ex. 7KX2M" className="mt-1 block h-9 w-full rounded-lg border border-line bg-surface-2 px-2 text-sm uppercase" />
              </label>
              <SubmitButton size="sm" pendingLabel="…">
                Publier le code
              </SubmitButton>
            </ActionForm>
            {c.status === "pending" ? (
              <form action={unfeatureCoupon.bind(null, c.id)}>
                <button className="text-xs text-muted underline hover:text-danger">Retirer de la mise en avant</button>
              </form>
            ) : (
              <p className="text-xs text-muted">Résultat : {c.status === "won" ? "✓ gagné" : c.status === "lost" ? "✗ perdu" : "remboursé"}</p>
            )}
          </div>
        ))}
        {!coupons.length ? <p className="text-sm text-muted">Aucun coupon mis en avant pour l&apos;instant.</p> : null}
      </section>
    </div>
  );
}

export default function AdminCouponsPage() {
  return (
    <>
      <PageHeader kicker="Admin" title="Coupons du jour" />
      <Suspense fallback={<div className="h-40 animate-pulse rounded-(--radius-card) bg-surface" aria-hidden />}>
        <Content />
      </Suspense>
    </>
  );
}
