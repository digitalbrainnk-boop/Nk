"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="py-16 text-center">
      <h1 className="text-lg font-bold">Oups, un problème est survenu</h1>
      <p className="mt-1 text-sm text-muted">Vérifiez votre connexion internet puis réessayez.</p>
      <Button className="mt-6" onClick={() => retry()}>
        Réessayer
      </Button>
    </div>
  );
}
