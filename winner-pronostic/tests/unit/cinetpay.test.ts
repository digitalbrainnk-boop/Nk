import { describe, expect, it } from "vitest";
import { CinetPayError, checkPayment, computeHmac, initPayment, newTransactionId, verifyHmac } from "@/lib/payments/cinetpay";

const config = { apiKey: "test-api-key", siteId: "105900", secretKey: "secret-key-123", apiBase: "https://cinetpay.test" };

function fakeFetch(handler: (url: string, body: Record<string, unknown>) => unknown) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    calls.push({ url: String(input), body });
    return new Response(JSON.stringify(handler(String(input), body)), { headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { impl, calls };
}

describe("CinetPay", () => {
  it("crée un identifiant de transaction alphanumérique unique", () => {
    const a = newTransactionId(1_800_000_000_000, () => 0.1);
    const b = newTransactionId(1_800_000_000_000, () => 0.2);
    expect(a).toMatch(/^WP[A-Z0-9]{10,20}$/);
    expect(a).not.toBe(b);
  });

  it("initialise un paiement Mobile Money et renvoie l'URL de paiement", async () => {
    const { impl, calls } = fakeFetch(() => ({ code: "201", message: "CREATED", data: { payment_token: "tok", payment_url: "https://checkout.cinetpay.test/p/tok" } }));
    const res = await initPayment(config, { transactionId: "WPABC", amount: 1000, description: "Premium semaine", notifyUrl: "https://app/api/webhooks/cinetpay", returnUrl: "https://app/paiement/retour" }, impl);
    expect(res).toEqual({ paymentUrl: "https://checkout.cinetpay.test/p/tok", token: "tok" });
    expect(calls[0].url).toBe("https://cinetpay.test/v2/payment");
    expect(calls[0].body).toMatchObject({ apikey: "test-api-key", site_id: "105900", transaction_id: "WPABC", amount: 1000, currency: "XOF", channels: "MOBILE_MONEY" });
  });

  it("refuse un montant qui n'est pas un multiple de 5 et remonte les erreurs", async () => {
    const { impl } = fakeFetch(() => ({ code: "608", message: "MINIMUM_REQUIRED_FIELDS" }));
    await expect(initPayment(config, { transactionId: "X", amount: 1002, description: "x", notifyUrl: "n", returnUrl: "r" }, impl)).rejects.toBeInstanceOf(CinetPayError);
    await expect(initPayment(config, { transactionId: "X", amount: 1000, description: "x", notifyUrl: "n", returnUrl: "r" }, impl)).rejects.toThrow(/MINIMUM_REQUIRED_FIELDS/);
  });

  it("lit le statut réel d'une transaction", async () => {
    const accepted = fakeFetch(() => ({ code: "00", message: "SUCCES", data: { status: "ACCEPTED", amount: "1000", currency: "XOF", payment_method: "OMBF" } }));
    expect(await checkPayment(config, "WPABC", accepted.impl)).toMatchObject({ status: "ACCEPTED", amount: 1000, currency: "XOF", paymentMethod: "OMBF" });
    expect(accepted.calls[0].url).toBe("https://cinetpay.test/v2/payment/check");
    const refused = fakeFetch(() => ({ code: "627", message: "TRANSACTION_CANCEL", data: { status: "REFUSED" } }));
    expect((await checkPayment(config, "WPABC", refused.impl)).status).toBe("REFUSED");
    const waiting = fakeFetch(() => ({ code: "662", message: "WAITING_CUSTOMER_PAYMENT", data: { status: "WAITING_FOR_CUSTOMER" } }));
    expect((await checkPayment(config, "WPABC", waiting.impl)).status).toBe("WAITING");
  });

  it("vérifie le jeton HMAC (x-token) de la notification", () => {
    const fields = { cpm_site_id: "105900", cpm_trans_id: "WPABC", cpm_trans_date: "2026-11-21 10:00:00", cpm_amount: "1000", cpm_currency: "XOF", signature: "sig", payment_method: "OMBF" };
    const token = computeHmac(fields, "secret-key-123");
    expect(verifyHmac(fields, token, "secret-key-123")).toBe(true);
    expect(verifyHmac(fields, token.toUpperCase(), "secret-key-123")).toBe(true);
    expect(verifyHmac({ ...fields, cpm_amount: "5" }, token, "secret-key-123")).toBe(false);
    expect(verifyHmac(fields, token, "autre-cle")).toBe(false);
    expect(verifyHmac(fields, null, "secret-key-123")).toBe(false);
  });
});
