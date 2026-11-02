"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Field, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { signInWithEmail, signInWithPhone } from "@/lib/auth/actions";
import { initialFormState } from "@/lib/auth/form-state";
import { CountrySelect } from "./country-select";
import { FormMessage } from "./form-message";
import { MethodTabs } from "./method-tabs";

function PhoneLoginForm({ next }: { next: string }) {
  const [state, action] = useActionState(signInWithPhone, initialFormState);
  const v = state.values ?? {};
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="suivant" value={next} />
      <Field label="Numéro de téléphone" name="phone" error={state.fieldErrors?.phone} hint="Vous recevrez un code à 6 chiffres par SMS.">
        <div className="flex gap-2">
          <CountrySelect withDialCode defaultValue={v.country} className="w-32 shrink-0" ariaLabel="Indicatif du pays" />
          <Input
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            placeholder="70 12 34 56"
            defaultValue={v.phone}
            invalid={Boolean(state.fieldErrors?.phone)}
            required
          />
        </div>
      </Field>
      <SubmitButton className="w-full" size="lg" pendingLabel="Envoi du code…">
        Recevoir mon code
      </SubmitButton>
    </form>
  );
}

function EmailLoginForm({ next }: { next: string }) {
  const [state, action] = useActionState(signInWithEmail, initialFormState);
  const v = state.values ?? {};
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="suivant" value={next} />
      <Field label="Adresse e-mail" name="email" error={state.fieldErrors?.email}>
        <Input
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="vous@exemple.com"
          defaultValue={v.email}
          invalid={Boolean(state.fieldErrors?.email)}
          required
        />
      </Field>
      <Field label="Mot de passe" name="password" error={state.fieldErrors?.password}>
        <Input name="password" type="password" autoComplete="current-password" invalid={Boolean(state.fieldErrors?.password)} required />
      </Field>
      <div className="-mt-1 text-right">
        <Link href="/mot-de-passe-oublie" className="text-sm font-medium text-brand hover:underline">
          Mot de passe oublié ?
        </Link>
      </div>
      <SubmitButton className="w-full" size="lg" pendingLabel="Connexion…">
        Se connecter
      </SubmitButton>
    </form>
  );
}

export function LoginForms({ next }: { next: string }) {
  return <MethodTabs phone={<PhoneLoginForm next={next} />} email={<EmailLoginForm next={next} />} />;
}
