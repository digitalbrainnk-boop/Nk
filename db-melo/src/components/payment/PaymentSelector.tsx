"use client";

// Paiement avant composition : pays (54 pays d'Afrique), Mobile Money dans la monnaie locale
// (Orange Money, Wave, MTN MoMo, Moov, Airtel, M-Pesa…) ou carte bancaire (Visa, Mastercard,
// Apple Pay, Google Pay). Le montant est toujours fixé par le serveur.
import { motion } from "framer-motion";
import { Check, CreditCard, Info, Loader, Lock, Smartphone } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { COUNTRIES, CURRENCIES, findCountry, guessCountry, OPERATORS, validPhone, type Plan } from "@/lib/constants";
import { formatPrice } from "@/lib/pricing";
import type { CountryCode, Currency, MobileOperator, PaymentMethod, PaymentOptions, PaymentProviderId, PlanId, PublicSong } from "@/lib/types";

// Apple Pay et Google Pay passent par Stripe uniquement.
const cardBrands = (provider?: PaymentProviderId) => (provider === "stripe" ? ["Visa", "Mastercard", "Apple Pay", "Google Pay"] : ["Visa", "Mastercard"]);
const PROVIDER_NAMES: Record<PaymentProviderId, string> = {
  chariow: "Chariow",
  fedapay: "FedaPay",
  cinetpay: "CinetPay",
  flutterwave: "Flutterwave",
  paystack: "Paystack",
  stripe: "Stripe",
  demo: "notre partenaire",
};

