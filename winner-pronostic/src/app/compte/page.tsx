import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { NotificationPrefs } from "@/components/account/notification-prefs";
import { ProfileForm } from "@/components/account/profile-form";
import { PushToggle } from "@/components/account/push-toggle";
import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ShieldIcon } from "@/components/ui/icons";
import { signOut } from "@/lib/auth/actions";
import { getCurrentProfile } from "@/lib/auth/dal";
import { formatLongDate } from "@/lib/format/date";
import { removeFavorite } from "@/lib/notifications/actions";
import { createClient } from "@/lib/supabase/server";
import { formatPhoneForDisplay } from "@/lib/validation/phone";

export const metadata: Metadata = { title: "Mon compte", robots: { index: false } };

async function AccountContent({ searchParams }: { searchParams: PageProps<"/compte">["searchParams"] }) {
  const params = await searchParams;
  const profile = await getCurrentProfile();
  if (!profile) redirect("/connexion?suivant=/compte");

  const contact = profile.email ?? (profile.phone ? formatPhoneForDisplay(`+${profile.phone.replace(/^\+/, "")}`) : "—");
  const supabase = await createClient();
  const [{ data: prefs }, { data: until }, { data: favorites }] = await Promise.all([
    supabase.from("profiles").select("notify_kickoff, notify_goals, kickoff_lead_minutes").eq("id", profile.id).maybeSingle(),
    supabase.rpc("premium_until"),
    supabase.from("favorite_teams").select("team_id, team:teams(name, sport)"),
  ]);
  const teams = (favorites ?? []) as unknown as { team_id: number; team: { name: string; sport: string } | null }[];

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
          <>
            <p className="mt-2 font-semibold text-gold">👑 Premium actif{until ? ` jusqu'au ${formatLongDate(until)}` : ""}.</p>
            <Link href="/premium" className={buttonClasses("secondary", "sm", "mt-3")}>
              Prolonger
            </Link>
          </>
        ) : (
          <>
            <p className="mt-2">
              Offre <span className="font-semibold">gratuite</span> : quelques pronostics et un code par jour.
            </p>
            <Link href="/premium" className={buttonClasses("primary", "sm", "mt-3")}>
              👑 Passer Premium (Orange Money, Moov Money)
            </Link>
          </>
        )}
      </Card>

      <Card className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wide text-muted">Notifications</h2>
        <PushToggle />
        <NotificationPrefs kickoff={prefs?.notify_kickoff ?? true} goals={prefs?.notify_goals ?? true} lead={prefs?.kickoff_lead_minutes ?? 30} />
      </Card>

      <Card>
        <h2 className="text-sm font-bold uppercase tracking-wide text-muted">Mes équipes</h2>
        {teams.length ? (
          <ul className="mt-2 divide-y divide-line/60">
            {teams.map((t) => (
              <li key={t.team_id} className="flex items-center justify-between py-2 text-sm">
                <span>★ {t.team?.name ?? "Équipe"}</span>
                <form action={removeFavorite.bind(null, t.team_id)}>
                  <button type="submit" className="text-xs text-muted hover:text-danger">
                    Retirer
                  </button>
                </form>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted">Suivez une équipe depuis la fiche d&apos;un match (bouton ☆ Suivre) pour recevoir ses alertes.</p>
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
