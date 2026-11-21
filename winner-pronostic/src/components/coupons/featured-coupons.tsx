import { CouponTicket } from "@/components/coupons/coupon-ticket";
import { featuredCoupons } from "@/lib/data/coupons";

/** Coupons du jour publiés par l'équipe, avec leur code de chargement. */
export async function FeaturedCoupons() {
  const coupons = await featuredCoupons({ limit: 3 });
  if (!coupons.length) return null;
  return (
    <section className="space-y-3">
      <h2 className="font-display text-2xl font-extrabold uppercase">🔥 Coupons du jour</h2>
      {coupons.map((c) => (
        <CouponTicket key={c.id} title={c.title} legs={c.legs} totalOdds={c.totalOdds} probability={c.probability} bookingCodes={c.bookingCodes} />
      ))}
    </section>
  );
}
