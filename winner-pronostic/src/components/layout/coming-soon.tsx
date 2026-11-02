import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";

/** Section en construction (fonctionnalité livrée dans une phase ultérieure). */
export function ComingSoon({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="border-dashed text-center">
      <p className="text-xs font-bold uppercase tracking-wider text-brand">Bientôt disponible</p>
      <h2 className="mt-1 font-bold">{title}</h2>
      <div className="mx-auto mt-2 max-w-sm text-sm text-muted">{children}</div>
    </Card>
  );
}
