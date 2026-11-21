"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const random = (n: number) => b64url(crypto.getRandomValues(new Uint8Array(n)));

type Keys = { cron: string; salt: string; vapidPublic: string; vapidPrivate: string };

/**
 * Génère les secrets DANS le navigateur (rien n'est envoyé au serveur) :
 * à copier dans les variables d'environnement de Vercel.
 */
export function KeyGenerator() {
  const [keys, setKeys] = useState<Keys | null>(null);

  async function generate() {
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const publicRaw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
    const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
    setKeys({ cron: random(32), salt: random(24), vapidPublic: b64url(publicRaw), vapidPrivate: privateJwk.d ?? "" });
  }

  const rows: [string, keyof Keys][] = [
    ["CRON_SECRET", "cron"],
    ["RATE_LIMIT_SALT", "salt"],
    ["NEXT_PUBLIC_VAPID_PUBLIC_KEY", "vapidPublic"],
    ["VAPID_PRIVATE_KEY", "vapidPrivate"],
  ];

  return (
    <div className="space-y-3">
      <Button onClick={generate}>🔑 Générer de nouvelles clés</Button>
      {keys ? (
        <ul className="space-y-2">
          {rows.map(([name, k]) => (
            <li key={name} className="rounded-xl border border-line bg-surface p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold">{name}</span>
                <CopyButton text={keys[k]} />
              </div>
              <code className="mt-1 block break-all text-[11px] text-muted">{keys[k]}</code>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="text-xs text-warning">
        Ces valeurs sont secrètes (sauf la clé publique VAPID) : collez-les uniquement dans Vercel, Settings → Environment Variables,
        puis redéployez. Ne les envoyez à personne.
      </p>
    </div>
  );
}
