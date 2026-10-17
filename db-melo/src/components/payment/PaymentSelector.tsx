"use client";

// Sélection du paiement : offre, devise, Mobile Money (Orange Money, Wave, MTN MoMo, Moov Money)
// ou carte bancaire (Visa, Mastercard, Apple Pay, Google Pay). Le montant est toujours fixé par le serveur.
import { motion } from "framer-motion";
import { Check, CreditCard, Loader, Lock, Smartphone } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/client/api";
import { COUNTRIES, CURRENCIES, OPERATORS, PLANS } from "@/lib/constants";
import { formatPrice, guessCurrency } from "@/lib/pricing";
import type { CountryCode, Currency, MobileOperator, PaymentMethod, PaymentOptions, PlanId, PublicSong } from "@/lib/types";

const CARD_BRANDS = ["Visa", "Mastercard", "Apple Pay", "Google Pay"];

export function PaymentSelector({ song, title = "Débloquez votre chanson" }: { song: PublicSong; title?: string }) {
  const [options, setOptions] = useState<PaymentOptions | null>(null);
  const [plan, setPlan] = useState<PlanId>("essentiel");
  const [currency, setCurrency] = useState<Currency>("XOF");
  const [method, setMethod] = useState<PaymentMethod>("mobile_money");
  const [country, setCountry] = useState<CountryCode>("CI");
  const [operator, setOperator] = useState<MobileOperator | null>(null);
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ options: PaymentOptions }>(`/api/payments/options?songId=${song.id}`)
      .then(({ options }) => {
        setOptions(options);
        const guessed = guessCurrency(Intl.DateTimeFormat().resolvedOptions().timeZone, navigator.language);
        setCurrency(guessed);
        if (!options.mobileMoney || guessed === "EUR" || guessed === "USD") setMethod(options.card ? "card" : "mobile_money");
        if (guessed === "XAF") setCountry("CM");
      })
      .catch((e: Error) => setError(e.message));
  }, [song.id]);

  const countryInfo = COUNTRIES.find((c) => c.code === country)!;
  const available = method === "mobile_money" ? options?.mobileMoney : options?.card;
  const operators = useMemo(
    () => countryInfo.operators.filter((o) => options?.mobileMoney?.operators.includes(o)),
    [countryInfo, options],
  );

  // En Mobile Money, la devise est celle du pays.
  useEffect(() => {
    if (method === "mobile_money") {
      setCurrency(countryInfo.currency);
      if (operator && !countryInfo.operators.includes(operator)) setOperator(null);
    }
  }, [method, countryInfo, operator]);

  const currencyOk = !!available?.currencies.includes(currency);
  const amount = PLANS[plan].prices[currency];
  const needsEmail = method === "card" && options?.card?.provider === "paystack";

  const pay = async () => {
    setError(null);
    if (method === "mobile_money" && options?.mobileMoney?.provider !== "demo") {
      if (!operator) return setError("Choisissez votre opérateur Mobile Money.");
      if (!countryInfo.digits.includes(phone.length)) return setError(`Le numéro doit comporter ${countryInfo.digits.join(" ou ")} chiffres (sans l'indicatif +${countryInfo.dial}).`);
    }
    if (needsEmail && !/^\S+@\S+\.\S+$/.test(email)) return setError("Indiquez votre adresse e-mail pour le reçu.");
    setBusy(true);
    try {
      const { redirectUrl } = await api<{ redirectUrl: string }>("/api/payments/checkout", {
        body: {
          songId: song.id,
          plan,
          currency,
          method,
          operator: method === "mobile_money" ? operator ?? undefined : undefined,
          country: method === "mobile_money" ? country : undefined,
          phone: method === "mobile_money" && phone ? phone : undefined,
          email: email || undefined,
        },
      });
      window.location.assign(redirectUrl);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  if (!options) {
    return (
      <div className="card flex items-center justify-center gap-2 p-8 text-muted">
        {error ? <span className="text-danger">{error}</span> : <Loader className="size-5 animate-spin text-gold" />}
      </div>
    );
  }

  return (
    <section className="card space-y-6 p-5 sm:p-7" aria-labelledby="pay-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="pay-title" className="font-display text-2xl font-bold">
          {title}
        </h2>
        {options.demo && <span className="rounded-full bg-violet-studio/20 px-3 py-1 text-xs font-semibold text-violet-200">Mode démo · aucun débit réel</span>}
      </div>

      <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Offre">
        {Object.values(PLANS).map((p) => {
          const on = plan === p.id;
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setPlan(p.id)}
              className={`relative rounded-3xl border p-5 text-left transition ${on ? "border-gold bg-gold/10 shadow-[0_0_0_1px_rgb(229_169_60/0.4)]" : "border-line bg-studio-2/60 hover:border-gold/40"}`}
            >
              {p.highlight && <span className="absolute -top-2.5 right-4 rounded-full bg-gold px-2.5 py-0.5 text-[11px] font-bold text-ink">Recommandé</span>}
              <span className="font-display text-lg font-semibold">{p.name}</span>
              <span className="block text-xs text-muted">{p.tagline}</span>
              <span className="mt-2 block font-display text-2xl font-bold text-gold-soft">{formatPrice(p.prices[currency], currency)}</span>
              <ul className="mt-3 space-y-1.5 text-sm text-cream/85">
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

      <div className="grid grid-cols-2 gap-1 rounded-2xl border border-line bg-ink/50 p-1" role="tablist" aria-label="Moyen de paiement">
        {(
          [
            { id: "mobile_money", label: "Mobile Money", icon: Smartphone, ok: !!options.mobileMoney },
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
              <span className="relative">{m.ok ? m.label : `${m.label} (bientôt)`}</span>
            </button>
          );
        })}
      </div>

      {method === "mobile_money" && options.mobileMoney && (
        <div className="space-y-4">
          <div>
            <label htmlFor="pay-country" className="label">
              Pays
            </label>
            <select id="pay-country" className="field" value={country} onChange={(e) => setCountry(e.target.value as CountryCode)}>
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.flag} {c.label} — {CURRENCIES[c.currency].label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <span className="label">Opérateur</span>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Opérateur Mobile Money">
              {operators.map((o) => {
                const info = OPERATORS[o];
                const on = operator === o;
                return (
                  <button
                    key={o}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setOperator(o)}
                    className={`flex min-h-14 items-center justify-center rounded-2xl border-2 px-2 text-sm font-bold transition ${on ? "border-cream scale-[1.02]" : "border-transparent opacity-80 hover:opacity-100"}`}
                    style={{ background: info.color, color: info.text }}
                  >
                    {info.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <label htmlFor="pay-phone" className="label">
              Numéro Mobile Money
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
                placeholder={"0".repeat(countryInfo.digits[0])}
              />
            </div>
            <p className="mt-1.5 text-xs text-muted">Vous validerez le paiement sur votre téléphone (code secret ou notification de l&apos;opérateur).</p>
          </div>
        </div>
      )}

      {method === "card" && options.card && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {CARD_BRANDS.map((b) => (
              <span key={b} className="chip text-xs">
                {b}
              </span>
            ))}
          </div>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Devise">
            {options.card.currencies.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={currency === c} onClick={() => setCurrency(c)} className={`chip min-h-10 ${currency === c ? "chip-on" : ""}`}>
                {CURRENCIES[c].label}
              </button>
            ))}
          </div>
          <div>
            <label htmlFor="pay-email" className="label">
              E-mail pour le reçu {needsEmail ? "*" : <span className="font-normal text-muted">(facultatif)</span>}
            </label>
            <input id="pay-email" type="email" inputMode="email" autoComplete="email" className="field" value={email} onChange={(e) => setEmail(e.target.value.trim())} placeholder="vous@exemple.com" />
          </div>
        </div>
      )}

      {!currencyOk && available && <p className="text-sm text-danger">Cette devise n&apos;est pas disponible pour ce moyen de paiement.</p>}
      {error && <p className="rounded-2xl border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{error}</p>}

      <button type="button" onClick={pay} disabled={busy || !available || !currencyOk} className="btn btn-gold w-full text-base">
        {busy ? <Loader className="size-5 animate-spin" /> : <Lock className="size-5" />}
        {busy ? "Redirection vers le paiement sécurisé…" : `Payer ${formatPrice(amount, currency)}`}
      </button>
      <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted">
        <Lock className="size-3.5" /> Paiement chiffré chez {available?.provider === "stripe" ? "Stripe" : available?.provider === "paystack" ? "Paystack" : available?.provider === "cinetpay" ? "CinetPay" : "notre partenaire"} · vos coordonnées ne passent pas par DB.Mélo
      </p>
    </section>
  );
}
