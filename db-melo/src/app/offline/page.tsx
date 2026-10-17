import Link from "next/link";

export const metadata = { title: "Hors ligne" };

export default function Offline() {
  return (
    <section className="mx-auto max-w-md px-4 py-24 text-center">
      <p className="eyebrow">Hors ligne</p>
      <h1 className="mt-3 font-display text-3xl font-bold">Pas de connexion pour le moment</h1>
      <p className="mt-4 text-muted">Vos chansons déjà téléchargées restent dans l&apos;application Fichiers de votre téléphone. Reconnectez-vous pour continuer.</p>
      <Link href="/" className="btn btn-gold mt-8">
        Réessayer
      </Link>
    </section>
  );
}
