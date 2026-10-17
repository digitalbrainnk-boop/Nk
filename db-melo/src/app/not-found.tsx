import Link from "next/link";

export default function NotFound() {
  return (
    <section className="mx-auto max-w-md px-4 py-24 text-center">
      <p className="eyebrow">404</p>
      <h1 className="mt-3 font-display text-3xl font-bold">Cette page s&apos;est envolée</h1>
      <p className="mt-4 text-muted">Le lien est peut-être incomplet. Vérifiez-le ou créez une nouvelle chanson.</p>
      <Link href="/" className="btn btn-gold mt-8">
        Retour à l&apos;accueil
      </Link>
    </section>
  );
}
