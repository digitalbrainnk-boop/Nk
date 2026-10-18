import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, LegalSection, sellerLine } from "@/components/legal/LegalPage";
import { BRAND, SONG_PRICES } from "@/lib/constants";
import { formatPrice } from "@/lib/pricing";
import { config } from "@/lib/server/env";

export const metadata: Metadata = { title: "Conditions générales de vente" };
// Les coordonnées du vendeur viennent de la configuration du serveur.
export const dynamic = "force-dynamic";

export default function Conditions() {
  const m = config.merchant();
  const price = formatPrice(SONG_PRICES.XOF, "XOF");
  return (
    <LegalPage eyebrow="Informations légales" title="Conditions générales de vente">
      <LegalSection title="1. Le service">
        <p>
          {BRAND.name} est un service en ligne de création de chansons personnalisées, édité par {sellerLine(m)}. Le client fournit ses paroles ou les
          informations nécessaires à leur écriture (prénoms, occasion, souvenirs), choisit une voix et un style ; la musique, le chant et, le cas échéant, les
          paroles sont générés par intelligence artificielle.
        </p>
      </LegalSection>

      <LegalSection title="2. Prix">
        <p>
          Une chanson coûte {price} toutes taxes comprises, ou l&apos;équivalent affiché dans la monnaie du client avant le paiement. Elle est livrée en deux
          versions. Le prix applicable est celui affiché au moment de la commande.
        </p>
      </LegalSection>

      <LegalSection title="3. Commande et paiement">
        <p>
          Le client relit et corrige gratuitement ses paroles, puis paie avant la composition, par Mobile Money ou par carte bancaire, auprès d&apos;un
          prestataire de paiement agréé (Chariow, FedaPay, CinetPay, Flutterwave, Paystack ou Stripe selon le pays). {BRAND.name} ne reçoit ni ne conserve aucune donnée
          bancaire ou code Mobile Money. La commande est ferme dès la confirmation du paiement par le prestataire.
        </p>
      </LegalSection>

      <LegalSection title="4. Composition et livraison">
        <p>
          La composition démarre automatiquement dès la confirmation du paiement et dure généralement de 1 à 5 minutes. La chanson est ensuite disponible
          sur sa page : écoute, téléchargement en MP3 sans filigrane et page cadeau à partager. Le client conserve le lien de sa chanson pour la retrouver.
        </p>
      </LegalSection>

      <LegalSection title="5. Échec technique et remboursement">
        <p>
          Si la composition échoue, le client peut la relancer gratuitement jusqu&apos;à {config.maxAttempts()} fois depuis la page de sa chanson. Si aucune
          chanson ne peut être livrée, le client est remboursé sur simple demande adressée au contact ci-dessous, dans un délai de 14 jours.
        </p>
        <p>
          La chanson étant un contenu numérique personnalisé, réalisé à la demande du client et livré dès le paiement, elle ne peut être ni échangée ni
          remboursée une fois livrée, sauf défaut technique empêchant son écoute ou son téléchargement.
        </p>
      </LegalSection>

      <LegalSection title="6. Nature du résultat">
        <p>
          La musique est générée par intelligence artificielle : chaque chanson est unique et son interprétation peut s&apos;écarter des attentes du client
          (prononciation d&apos;un prénom, arrangement…). Les deux versions livrées permettent de choisir celle qui convient le mieux.
        </p>
      </LegalSection>

      <LegalSection title="7. Contenus fournis par le client">
        <p>
          Le client garantit disposer des droits sur les textes, photos et extraits audio qu&apos;il fournit, et s&apos;interdit tout contenu illicite,
          haineux, diffamatoire ou portant atteinte à la vie privée ou aux droits d&apos;autrui. {BRAND.name} peut refuser ou interrompre une commande qui ne
          respecte pas ces règles ; elle est alors remboursée.
        </p>
      </LegalSection>

      <LegalSection title="8. Utilisation de la chanson">
        <p>
          Le client peut écouter, offrir, partager et diffuser sa chanson dans un cadre personnel : fêtes, cérémonies, messageries et réseaux sociaux. Toute
          exploitation commerciale (vente, diffusion publicitaire, plateformes de streaming) nécessite l&apos;accord préalable de {BRAND.name}.
        </p>
      </LegalSection>

      <LegalSection title="9. Données personnelles">
        <p>
          Le traitement des données du client est décrit dans la{" "}
          <Link href="/confidentialite" className="text-gold underline">
            politique de confidentialité
          </Link>
          .
        </p>
      </LegalSection>

      <LegalSection title="10. Réclamations et droit applicable">
        <p>
          Toute réclamation s&apos;adresse au{" "}
          <Link href="/contact" className="text-gold underline">
            contact
          </Link>{" "}
          de {BRAND.name} ; nous répondons sous 72 heures ouvrées. Les présentes conditions sont soumises au droit du pays d&apos;établissement de
          l&apos;éditeur{m.address ? ` (${m.address})` : ""}. À défaut d&apos;accord amiable, les tribunaux compétents de ce pays seront saisis.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
