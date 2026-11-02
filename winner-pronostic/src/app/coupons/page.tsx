import type { Metadata } from "next";
import { ComingSoon } from "@/components/layout/coming-soon";
import { PageHeader } from "@/components/layout/page-header";

export const metadata: Metadata = { title: "Générateur de coupons" };

export default function CouponsPage() {
  return (
    <>
      <PageHeader title="Coupons" subtitle="Cote visée, niveau de risque et période." />
      <ComingSoon title="Générateur de coupons">
        Choisissez une cote totale (2, 5, 10…), un niveau de risque (prudent, équilibré, audacieux) et une période :
        l&apos;application affichera la probabilité réelle estimée du coupon. Livré en phase 4.
      </ComingSoon>
    </>
  );
}
