import type { Metadata } from "next";
import { Suspense } from "react";
import { KeyGenerator } from "@/components/admin/key-generator";
import { PageHeader } from "@/components/layout/page-header";
import { CopyButton } from "@/components/ui/copy-button";
import { requireAdmin } from "@/lib/auth/dal";
import { getPublicEnv } from "@/lib/env";

export const metadata: Metadata = { title: "Outils · Admin", robots: { index: false } };

async function Content() {
  await requireAdmin();
  const site = getPublicEnv().NEXT_PUBLIC_SITE_URL;
  const sql = `-- 1. Database → Extensions : activez « pg_cron » et « pg_net »
-- 2. Remplacez VOTRE_CRON_SECRET par la valeur de CRON_SECRET (Vercel), puis exécutez :
select vault.create_secret('VOTRE_CRON_SECRET', 'winner_cron_secret');

select cron.schedule('winner-frequent', '*/2 * * * *', $$
  select net.http_get(
    url := '${site}/api/cron/frequent',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'winner_cron_secret')),
    timeout_milliseconds := 60000
  );
$$);`;
  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h2 className="font-display text-xl font-extrabold uppercase">Clés secrètes</h2>
        <KeyGenerator />
      </section>
      <section className="space-y-2">
        <h2 className="font-display text-xl font-extrabold uppercase">Direct toutes les 2 minutes</h2>
        <p className="text-xs text-muted">
          L&apos;offre gratuite de Vercel ne lance les tâches planifiées qu&apos;une fois par jour. Pour le direct, les buts et les
          notifications, Supabase appelle l&apos;application toutes les 2 minutes : copiez ce SQL dans Supabase → SQL Editor.
        </p>
        <div className="rounded-xl border border-line bg-surface p-3">
          <div className="mb-2 flex justify-end">
            <CopyButton text={sql} label="Copier le SQL" />
          </div>
          <pre className="overflow-x-auto whitespace-pre-wrap break-all text-[11px] text-muted">{sql}</pre>
        </div>
      </section>
    </div>
  );
}

export default function AdminToolsPage() {
  return (
    <>
      <PageHeader kicker="Admin" title="Outils" />
      <Suspense fallback={<div className="h-40 animate-pulse rounded-(--radius-card) bg-surface" aria-hidden />}>
        <Content />
      </Suspense>
    </>
  );
}
