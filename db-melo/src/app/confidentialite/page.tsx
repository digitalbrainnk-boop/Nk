import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, LegalSection, sellerLine } from "@/components/legal/LegalPage";
import { BRAND } from "@/lib/constants";
import { config } from "@/lib/server/env";

export const metadata: Metadata = { title: "Politique de confidentialité" };
export const dynamic = "force-dynamic";

export default function Confidentialite() {
  const m = config.merchant();
  return (
    <LegalPage eyebrow="Informations légales" title="Politique de confidentialité">
      <LegalSection title="Responsable">
        <p>Les données sont traitées par {sellerLine(m)}, éditeur de {BRAND.name}.</p>
      </LegalSection>

      <LegalSection title="Données collectées">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Le contenu de la chanson : titre, paroles, prénoms, souvenirs, dédicace, choix de voix et de style.</li>
          <li>Si vous les ajoutez : une photo pour la pochette et un extrait audio de référence.</li>
          <li>Pour le paiement : pays, numéro Mobile Money, nom et e-mail, transmis au prestataire de paiement.</li>
          <li>Des données techniques (adresse IP) utilisées pour limiter les abus.</li>
        </ul>
      </LegalSection>

      <LegalSection title="Utilisation">
        <p>
          Ces données servent uniquement à écrire et composer votre chanson, à encaisser et vérifier le paiement, à vous livrer la chanson et à répondre à vos
          demandes. Elles ne sont ni vendues ni utilisées pour de la publicité.
        </p>
      </LegalSection>

      <LegalSection title="Partenaires">
        <p>
          Le contenu de la chanson est transmis aux services d&apos;intelligence artificielle qui la réalisent (génération de paroles, de musique et
          d&apos;images, via Kie.ai). Les informations de paiement sont transmises au prestataire choisi (Chariow, FedaPay, CinetPay, Flutterwave, Paystack ou Stripe), qui
          applique sa propre politique de confidentialité. {BRAND.name} ne conserve aucune donnée bancaire.
        </p>
      </LegalSection>

      <LegalSection title="Durée de conservation">
        <p>
          Les chansons et leurs informations sont conservées pour que vous puissiez les réécouter et les télécharger, puis supprimées sur simple demande. Les
          informations de paiement sont conservées le temps exigé par les obligations comptables.
        </p>
      </LegalSection>

      <LegalSection title="Sur votre téléphone">
        <p>
          {BRAND.name} n&apos;utilise pas de cookies publicitaires. Votre navigateur garde seulement la liste de vos chansons (« Mes chansons ») et les
          fichiers nécessaires au fonctionnement hors ligne de l&apos;application.
        </p>
      </LegalSection>

      <LegalSection title="Vos droits">
        <p>
          Vous pouvez demander l&apos;accès, la correction ou la suppression de vos données à tout moment en nous écrivant depuis la page{" "}
          <Link href="/contact" className="text-gold underline">
            Contact
          </Link>
          .
        </p>
      </LegalSection>
    </LegalPage>
  );
}
