import type { ReactNode } from "react";

export function AuthCard({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="mx-auto max-w-md py-2">
      <div className="mb-5">
        <h1 className="font-display text-3xl font-extrabold uppercase tracking-tight">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-muted">{subtitle}</p> : null}
      </div>
      <div className="relative overflow-hidden rounded-(--radius-card) border border-line bg-surface p-4 sm:p-5">
        <span className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-brand via-gold to-info" aria-hidden />
        {children}
      </div>
      {footer ? <div className="mt-5 text-center text-sm text-muted">{footer}</div> : null}
    </div>
  );
}

export function FormSkeleton({ fields = 3 }: { fields?: number }) {
  return (
    <div className="space-y-4" aria-hidden>
      <div className="h-11 rounded-xl bg-surface-2" />
      {Array.from({ length: fields }, (_, i) => (
        <div key={i} className="space-y-2">
          <div className="h-3 w-24 rounded bg-surface-2" />
          <div className="h-12 rounded-xl bg-surface-2" />
        </div>
      ))}
      <div className="h-12 rounded-xl bg-surface-3" />
    </div>
  );
}
