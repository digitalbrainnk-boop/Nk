import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ACTIVE_PLANS, CARD_CURRENCIES, COUNTRIES, CURRENCIES, guessCountry, OPERATORS, SONG_PRICES, validPhone } from "@/lib/constants";
import { formatPrice, toMinor } from "@/lib/pricing";
import { cinetpayToken } from "@/lib/server/payments/cinetpay";
import { paystackSignature } from "@/lib/server/payments/paystack";
import type { SongRecord } from "@/lib/types";

const KEYS = ["CINETPAY_API_KEY", "CINETPAY_SITE_ID", "CINETPAY_SECRET_KEY", "STRIPE_SECRET_KEY", "PAYSTACK_SECRET_KEY", "FLUTTERWAVE_SECRET_KEY", "ALLOW_DEMO_PAYMENTS"];
const clearKeys = () => KEYS.forEach((k) => vi.stubEnv(k, ""));

describe("tarif", () => {
  it("une chanson coûte 1 000 FCFA, une seule offre en vente", () => {
    expect(SONG_PRICES.XOF).toBe(1000);
    expect(SONG_PRICES.XAF).toBe(1000);
    expect(ACTIVE_PLANS.map((p) => p.id)).toEqual(["essentiel"]);
    expect(formatPrice(1000, "XOF").replace(/\s/g, " ")).toBe("1 000 FCFA");
    expect(formatPrice(1.5, "EUR").replace(/\s/g, " ")).toBe("1,50 €");
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
