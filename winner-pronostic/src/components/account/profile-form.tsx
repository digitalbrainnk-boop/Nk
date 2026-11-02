"use client";

import { useActionState } from "react";
import { CountrySelect } from "@/components/auth/country-select";
import { FormMessage } from "@/components/auth/form-message";
import { Field, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { updateProfile } from "@/lib/auth/actions";
import { initialFormState } from "@/lib/auth/form-state";

export function ProfileForm({ displayName, country }: { displayName: string; country: string }) {
  const [state, action] = useActionState(updateProfile, initialFormState);
  const v = state.values ?? {};
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormMessage state={state} />
      <Field label="Nom ou pseudo" name="displayName" error={state.fieldErrors?.displayName}>
        <Input name="displayName" maxLength={50} defaultValue={v.displayName ?? displayName} invalid={Boolean(state.fieldErrors?.displayName)} required />
      </Field>
      <Field label="Pays" name="country" error={state.fieldErrors?.country}>
        <CountrySelect defaultValue={v.country ?? country} />
      </Field>
      <SubmitButton variant="secondary" pendingLabel="Enregistrement…">
        Enregistrer
      </SubmitButton>
    </form>
  );
}
