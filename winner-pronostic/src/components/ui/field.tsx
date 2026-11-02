import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

const control =
  "block w-full rounded-xl border bg-surface-2 px-3.5 h-12 text-ink placeholder:text-faint transition-colors focus:border-brand focus:outline-none";

type FieldProps = {
  label: string;
  name: string;
  error?: string;
  hint?: ReactNode;
  children?: ReactNode;
};

/** Libellé + champ + aide + message d'erreur, avec les attributs d'accessibilité. */
export function Field({ label, name, error, hint, children }: FieldProps) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={name} className="block text-sm font-medium text-ink">
        {label}
      </label>
      {children}
      {hint && !error ? (
        <p id={`${name}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${name}-error`} className="text-xs font-medium text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function Input({ className, invalid, ...props }: ComponentProps<"input"> & { invalid?: boolean }) {
  return (
    <input
      id={props.id ?? props.name}
      aria-invalid={invalid || undefined}
      aria-describedby={invalid ? `${props.name}-error` : `${props.name}-hint`}
      className={cn(control, invalid ? "border-danger" : "border-line", className)}
      {...props}
    />
  );
}

export function Select({ className, invalid, ...props }: ComponentProps<"select"> & { invalid?: boolean }) {
  return (
    <select
      id={props.id ?? props.name}
      aria-invalid={invalid || undefined}
      className={cn(control, "appearance-none pr-8", invalid ? "border-danger" : "border-line", className)}
      {...props}
    />
  );
}
