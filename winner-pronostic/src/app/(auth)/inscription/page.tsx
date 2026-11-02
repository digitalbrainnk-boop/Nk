import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AuthCard, FormSkeleton } from "@/components/auth/auth-card";
import { SignupForms } from "@/components/auth/signup-forms";
import { safeNextPath } from "@/lib/security/safe-redirect";
import { latestAllowedBirthDate } from "@/lib/validation/age";

export const metadata: Metadata = { title: "Créer un compte" };

async function SignupContent({ searchParams }: { searchParams: PageProps<"/inscription">["searchParams"] }) {
  const params = await searchParams;
  return <SignupForms next={safeNextPath(params.suivant, "/compte")} maxBirthDate={latestAllowedBirthDate()} />;
}

export default function SignupPage(props: PageProps<"/inscription">) {
  return (
    <AuthCard
      title="Créer un compte"
      subtitle="Gratuit, réservé aux 18 ans et plus."
      footer={
        <>
          Déjà inscrit ?{" "}
          <Link href="/connexion" className="font-semibold text-brand hover:underline">
            Se connecter
          </Link>
        </>
      }
    >
      <Suspense fallback={<FormSkeleton fields={4} />}>
        <SignupContent searchParams={props.searchParams} />
      </Suspense>
    </AuthCard>
  );
}
