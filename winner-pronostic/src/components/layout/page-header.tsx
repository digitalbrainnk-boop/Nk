import type { ReactNode } from "react";

export function PageHeader({ title, subtitle, action, kicker }: { title: string; subtitle?: ReactNode; action?: ReactNode; kicker?: string }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-3">
      <div>
        {kicker ? <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-brand">{kicker}</p> : null}
        <h1 className="font-display text-3xl font-extrabold uppercase leading-none tracking-tight">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-muted">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}
