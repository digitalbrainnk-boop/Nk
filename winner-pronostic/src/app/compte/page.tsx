import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ProfileForm } from "@/components/account/profile-form";
import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ShieldIcon } from "@/components/ui/icons";
import { signOut } from "@/lib/auth/actions";
import { getCurrentProfile } from "@/lib/auth/dal";
import { formatLongDate } from "@/lib/format/date";
import { formatPhoneForDisplay } from "@/lib/validation/phone";

export const metadata: Metadata = { title: "Mon compte", robots: { index: false } };

async function AccountContent({ searchParams }: { searchParams: PageProps<"/compte">["searchParams"] }) {
  const params = await searchParams;
  const profile = await getCurrentProfile();
  if (!profile) redirect("/connexion?suivant=/compte");

  const contact = profile.email ?? (profile.phone ? formatPhoneForDisplay(`+${profile.phone.replace(/^\+/, "")}`) : "—");

  return (
    <div className="space-y-4">
      {params["mot-de-passe"] === "modifie" ? <Alert tone="success">Votre mot de passe a été modifié.</Alert> : null}

      <Card>
        <div className="flex items-center gap-3">
          <span className="grid size-12 place-items-center rounded-full bg-surface-3 text-lg font-bold ring-1 ring-line">
            {profile.display_name.charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="truncate font-bold">{profile.display_name}</p>
            <p className="truncate text-sm text-muted">{contact}</p>
            <p className="text-xs text-faint">Membre depuis le {formatLongDate(profile.created_at)}</p>
          </div>
        </div>
      </Card>

      <Card>
        <h2 className="text-sm font-bold uppercase tracking-wide text-muted">Mon offre</h2>
        {profile.isPremium ? (
          <p className="mt-2 font-semibold text-gold">Premium actif — tous les pronostics et coupons illimités.</p>
        ) : (
          <>
            <p className="mt-2">
              Offre <span className="font-semibold">gratuite</span> : quelques pronostics par jour.
            </p>
            <p className="mt-1 text-sm text-muted">
              L&apos;abonnement Premium par Orange Money et Moov Money arrive bientôt.
            </p>
          </>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-muted">Mes informations</h2>
        <ProfileForm displayName={profile.display_name} country={profile.country_code} />
      </Card>

      <Card className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wide text-muted">Sécurité</h2>
        {profile.email ? (
          <Link href="/nouveau-mot-de-passe" className={buttonClasses("secondary", "sm")}>
            Changer mon mot de passe
          </Link>
        ) : (
          <p className="text-sm text-muted">Vous vous connectez avec un code reçu par SMS : aucun mot de passe à retenir.</p>
        )}
        {profile.isAdmin ? (
          <Link href="/admin" className={buttonClasses("secondary", "sm", "ml-2")}>
            Espace administrateur
          </Link>
        ) : null}
      </Card>

      <Link href="/jeu-responsable" className="flex items-center gap-3 rounded-(--radius-card) border border-line bg-surface p-4 text-sm hover:bg-surface-2">
        <ShieldIcon className="size-6 shrink-0 text-brand" />
        <span>
          <span className="block font-semibold">Jeu responsable</span>
          <span className="text-muted">Conseils et aide si le jeu devient un problème.</span>
        </span>
      </Link>

      <form action={signOut}>
        <Button type="submit" variant="danger" className="w-full">
          Se déconnecter
        </Button>
      </form>
    </div>
  );
}

function AccountSkeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      {[80, 96, 200].map((h) => (
        <div key={h} className="animate-pulse rounded-(--radius-card) bg-surface" style={{ height: h }} />
      ))}
    </div>
  );
}

export default function AccountPage(props: PageProps<"/compte">) {
  return (
    <>
      <PageHeader title="Mon compte" />
      <Suspense fallback={<AccountSkeleton />}>
        <AccountContent searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}
