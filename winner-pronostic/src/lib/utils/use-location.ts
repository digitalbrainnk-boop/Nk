"use client";

import { useSyncExternalStore } from "react";

function subscribe(callback: () => void) {
  window.addEventListener("popstate", callback);
  window.addEventListener("hashchange", callback);
  return () => {
    window.removeEventListener("popstate", callback);
    window.removeEventListener("hashchange", callback);
  };
}

/** Lit window.location.search / hash sans casser l'hydratation (vide côté serveur). */
export function useLocationPart(part: "search" | "hash"): string {
  return useSyncExternalStore(
    subscribe,
    () => window.location[part],
    () => "",
  );
}
