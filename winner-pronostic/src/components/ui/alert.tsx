import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

type Tone = "info" | "success" | "error" | "warning";

const tones: Record<Tone, string> = {
  info: "border-info/30 bg-info/10 text-info",
  success: "border-brand/30 bg-brand/10 text-brand",
  error: "border-danger/30 bg-danger/10 text-danger",
  warning: "border-warning/30 bg-warning/10 text-warning",
};

export function Alert({ tone = "info", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn("rounded-xl border px-3.5 py-3 text-sm leading-relaxed", tones[tone], className)}
    >
      {children}
    </div>
  );
}
