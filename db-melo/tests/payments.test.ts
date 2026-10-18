import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ACTIVE_PLANS, CARD_CURRENCIES, COUNTRIES, CURRENCIES, guessCountry, OPERATORS, SONG_PRICES, validPhone } from "@/lib/constants";
import { formatPrice, toMinor } from "@/lib/pricing";
import { chariowSignature } from "@/lib/server/payments/chariow";
import { cinetpayToken } from "@/lib/server/payments/cinetpay";
import { fedapaySignature } from "@/lib/server/payments/fedapay";
import { paystackSignature } from "@/lib/server/payments/paystack";
import type { PaymentRecord, SongRecord } from "@/lib/types";

const KEYS = ["CHARIOW_API_KEY", "CHARIOW_PRODUCT_ID", "CHARIOW_PULSE_SECRET", "FEDAPAY_SECRET_KEY", "FEDAPAY_WEBHOOK_SECRET", "CINETPAY_API_KEY", "CINETPAY_SITE_ID", "CINETPAY_SECRET_KEY", "STRIPE_SECRET_KEY", "PAYSTACK_SECRET_KEY", "FLUTTERWAVE_SECRET_KEY", "ALLOW_DEMO_PAYMENTS"];
const clearKeys = () => KEYS.forEach((k) => vi.stubEnv(k, ""));

describe("tarif", () => {
  it("une chanson coûte 1 200 FCFA, une seule offre en vente", () => {
    expect(SONG_PRICES.XOF).toBe(1200);
    expect(SONG_PRICES.XAF).toBe(1200);
    expect(ACTIVE_PLANS.map((p) => p.id)).toEqual(["essentiel"]);
    expect(formatPrice(1200, "XOF").replace(/\s/g, " ")).toBe("1 200 FCFA");
    expect(formatPrice(SONG_PRICES.EUR, "EUR").replace(/\s/g, " ")).toBe("1,80 €");
  });
  it("a un prix pour chaque devise, multiple de 5 pour CinetPay", () => {
    for (const c of Object.keys(CURRENCIES) as (keyof typeof CURRENCIES)[]) expect(SONG_PRICES[c]).toBeGreaterThan(0);
    for (const c of ["XOF", "XAF", "GNF", "CDF"] as const) expect(SONG_PRICES[c] % 5).toBe(0);
  });
  it("convertit en plus petite unité", () => {
    expect(toMinor(1000, "XOF")).toBe(1000);
    expect(toMinor(1.5, "EUR")).toBe(150);
  });
});

describe("pays d'Afrique", () => {
  it("couvre les 54 pays, sans doublon", () => {
    expect(COUNTRIES).toHaveLength(54);
    expect(new Set(COUNTRIES.map((c) => c.code)).size).toBe(54);
    for (const c of COUNTRIES) {
      expect(c.flag).toHaveLength(4); // deux symboles régionaux
      expect(c.dial).toMatch(/^\d{2,3}$/);
      if (c.momo) {
        expect(SONG_PRICES[c.momo.currency]).toBeGreaterThan(0);
        for (const o of c.momo.operators) expect(OPERATORS[o]).toBeDefined();
      }
    }
  });
  it("devine le pays d'après le fuseau horaire", () => {
    expect(guessCountry("Africa/Ouagadougou")).toBe("BF");
    expect(guessCountry("Africa/Lagos")).toBe("NG");
    expect(guessCountry("Africa/Nairobi")).toBe("KE");
    expect(guessCountry("Europe/Paris")).toBeNull();
  });
  it("valide les numéros nationaux", () => {
    const bf = COUNTRIES.find((c) => c.code === "BF")!;
    expect(validPhone(bf, "70123456")).toBe(true);
    expect(validPhone(bf, "7012345")).toBe(false);
    const ng = COUNTRIES.find((c) => c.code === "NG")!;
    expect(validPhone(ng, "8031234567")).toBe(true);
  });
});

