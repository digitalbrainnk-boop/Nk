"use client";

import { useActionState } from "react";
import { Field, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { resendPhoneOtp, verifyPhoneOtp } from "@/lib/auth/actions";
import { initialFormState } from "@/lib/auth/form-state";
import { FormMessage } from "./form-message";

export function OtpForm({ phone, next }: { phone: string; next: string }) {
  const [state, action] = useActionState(verifyPhoneOtp, initialFormState);
  const [resendState, resendAction] = useActionState(resendPhoneOtp, initialFormState);

  return (
    <div className="space-y-5">
      <form action={action} className="space-y-4" noValidate>
        <FormMessage state={state} />
        <input type="hidden" name="phone" value={phone} />
        <input type="hidden" name="suivant" value={next} />
        <Field label="Code reçu par SMS" name="token" error={state.fieldErrors?.token}>
          <Input
            name="token"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            placeholder="••••••"
            className="text-center text-2xl font-bold tracking-[0.5em]"
            invalid={Boolean(state.fieldErrors?.token)}
            autoFocus
            required
          />
        </Field>
        <SubmitButton className="w-full" size="lg" pendingLabel="Vérification…">
          Valider
        </SubmitButton>
      </form>

      <form action={resendAction} className="border-t border-line pt-4 text-center">
        <FormMessage state={resendState} />
        <input type="hidden" name="phone" value={phone} />
        <p className="mb-2 text-sm text-muted">Pas reçu de code après une minute ?</p>
        <SubmitButton variant="secondary" size="sm" pendingLabel="Envoi…">
          Renvoyer le code
        </SubmitButton>
      </form>
    </div>
  );
}
