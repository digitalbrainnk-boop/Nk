"use client";

import { useActionState } from "react";
import { Field, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { requestPasswordReset, updatePassword } from "@/lib/auth/actions";
import { initialFormState } from "@/lib/auth/form-state";
import { FormMessage } from "./form-message";

export function ResetRequestForm() {
  const [state, action] = useActionState(requestPasswordReset, initialFormState);
  if (state.status === "success") return <FormMessage state={state} />;
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormMessage state={state} />
      <Field label="Adresse e-mail du compte" name="email" error={state.fieldErrors?.email}>
        <Input name="email" type="email" inputMode="email" autoComplete="email" defaultValue={state.values?.email} invalid={Boolean(state.fieldErrors?.email)} required />
      </Field>
      <SubmitButton className="w-full" size="lg" pendingLabel="Envoi…">
        Recevoir le lien
      </SubmitButton>
    </form>
  );
}

export function NewPasswordForm() {
  const [state, action] = useActionState(updatePassword, initialFormState);
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormMessage state={state} />
      <Field label="Nouveau mot de passe" name="password" error={state.fieldErrors?.password} hint="8 caractères minimum, avec au moins une lettre et un chiffre.">
        <Input name="password" type="password" autoComplete="new-password" minLength={8} maxLength={72} invalid={Boolean(state.fieldErrors?.password)} required />
      </Field>
      <Field label="Confirmation" name="confirm" error={state.fieldErrors?.confirm}>
        <Input name="confirm" type="password" autoComplete="new-password" invalid={Boolean(state.fieldErrors?.confirm)} required />
      </Field>
      <SubmitButton className="w-full" size="lg" pendingLabel="Enregistrement…">
        Enregistrer
      </SubmitButton>
    </form>
  );
}