describe("signatures des webhooks", () => {
  it("CinetPay : HMAC-SHA256 des champs concaténés", () => {
    const f = new URLSearchParams({ cpm_site_id: "123", cpm_trans_id: "DBMX", cpm_amount: "1000", cpm_currency: "XOF" });
    expect(cinetpayToken(f, "secret")).toBe(createHmac("sha256", "secret").update("123DBMX1000XOF").digest("hex"));
  });
  it("Paystack : HMAC-SHA512 du corps brut", () => {
    expect(paystackSignature('{"a":1}', "sk")).toBe(createHmac("sha512", "sk").update('{"a":1}').digest("hex"));
  });
  it("Flutterwave : refuse un webhook sans le bon secret", async () => {
    vi.stubEnv("FLUTTERWAVE_WEBHOOK_HASH", "mon-secret");
    const { flutterwave } = await import("@/lib/server/payments/flutterwave");
    const body = JSON.stringify({ event: "charge.completed", data: { tx_ref: "DBMABC12345", status: "successful" } });
    await expect(flutterwave.parseWebhook(new Request("http://x", { method: "POST", headers: { "verif-hash": "faux" } }), body)).rejects.toThrow();
    const ok = await flutterwave.parseWebhook(new Request("http://x", { method: "POST", headers: { "verif-hash": "mon-secret" } }), body);
    expect(ok).toEqual({ reference: "DBMABC12345", claimedStatus: "paid" });
    vi.unstubAllEnvs();
  });
});

describe("choix de la passerelle selon le pays", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("CinetPay en zone francophone, Flutterwave au Ghana et au Kenya, carte partout", async () => {
    clearKeys();
    vi.stubEnv("CINETPAY_API_KEY", "k");
    vi.stubEnv("CINETPAY_SITE_ID", "s");
    vi.stubEnv("CINETPAY_SECRET_KEY", "x");
    vi.stubEnv("FLUTTERWAVE_SECRET_KEY", "FLWSECK_TEST");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_123");
    const { paymentOptions } = await import("@/lib/server/payments");
    const o = paymentOptions(null);
    expect(o.mobileMoney.BF).toBe("cinetpay");
    expect(o.mobileMoney.CD).toBe("cinetpay");
    expect(o.mobileMoney.GH).toBe("flutterwave");
    expect(o.mobileMoney.KE).toBe("flutterwave");
    expect(o.mobileMoney.NG).toBeUndefined(); // carte bancaire
    expect(o.card?.provider).toBe("stripe");
    expect(o.card?.currencies).toEqual(CARD_CURRENCIES);
    expect(o.demo).toBe(false);
  });

  it("sans clé : rien en production, démo pour une chanson de démonstration", async () => {
    clearKeys();
    const { paymentOptions } = await import("@/lib/server/payments");
    expect(paymentOptions(null).card).toBeNull();
    expect(Object.keys(paymentOptions(null).mobileMoney)).toHaveLength(0);
    const demo = paymentOptions({ demo: true } as SongRecord);
    expect(demo.card?.provider).toBe("demo");
    expect(demo.mobileMoney.CI).toBe("demo");
  });
});

