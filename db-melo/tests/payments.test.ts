import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatPrice, guessCurrency, priceOf, toMinor } from "@/lib/pricing";
import { cinetpayToken } from "@/lib/server/payments/cinetpay";
import { paystackSignature } from "@/lib/server/payments/paystack";

describe("tarifs", () => {
  it("formate les FCFA et les euros", () => {
    expect(formatPrice(9900, "XOF").replace(/\s/g, " ")).toBe("9 900 FCFA");
    expect(formatPrice(15, "EUR").replace(/\s/g, " ")).toBe("15,00 €");
  });
  it("convertit en plus petite unité", () => {
    expect(toMinor(9900, "XOF")).toBe(9900);
    expect(toMinor(15, "EUR")).toBe(1500);
  });
  it("garde des montants FCFA multiples de 5 (CinetPay)", () => {
    for (const plan of ["essentiel", "prestige"] as const) {
      expect(priceOf(plan, "XOF") % 5).toBe(0);
      expect(priceOf(plan, "XAF") % 5).toBe(0);
    }
  });
  it("devine la devise", () => {
    expect(guessCurrency("Africa/Abidjan")).toBe("XOF");
    expect(guessCurrency("Africa/Douala")).toBe("XAF");
    expect(guessCurrency("Europe/Paris")).toBe("EUR");
    expect(guessCurrency("America/New_York")).toBe("USD");
  });
});

describe("signatures des webhooks", () => {
  it("CinetPay : HMAC-SHA256 des champs concaténés", () => {
    const f = new URLSearchParams({ cpm_site_id: "123", cpm_trans_id: "DBMX", cpm_amount: "9900", cpm_currency: "XOF" });
    expect(cinetpayToken(f, "secret")).toBe(createHmac("sha256", "secret").update("123DBMX9900XOF").digest("hex"));
  });
  it("Paystack : HMAC-SHA512 du corps brut", () => {
    expect(paystackSignature('{"a":1}', "sk")).toBe(createHmac("sha512", "sk").update('{"a":1}').digest("hex"));
  });
});

describe("choix de la passerelle", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("Mobile Money → CinetPay, carte → Stripe quand les clés existent", async () => {
    vi.stubEnv("CINETPAY_API_KEY", "k");
    vi.stubEnv("CINETPAY_SITE_ID", "s");
    vi.stubEnv("CINETPAY_SECRET_KEY", "x");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_123");
    const { paymentOptions } = await import("@/lib/server/payments");
    const o = paymentOptions(null);
    expect(o.mobileMoney?.provider).toBe("cinetpay");
    expect(o.card?.provider).toBe("stripe");
    expect(o.demo).toBe(false);
  });

  it("sans clé : rien en production, démo pour une chanson de démonstration", async () => {
    vi.stubEnv("CINETPAY_API_KEY", "");
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    vi.stubEnv("PAYSTACK_SECRET_KEY", "");
    const { paymentOptions } = await import("@/lib/server/payments");
    expect(paymentOptions(null).card).toBeNull();
    const demoSong = { demo: true } as Parameters<typeof paymentOptions>[0];
    expect(paymentOptions(demoSong).card?.provider).toBe("demo");
  });
});
