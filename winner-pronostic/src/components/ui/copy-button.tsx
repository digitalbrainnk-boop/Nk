"use client";

import { useState } from "react";
import { cn } from "@/lib/utils/cn";
import { buttonClasses } from "./button";

/** Copie un texte dans le presse-papiers (avec repli pour les vieux navigateurs Android). */
export function CopyButton({
  text,
  label = "Copier",
  copiedLabel = "Copié !",
  variant = "secondary",
  size = "sm",
  className,
}: {
  text: string;
  label?: string;
  copiedLabel?: string;
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <button type="button" onClick={copy} className={cn(buttonClasses(variant, size), className)} aria-live="polite">
      {copied ? `✓ ${copiedLabel}` : label}
    </button>
  );
}
