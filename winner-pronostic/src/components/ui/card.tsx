import type { ComponentProps } from "react";
import { cn } from "@/lib/utils/cn";

export function Card({ className, ...props }: ComponentProps<"section">) {
  return <section className={cn("rounded-(--radius-card) border border-line bg-surface p-4", className)} {...props} />;
}
