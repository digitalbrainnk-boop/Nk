import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard } from "@/components/auth/auth-card";
import { ResetRequestForm } from "@/components/auth/password-forms";

export const metadata: Metadata = { title: "Mot de passe oublié" };

export default function ForgotPasswordPage() {
  return (
    <AuthCard
      title="Mot de passe oublié"
      subtitle="Recevez un lien par e-mail pour choisir un nouveau mot de passe. Compte créé avec un numéro ? Connectez-vous simplement par SMS."
      footer={
        <Link href="/connexion" className="font-semibold text-brand hover:underline">
          Retour à la connexion
        </Link>
      }
    >
      <ResetRequestForm />
    </AuthCard>
  );
}