describe("FedaPay", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const signed = (body: string, secret: string, t = Math.floor(Date.now() / 1000)) =>
    new Request("http://x", { method: "POST", headers: { "x-fedapay-signature": `t=${t},s=${fedapaySignature(t, body, secret)}` } });

  it("vérifie la signature des webhooks et retrouve la référence", async () => {
    clearKeys();
    vi.stubEnv("FEDAPAY_SECRET_KEY", "sk_sandbox_x");
    vi.stubEnv("FEDAPAY_WEBHOOK_SECRET", "wh_sandbox_secret");
    const { fedapay } = await import("@/lib/server/payments/fedapay");
    const body = JSON.stringify({ name: "transaction.approved", entity: { id: 7, status: "approved", custom_metadata: { reference: "DBMFEDA1234" } } });
    expect(await fedapay.parseWebhook(signed(body, "wh_sandbox_secret"), body)).toEqual({ reference: "DBMFEDA1234", claimedStatus: "paid" });
    await expect(fedapay.parseWebhook(signed(body, "autre-secret"), body)).rejects.toThrow(/Signature/);
    await expect(fedapay.parseWebhook(signed(body, "wh_sandbox_secret", 1_000_000), body)).rejects.toThrow(/Signature/);
    // Sans métadonnées : la référence est relue dans l'adresse de retour.
    const sansMeta = JSON.stringify({ name: "transaction.declined", entity: { id: 8, callback_url: "https://dbmelo.com/api/payments/return?ref=DBMFEDA5678" } });
    expect(await fedapay.parseWebhook(signed(sansMeta, "wh_sandbox_secret"), sansMeta)).toEqual({ reference: "DBMFEDA5678", claimedStatus: "pending" });
  });

  it("encaisse le Mobile Money en zone FCFA de l'Ouest et la carte partout", async () => {
    clearKeys();
    vi.stubEnv("FEDAPAY_SECRET_KEY", "sk_live_x");
    const { paymentOptions } = await import("@/lib/server/payments");
    const o = paymentOptions(null);
    for (const c of ["BF", "BJ", "TG", "CI", "SN", "NE", "ML"]) expect(o.mobileMoney[c]).toBe("fedapay");
    expect(o.mobileMoney.CM).toBeUndefined(); // FCFA d'Afrique centrale : carte
    expect(o.card).toEqual({ provider: "fedapay", currencies: ["XOF"] });
  });

  it("crée la transaction puis la page de paiement (bac à sable avec une clé de test)", async () => {
    clearKeys();
    vi.stubEnv("FEDAPAY_SECRET_KEY", "sk_sandbox_x");
    const calls: { url: string; body?: Record<string, unknown> }[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, body });
      if (url.endsWith("/transactions") && body?.customer?.phone_number) return Response.json({ message: "Numéro invalide" }, { status: 422 });
      if (url.endsWith("/transactions")) return Response.json({ "v1/transaction": { id: 42, status: "pending", amount: 1000 } });
      return Response.json({ token: "TOK", url: "https://process.fedapay.com/TOK" });
    });
    const { fedapay } = await import("@/lib/server/payments/fedapay");
    const session = await fedapay.createCheckout({
      reference: "DBMFEDA0001",
      song: { id: "s1", config: { title: "Maman Awa" } } as SongRecord,
      plan: "essentiel",
      amount: 1000,
      currency: "XOF",
      method: "mobile_money",
      operator: "orange_money",
      country: "BF",
      phone: "70123456",
      returnUrl: "https://dbmelo.com/api/payments/return?ref=DBMFEDA0001",
      notifyUrl: "https://dbmelo.com/api/payments/webhooks/fedapay",
      cancelUrl: "https://dbmelo.com/chanson/s1",
    });
    expect(session).toEqual({ redirectUrl: "https://process.fedapay.com/TOK", providerRef: "42" });
    expect(calls.map((c) => c.url)).toEqual([
      "https://sandbox-api.fedapay.com/v1/transactions",
      "https://sandbox-api.fedapay.com/v1/transactions",
      "https://sandbox-api.fedapay.com/v1/transactions/42/token",
    ]);
    expect(calls[0].body).toMatchObject({ amount: 1000, currency: { iso: "XOF" }, customer: { phone_number: { number: "+22670123456", country: "bf" } } });
    expect(calls[1].body?.customer).not.toHaveProperty("phone_number");
  });

  it("ne valide que les transactions approuvées", async () => {
    clearKeys();
    vi.stubEnv("FEDAPAY_SECRET_KEY", "sk_live_x");
    let status = "approved";
    vi.stubGlobal("fetch", async (url: string) => {
      expect(url).toBe("https://api.fedapay.com/v1/transactions/42");
      return Response.json({ "v1/transaction": { id: 42, status, amount: 1000 } });
    });
    const { fedapay } = await import("@/lib/server/payments/fedapay");
    const payment = { providerRef: "42" } as PaymentRecord;
    expect(await fedapay.verify(payment)).toMatchObject({ status: "paid", amount: 1000 });
    status = "declined";
    expect((await fedapay.verify(payment)).status).toBe("failed");
    status = "pending";
    expect((await fedapay.verify(payment)).status).toBe("pending");
    expect((await fedapay.verify({} as PaymentRecord)).status).toBe("pending");
  });
});