export function PaymentSelector({ song, title = "Finalisez votre chanson" }: { song: PublicSong; title?: string }) {
  const [options, setOptions] = useState<PaymentOptions | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [plan, setPlan] = useState<PlanId>("essentiel");
  const [country, setCountry] = useState<CountryCode>("CI");
  const [method, setMethod] = useState<PaymentMethod>("mobile_money");
  const [operator, setOperator] = useState<MobileOperator | null>(null);
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [cardCurrency, setCardCurrency] = useState<Currency>("XOF");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ options: PaymentOptions; plans: Plan[] }>(`/api/payments/options?songId=${song.id}`)
      .then(({ options, plans }) => {
        setOptions(options);
        setPlans(plans);
        if (plans[0]) setPlan(plans[0].id);
        const guessed = guessCountry(Intl.DateTimeFormat().resolvedOptions().timeZone);
        if (guessed) setCountry(guessed);
      })
      .catch((e: Error) => setError(e.message));
  }, [song.id]);

  const countryInfo = findCountry(country) ?? COUNTRIES[0];
  const momoProvider = options?.mobileMoney[country];
  const momoAvailable = !!momoProvider && !!countryInfo.momo;

  // À chaque changement de pays : Mobile Money s'il est pris en charge, sinon carte bancaire.
  useEffect(() => {
    if (!options) return;
    setMethod(momoAvailable || !options.card ? "mobile_money" : "card");
    setOperator((op) => (op && countryInfo.momo?.operators.includes(op) ? op : null));
  }, [options, country, momoAvailable, countryInfo]);

  useEffect(() => {
    if (options?.card && !options.card.currencies.includes(cardCurrency)) setCardCurrency(options.card.currencies[0]);
  }, [options, cardCurrency]);

  const selectedPlan = plans.find((p) => p.id === plan) ?? plans[0];
  const currency: Currency = method === "mobile_money" && countryInfo.momo ? countryInfo.momo.currency : cardCurrency;
  const amount = selectedPlan?.prices[currency];
  const provider = method === "mobile_money" ? momoProvider : options?.card?.provider;
  // Chariow demande un numéro de téléphone, même pour la carte.
  const needsPhone = method === "mobile_money" ? momoProvider !== "demo" : provider === "chariow";

  const phoneError = () =>
    countryInfo.digits
      ? `Le numéro doit comporter ${countryInfo.digits.join(" ou ")} chiffres (sans l'indicatif +${countryInfo.dial}).`
      : `Numéro invalide (sans l'indicatif +${countryInfo.dial}).`;

  const pay = async () => {
    setError(null);
    if (method === "mobile_money" && momoProvider !== "demo" && !operator) return setError("Choisissez votre opérateur Mobile Money.");
    if (needsPhone && !validPhone(countryInfo, phone)) return setError(phoneError());
    setBusy(true);
    try {
      const { redirectUrl } = await api<{ redirectUrl: string }>("/api/payments/checkout", {
        body: {
          songId: song.id,
          plan,
          method,
          country,
          currency: method === "card" ? cardCurrency : undefined,
          operator: method === "mobile_money" ? operator ?? undefined : undefined,
          phone: needsPhone && phone ? phone : undefined,
          email: email || undefined,
        },
      });
      window.location.assign(redirectUrl);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  if (!options || !selectedPlan) {
    return (
      <div className="card flex items-center justify-center gap-2 p-8 text-muted">
        {error ? <span className="text-danger">{error}</span> : <Loader className="size-5 animate-spin text-gold" />}
      </div>
    );
  }

  const nothingAvailable = !momoAvailable && !options.card;

  const phoneInput = (label: string) => (
    <>
      <label htmlFor="pay-phone" className="label">
        {label}
      </label>
      <div className="flex">
        <span className="flex items-center rounded-l-2xl border border-r-0 border-line bg-studio-2 px-3 text-sm text-muted">+{countryInfo.dial}</span>
        <input
          id="pay-phone"
          className="field rounded-l-none"
          inputMode="numeric"
          autoComplete="tel-national"
          value={phone}
          onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 12))}
          placeholder={"0".repeat(countryInfo.digits?.[0] ?? 9)}
        />
      </div>
    </>
  );

  return (
    <section className="card space-y-6 p-5 sm:p-7" aria-labelledby="pay-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="pay-title" className="font-display text-2xl font-bold">
          {title}
        </h2>
        {options.demo && <span className="rounded-full bg-violet-studio/20 px-3 py-1 text-xs font-semibold text-violet-200">Mode démo · aucun débit réel</span>}
      </div>

      <div className={plans.length > 1 ? "grid gap-3 sm:grid-cols-2" : ""} role={plans.length > 1 ? "radiogroup" : undefined} aria-label="Offre">
        {plans.map((p) => {
          const on = plan === p.id;
          return (
            <button
              key={p.id}
              type="button"
              role={plans.length > 1 ? "radio" : undefined}
              aria-checked={plans.length > 1 ? on : undefined}
              onClick={() => setPlan(p.id)}
              className={`relative w-full rounded-3xl border p-5 text-left transition ${on ? "border-gold bg-gold/10" : "border-line bg-studio-2/60 hover:border-gold/40"}`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-display text-lg font-semibold">{p.name}</span>
                <span className="font-display text-3xl font-extrabold text-gold-soft">{formatPrice(p.prices[currency], currency)}</span>
              </div>
              <span className="block text-sm text-muted">{p.tagline}</span>
              <ul className="mt-3 grid gap-1.5 text-sm text-cream/85 sm:grid-cols-2">
                {p.features.map((f) => (
                  <li key={f} className="flex gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-gold" /> {f}
                  </li>
                ))}
              </ul>
            </button>
          );
        })}
      </div>

      <div>
        <label htmlFor="pay-country" className="label">
          Votre pays
        </label>
        <select id="pay-country" className="field" value={country} onChange={(e) => setCountry(e.target.value)}>
          {COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.flag} {c.label}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-1 rounded-2xl border border-line bg-ink/50 p-1" role="tablist" aria-label="Moyen de paiement">
        {(
          [
            { id: "mobile_money", label: "Mobile Money", icon: Smartphone, ok: momoAvailable },
            { id: "card", label: "Carte bancaire", icon: CreditCard, ok: !!options.card },
          ] as const
        ).map((m) => {
          const Icon = m.icon;
          const on = method === m.id;
          return (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={on}
              disabled={!m.ok}
              onClick={() => setMethod(m.id)}
              className={`relative flex min-h-12 items-center justify-center gap-2 rounded-xl text-sm font-semibold transition disabled:opacity-40 ${on ? "text-ink" : "text-muted hover:text-cream"}`}
            >
              {on && <motion.span layoutId="pay-tab" className="absolute inset-0 rounded-xl bg-linear-to-b from-gold-soft to-gold" />}
              <Icon className="relative size-4" />
              <span className="relative">{m.label}</span>
            </button>
          );
        })}
      </div>

      {!momoAvailable && options.card && (
        <p className="flex gap-2 rounded-2xl border border-line bg-studio-2/60 p-3 text-sm text-muted">
          <Info className="mt-0.5 size-4 shrink-0 text-gold" />
          Le Mobile Money n&apos;est pas encore pris en charge pour ce pays : payez par carte Visa ou Mastercard, votre banque convertit automatiquement.
        </p>
      )}
      {nothingAvailable && <p className="text-sm text-danger">Le paiement n&apos;est pas encore ouvert. Revenez très bientôt.</p>}

      {method === "mobile_money" && momoAvailable && countryInfo.momo && (
        <div className="space-y-4">
          <div>
            <span className="label">Opérateur</span>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Opérateur Mobile Money">
              {countryInfo.momo.operators.map((o) => {
                const info = OPERATORS[o];
                const on = operator === o;
                return (
                  <button
                    key={o}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setOperator(o)}
                    className={`flex min-h-14 items-center justify-center rounded-2xl border-2 px-2 text-center text-sm font-bold transition ${on ? "scale-[1.02] border-cream" : "border-transparent opacity-80 hover:opacity-100"}`}
                    style={{ background: info.color, color: info.text }}
                  >
                    {info.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            {phoneInput("Numéro Mobile Money")}
            <p className="mt-1.5 text-xs text-muted">
              Paiement en {CURRENCIES[countryInfo.momo.currency].label}. Vous validerez sur votre téléphone (code secret ou notification de l&apos;opérateur).
            </p>
          </div>
        </div>
      )}

      {method === "card" && options.card && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {cardBrands(options.card.provider).map((b) => (
              <span key={b} className="chip text-xs">
                {b}
              </span>
            ))}
          </div>
          {needsPhone && <div>{phoneInput("Numéro de téléphone")}</div>}
          {options.card.currencies.length > 1 && (
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Devise">
              {options.card.currencies.map((c) => (
                <button key={c} type="button" role="radio" aria-checked={cardCurrency === c} onClick={() => setCardCurrency(c)} className={`chip min-h-10 ${cardCurrency === c ? "chip-on" : ""}`}>
                  {formatPrice(selectedPlan.prices[c], c)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {!nothingAvailable && (
        <div>
          <label htmlFor="pay-email" className="label">
            E-mail pour le reçu <span className="font-normal text-muted">(recommandé)</span>
          </label>
          <input id="pay-email" type="email" inputMode="email" autoComplete="email" className="field" value={email} onChange={(e) => setEmail(e.target.value.trim())} placeholder="vous@exemple.com" />
        </div>
      )}

      {error && <p className="rounded-2xl border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{error}</p>}

      <button type="button" onClick={pay} disabled={busy || nothingAvailable || amount === undefined} className="btn btn-gold w-full text-base">
        {busy ? <Loader className="size-5 animate-spin" /> : <Lock className="size-5" />}
        {busy ? "Redirection vers le paiement sécurisé…" : `Payer ${formatPrice(amount ?? 0, currency)} et composer ma chanson`}
      </button>
      <p className="text-center text-xs text-muted">
        La composition démarre dès la confirmation du paiement (1 à 5 minutes), puis vous téléchargez votre chanson.
        <br />
        <Lock className="mr-1 inline size-3" />
        Paiement chiffré chez {provider ? PROVIDER_NAMES[provider] : "notre partenaire"} · vos coordonnées bancaires ne passent pas par DB.Mélo
        <br />
        En payant, vous acceptez nos{" "}
        <a href="/conditions" target="_blank" className="underline hover:text-cream">
          conditions générales de vente
        </a>
        .
      </p>
    </section>
  );
}
