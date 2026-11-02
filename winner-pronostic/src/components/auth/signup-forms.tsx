"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Field, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { signUpWithEmail, signUpWithPhone } from "@/lib/auth/actions";
import { type FormState, initialFormState } from "@/lib/auth/form-state";
import { MIN_AGE } from "@/lib/constants";
import { CountrySelect } from "./country-select";
import { FormMessage } from "./form-message";
import { MethodTabs } from "./method-tabs";

/** Champs communs : nom, date de naissance (18+), acceptation des conditions. */
function CommonFields({ state, maxBirthDate, position }: { state: FormState; maxBirthDate: string; position: "top" | "bottom" }) {
  const v = state.values ?? {};
  const e = state.fieldErrors ?? {};
  if (position === "top") {
    return (
      <Field label="Nom ou pseudo" name="displayName" error={e.displayName}>
        <Input name="displayName" autoComplete="nickname" placeholder="Ex. Awa" maxLength={50} defaultValue={v.displayName} invalid={Boolean(e.displayName)} required />
      </Field>
    );
  }
  return (
    <>
      <Field label="Date de naissance" name="birthDate" error={e.birthDate} hint={`Winner Pronostic est réservé aux personnes de ${MIN_AGE} ans et plus.`}>
        <Input name="birthDate" type="date" max={maxBirthDate} min="1900-01-01" autoComplete="bday" defaultValue={v.birthDate} invalid={Boolean(e.birthDate)} required />
      </Field>
      <div className="space-y-1.5">
        <label className="flex items-start gap-3 text-sm leading-snug text-muted">
          <input
            type="checkbox"
            name="terms"
            defaultChecked={v.terms === "on"}
            className="mt-0.5 size-5 shrink-0 accent-[var(--color-brand)]"
            aria-invalid={Boolean(e.terms) || undefined}
            required
          />
          <span>
            J&apos;ai {MIN_AGE} ans ou plus et j&apos;accepte les{" "}
            <Link href="/conditions" className="font-medium text-brand underline" target="_blank">
              conditions d&apos;utilisation
            </Link>
            . Je comprends que Winner Pronostic est un outil d&apos;analyse qui ne prend aucun pari et ne garantit aucun gain.
          </span>
        </label>
        {e.terms ? (
          <p className="text-xs font-medium text-danger" role="alert">
            {e.terms}
          </p>
        ) : null}
      </div>
    </>
  );
}

function PhoneSignupForm({ next, maxBirthDate }: { next: string; maxBirthDate: string }) {
  const [state, action] = useActionState(signUpWithPhone, initialFormState);
  const v = state.values ?? {};
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="suivant" value={next} />
      <CommonFields state={state} maxBirthDate={maxBirthDate} position="top" />
      <Field label="Numéro de téléphone" name="phone" error={state.fieldErrors?.phone} hint="Un code de confirmation vous sera envoyé par SMS.">
        <div className="flex gap-2">
          <CountrySelect withDialCode defaultValue={v.country} className="w-32 shrink-0" ariaLabel="Indicatif du pays" />
          <Input name="phone" type="tel" inputMode="tel" autoComplete="tel-national" placeholder="70 12 34 56" defaultValue={v.phone} invalid={Boolean(state.fieldErrors?.phone)} required />
        </div>
      </Field>
      <CommonFields state={state} maxBirthDate={maxBirthDate} position="bottom" />
      <SubmitButton className="w-full" size="lg" pendingLabel="Envoi du code…">
        Créer mon compte
      </SubmitButton>
    </form>
  );
}

function EmailSignupForm({ next, maxBirthDate }: { next: string; maxBirthDate: string }) {
  const [state, action] = useActionState(signUpWithEmail, initialFormState);
  const v = state.values ?? {};
  const e = state.fieldErrors ?? {};

  if (state.status === "success") {
    return <FormMessage state={state} />;
  }

  return (
    <form action={action} className="space-y-4" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="suivant" value={next} />
      <CommonFields state={state} maxBirthDate={maxBirthDate} position="top" />
      <Field label="Adresse e-mail" name="email" error={e.email}>
        <Input name="email" type="email" inputMode="email" autoComplete="email" placeholder="vous@exemple.com" defaultValue={v.email} invalid={Boolean(e.email)} required />
      </Field>
      <Field label="Mot de passe" name="password" error={e.password} hint="8 caractères minimum, avec au moins une lettre et un chiffre.">
        <Input name="password" type="password" autoComplete="new-password" minLength={8} maxLength={72} invalid={Boolean(e.password)} required />
      </Field>
      <Field label="Pays" name="country" error={e.country}>
        <CountrySelect defaultValue={v.country} invalid={Boolean(e.country)} />
      </Field>
      <CommonFields state={state} maxBirthDate={maxBirthDate} position="bottom" />
      <SubmitButton className="w-full" size="lg" pendingLabel="Création du compte…">
        Créer mon compte
      </SubmitButton>
    </form>
  );
}

export function SignupForms({ next, maxBirthDate }: { next: string; maxBirthDate: string }) {
  return (
    <MethodTabs
      phone={<PhoneSignupForm next={next} maxBirthDate={maxBirthDate} />}
      email={<EmailSignupForm next={next} maxBirthDate={maxBirthDate} />}
    />
  );
}