describe("Chariow", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const configure = () => {
    clearKeys();
    vi.stubEnv("CHARIOW_API_KEY", "sk_live_test");
    vi.stubEnv("CHARIOW_PRODUCT_ID", "prd_chanson");
  };
  const input = (over: Record<string, unknown> = {}) => ({
    reference: "DBMCHAR0001",
    song: { id: "s1", config: { title: "Maman Awa" } } as SongRecord,
    plan: "essentiel" as const,
    amount: 1000,
    currency: "XOF" as const,
    method: "mobile_money" as const,
    country: "BF",
    phone: "70123456",
    customerIp: "102.180.1.20",
    returnUrl: "https://dbmelo.com/api/payments/return?ref=DBMCHAR0001",
    notifyUrl: "https://dbmelo.com/api/payments/webhooks/chariow",
    cancelUrl: "https://dbmelo.com/chanson/s1",
    ...over,
  });

  it("vérifie la signature des Pulses et retrouve la référence", async () => {
    configure();
    vi.stubEnv("CHARIOW_PULSE_SECRET", "whsec_test");
    const { chariow } = await import("@/lib/server/payments/chariow");
    const body = JSON.stringify({ event: "successful.sale", sale: { id: "sal_1", custom_metadata: { reference: "DBMCHAR0001" } } });
    const req = (sig: string) => new Request("http://x", { method: "POST", headers: { "x-chariow-signature": sig } });
    expect(await chariow.parseWebhook(req(chariowSignature(body, "whsec_test")), body)).toEqual({ reference: "DBMCHAR0001", claimedStatus: "paid" });
    await expect(chariow.parseWebhook(req(chariowSignature(body, "autre")), body)).rejects.toThrow(/Signature/);
    const license = JSON.stringify({ event: "license.issued", license: {} });
    expect(await chariow.parseWebhook(req(chariowSignature(license, "whsec_test")), license)).toBeNull();
  });

  it("passe avant les autres passerelles, Mobile Money en zone FCFA de l'Ouest et carte partout", async () => {
    configure();
    vi.stubEnv("FEDAPAY_SECRET_KEY", "sk_live_x");
    const { paymentOptions } = await import("@/lib/server/payments");
    const o = paymentOptions(null);
    for (const c of ["BF", "BJ", "TG", "CI", "SN", "NE", "ML"]) expect(o.mobileMoney[c]).toBe("chariow");
    expect(o.card).toEqual({ provider: "chariow", currencies: ["XOF"] });
  });

  it("ouvre une vente sur le produit configuré, avec l'IP et la référence du client", async () => {
    configure();
    vi.stubEnv("MERCHANT_EMAIL", "");
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://api.chariow.com/v1/checkout");
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer sk_live_test");
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      if (body.phone.country_code === "BF") return Response.json({ message: "Invalid", errors: { "phone.country_code": ["invalide"] } }, { status: 422 });
      return Response.json({ message: "ok", data: { step: "payment", purchase: { id: "sal_42", status: "awaiting_payment" }, payment: { checkout_url: "https://pay.chariow.com/sal_42", transaction_id: "t1" } } });
    });
    const { chariow } = await import("@/lib/server/payments/chariow");
    expect(await chariow.createCheckout(input())).toEqual({ redirectUrl: "https://pay.chariow.com/sal_42", providerRef: "sal_42" });
    expect(bodies[0]).toMatchObject({
      product_id: "prd_chanson",
      email: "dbmelox@gmail.com",
      phone: { number: "70123456", country_code: "BF" },
      payment_currency: "XOF",
      redirect_url: "https://dbmelo.com/api/payments/return?ref=DBMCHAR0001",
      custom_metadata: { reference: "DBMCHAR0001", song_id: "s1" },
      customer_ip: "102.180.1.20",
    });
    expect(bodies[1].phone).toEqual({ number: "70123456", country_code: "+226" });
  });

  it("refuse un produit qui ne peut être acheté qu'une fois", async () => {
    configure();
    vi.stubGlobal("fetch", async () => Response.json({ data: { step: "already_purchased", message: "Already owned" } }));
    const { chariow } = await import("@/lib/server/payments/chariow");
    await expect(chariow.createCheckout(input({ reference: "DBMCHAR0002" }))).rejects.toThrow(/Licence/);
  });

  it("valide la vente terminée au prix d'origine, en ménageant l'API", async () => {
    configure();
    let status = "completed";
    let calls = 0;
    vi.stubGlobal("fetch", async (url: string) => {
      calls++;
      return Response.json({ data: { id: url.split("/").pop(), status, amount: { value: 940, currency: "XOF" }, original_amount: { value: 1000, currency: "XOF" } } });
    });
    const { chariow } = await import("@/lib/server/payments/chariow");
    const payment = { providerRef: "sal_paid", currency: "XOF" } as PaymentRecord;
    expect(await chariow.verify(payment)).toMatchObject({ status: "paid", amount: 1000, currency: "XOF" });
    await chariow.verify(payment);
    expect(calls).toBe(1); // deuxième vérification servie par le cache
    status = "abandoned";
    expect((await chariow.verify({ providerRef: "sal_abandon", currency: "XOF" } as PaymentRecord)).status).toBe("failed");
    status = "awaiting_payment";
    expect((await chariow.verify({ providerRef: "sal_attente", currency: "XOF" } as PaymentRecord)).status).toBe("pending");
  });
});
