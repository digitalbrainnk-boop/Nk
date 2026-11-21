"use client";

import { useActionState, type ReactNode } from "react";
import { Alert } from "@/components/ui/alert";
import type { AdminResult } from "@/lib/admin/actions";

/** Formulaire d'administration avec message de résultat. */
export function ActionForm({
  action,
  children,
  className,
}: {
  action: (prev: AdminResult | null, formData: FormData) => Promise<AdminResult>;
  children: ReactNode;
  className?: string;
}) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction} className={className}>
      {state ? (
        <Alert tone={state.ok ? "success" : "error"} className="mb-3">
          {state.message}
        </Alert>
      ) : null}
      {children}
    </form>
  );
}
