import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AuthCard, FormSkeleton } from "@/components/auth/auth-card";
import { LoginForms } from "@/components/auth/login-forms";
import { Alert } from "@/components/ui/alert";
import { safeNextPath } from "@/lib/security/safe-redirect";

export const metadata: Metadata = { title: "Connexion" };

const ERRORS: Record<string, string> = {
  lien: "Ce lien n'est plus valide (déjà utilisé ou expiré). Connectez-vous ou demandez-en un nouveau.",
};

async function LoginContent({ searchParams }: { searchParams: PageProps<"/connexion">["searchParams"] }) {
  const params = await searchParams;
  const next = safeNextPath(params.suivant, "/compte");
  const errorKey = typeof params.erreur === "string" ? params.erreur : undefined;
  return (
    <>
      {errorKey && ERRORS[errorKey] ? (
        <Alert tone="error" className="mb-4">
          {ERRORS[errorKey]}
        </Alert>
      ) : null}
      <LoginForms next={next} />
    </>
  );
}

export default function LoginPage(props: PageProps<"/connexion">) {
  return (
    <AuthCard
      title="Connexion"
      subtitle="Retrouvez vos pronostics, coupons et équipes favorites."
      footer={
        <>
          Pas encore de compte ?{" "}
          <Link href="/inscription" className="font-semibold text-brand hover:underline">
            Créer un compte gratuit
          </Link>
        </>
      }
    >
      <Suspense fallback={<FormSkeleton fields={1} />}>
        <LoginContent searchParams={props.searchParams} />
      </Suspense>
    </AuthCard>
  );
}
