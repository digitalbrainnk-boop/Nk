"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/submit-button";
import { type CheckoutState, startCheckout } from "@/lib/payments/actions";

export function CheckoutButton({ plan, label, highlight }: { plan: string; label: string; highlight?: boolean }) {
  const [state, action] = useActionState<CheckoutState, FormData>(startCheckout, { status: "idle" });
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="plan" value={plan} />
      <SubmitButton variant={highlight ? "primary" : "secondary"} size="lg" className="w-full font-display uppercase tracking-wide" pendingLabel="Redirection vers le paiement…">
        {label}
      </SubmitButton>
      {state.status === "error" ? <Alert tone="error">{state.message}</Alert> : null}
    </form>
  );
}
