import type { Metadata } from "next";
import { Suspense } from "react";
import { CouponsTabs } from "@/components/coupons/coupons-tabs";
import { FeaturedCoupons } from "@/components/coupons/featured-coupons";
import { PageHeader } from "@/components/layout/page-header";

export const metadata: Metadata = {
  title: "Générer un code ou analyser un coupon",
  description: "Choisissez votre cote (code de 2, 5, 10…) et votre niveau de risque, ou faites analyser votre coupon.",
};

export default function CouponsPage() {
  return (
    <>
      <PageHeader kicker="Coupons" title="Mon code" subtitle="Multi-sports · chance réelle affichée · aucun gain garanti." />
      <div className="space-y-8">
        <CouponsTabs />
        <Suspense fallback={null}>
          <FeaturedCoupons />
        </Suspense>
      </div>
    </>
  );
}
