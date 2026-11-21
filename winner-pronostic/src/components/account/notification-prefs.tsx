"use client";

import { useActionState } from "react";
import { FormMessage } from "@/components/auth/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/auth/form-state";
import { updateNotificationPrefs } from "@/lib/notifications/actions";

export function NotificationPrefs({ kickoff, goals, lead }: { kickoff: boolean; goals: boolean; lead: number }) {
  const [state, action] = useActionState(updateNotificationPrefs, initialFormState);
  return (
    <form action={action} className="space-y-3 text-sm">
      <FormMessage state={state} />
      <label className="flex items-center gap-3">
        <input type="checkbox" name="notifyKickoff" defaultChecked={kickoff} className="size-5 accent-[var(--color-brand)]" />
        Avant le coup d&apos;envoi de mes équipes
      </label>
      <label className="flex items-center gap-3">
        <input type="checkbox" name="notifyGoals" defaultChecked={goals} className="size-5 accent-[var(--color-brand)]" />
        À chaque but / changement de score
      </label>
      <label className="flex items-center gap-2">
        Prévenir
        <select name="lead" defaultValue={String(lead)} className="h-9 rounded-lg border border-line bg-surface-2 px-2">
          {[15, 30, 60, 120].map((m) => (
            <option key={m} value={m}>
              {m} min
            </option>
          ))}
        </select>
        avant le match
      </label>
      <SubmitButton size="sm" variant="secondary" pendingLabel="Enregistrement…">
        Enregistrer
      </SubmitButton>
    </form>
  );
}
