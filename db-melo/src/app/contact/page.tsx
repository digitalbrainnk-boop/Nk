import { Mail, MapPin, MessageCircle, Phone } from "lucide-react";
import type { Metadata } from "next";
import { LegalPage, LegalSection } from "@/components/legal/LegalPage";
import { BRAND } from "@/lib/constants";
import { config } from "@/lib/server/env";

export const metadata: Metadata = { title: "Contact et mentions légales" };
export const dynamic = "force-dynamic";

export default function Contact() {
  const m = config.merchant();
  const whatsapp = m.whatsapp.replace(/\D/g, "");
  const phone = m.phone.replace(/\D/g, "");
  return (
    <LegalPage eyebrow="Nous écrire" title="Contact et mentions légales">
      <LegalSection title="Une question sur votre chanson ?">
        <p>Donnez-nous le lien de votre chanson ou la référence de votre paiement : nous répondons sous 72 heures ouvrées.</p>
        <ul className="mt-4 space-y-3 text-cream">
          {m.email && (
            <li>
              <a href={`mailto:${m.email}`} className="flex items-center gap-3 hover:text-gold">
                <Mail className="size-5 text-gold" /> {m.email}
              </a>
            </li>
          )}
          {whatsapp && (
            <li>
              <a href={`https://wa.me/${whatsapp}`} className="flex items-center gap-3 hover:text-gold">
                <MessageCircle className="size-5 text-gold" /> WhatsApp : {m.whatsapp}
              </a>
            </li>
          )}
          {phone && (
            <li>
              <a href={`tel:+${phone}`} className="flex items-center gap-3 hover:text-gold">
                <Phone className="size-5 text-gold" /> Téléphone : {m.phone}
              </a>
            </li>
          )}
          {m.address && (
            <li className="flex items-center gap-3">
              <MapPin className="size-5 text-gold" /> {m.address}
            </li>
          )}
        </ul>
      </LegalSection>

      <LegalSection title="Mentions légales">
        <p>
          Éditeur : {m.name || BRAND.name}
          {m.registration && <> — {m.registration}</>}
          {m.address && <> — {m.address}</>}
        </p>
        {m.email && <p>Directeur de la publication : {m.name || BRAND.name}, joignable à {m.email}.</p>}
        {m.host && <p>Hébergeur : {m.host}</p>}
      </LegalSection>
    </LegalPage>
  );
}
