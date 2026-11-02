import type { Metadata } from "next";
import { AuthCard } from "@/components/auth/auth-card";
import { NewPasswordForm } from "@/components/auth/password-forms";

export const metadata: Metadata = { title: "Nouveau mot de passe", robots: { index: false } };

/** Accessible uniquement connecté (vérifié par src/proxy.ts et dans l'action). */
export default function NewPasswordPage() {
  return (
    <AuthCard title="Nouveau mot de passe" subtitle="Choisissez un mot de passe que vous n'utilisez pas ailleurs.">
      <NewPasswordForm />
    </AuthCard>
  );
}
