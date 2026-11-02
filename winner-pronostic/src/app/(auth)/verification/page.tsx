import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AuthCard, FormSkeleton } from "@/components/auth/auth-card";
import { OtpForm } from "@/components/auth/otp-form";
import { safeNextPath } from "@/lib/security/safe-redirect";
import { maskPhone } from "@/lib/validation/phone";

export const metadata: Metadata = { title: "Code de vérification", robots: { index: false } };

async function VerificationContent({ searchParams }: { searchParams: PageProps<"/verification">["searchParams"] }) {
  const params = await searchParams;
  const phone = typeof params.telephone === "string" ? params.telephone : "";
  if (!/^\+\d{8,15}$/.test(phone)) redirect("/connexion");
  const next = safeNextPath(params.suivant, "/compte");
  return (
    <>
      <p className="mb-4 text-sm text-muted">
        Code envoyé au <span className="font-semibold text-ink">{maskPhone(phone)}</span>. Il est valable quelques minutes.
      </p>
      <OtpForm phone={phone} next={next} />
    </>
  );
}

export default function VerificationPage(props: PageProps<"/verification">) {
  return (
    <AuthCard
      title="Vérification"
      subtitle="Saisissez le code à 6 chiffres reçu par SMS."
      footer={
        <Link href="/connexion" className="font-semibold text-brand hover:underline">
          Changer de numéro
        </Link>
      }
    >
      <Suspense fallback={<FormSkeleton fields={1} />}>
        <VerificationContent searchParams={props.searchParams} />
      </Suspense>
    </AuthCard>
  );
}
