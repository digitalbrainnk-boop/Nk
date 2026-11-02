"use client";

import { useState, type ReactNode } from "react";
import { MailIcon, PhoneIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils/cn";

export type AuthMethod = "telephone" | "email";

/** Onglets « Téléphone / E-mail ». Le téléphone est proposé en premier (usage majoritaire en Afrique de l'Ouest). */
export function MethodTabs({
  initial = "telephone",
  phone,
  email,
}: {
  initial?: AuthMethod;
  phone: ReactNode;
  email: ReactNode;
}) {
  const [method, setMethod] = useState<AuthMethod>(initial);
  const tabs: { id: AuthMethod; label: string; Icon: typeof PhoneIcon }[] = [
    { id: "telephone", label: "Téléphone", Icon: PhoneIcon },
    { id: "email", label: "E-mail", Icon: MailIcon },
  ];

  return (
    <div>
      <div role="tablist" aria-label="Méthode" className="mb-5 grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1">
        {tabs.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`tab-${id}`}
            aria-selected={method === id}
            aria-controls={`panel-${id}`}
            onClick={() => setMethod(id)}
            className={cn(
              "flex h-10 items-center justify-center gap-2 rounded-lg text-sm font-semibold transition-colors",
              method === id ? "bg-surface-3 text-ink shadow-sm" : "text-muted hover:text-ink",
            )}
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${method}`} aria-labelledby={`tab-${method}`}>
        {method === "telephone" ? phone : email}
      </div>
    </div>
  );
}
