import { ButtonLink } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="py-16 text-center">
      <p className="text-5xl font-black text-brand">404</p>
      <h1 className="mt-3 text-lg font-bold">Page introuvable</h1>
      <p className="mt-1 text-sm text-muted">Cette page n&apos;existe pas ou a été déplacée.</p>
      <ButtonLink href="/" className="mt-6">
        Retour aux matchs
      </ButtonLink>
    </div>
  );
}
