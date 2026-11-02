import { describe, expect, it } from "vitest";
import { formatPhoneForDisplay, maskPhone, normalizePhone } from "@/lib/validation/phone";

describe("normalizePhone", () => {
  it.each([
    ["70 12 34 56", "BF", "+22670123456"],
    ["70.12.34.56", "BF", "+22670123456"],
    ["+226 70-12-34-56", "BF", "+22670123456"],
    ["0022670123456", "CI", "+22670123456"], // indicatif international prioritaire sur le pays choisi
    ["22670123456", "BF", "+22670123456"], // indicatif sans « + »
    ["07 12 34 56 78", "CI", "+2250712345678"], // Côte d'Ivoire : 10 chiffres, le 0 fait partie du numéro
    ["77 123 45 67", "SN", "+221771234567"],
    ["01 97 12 34 56", "BJ", "+2290197123456"],
    ["024 123 4567", "GH", "+233241234567"], // Ghana : préfixe 0 retiré
    ["06 12 34 56 78", "FR", "+33612345678"],
  ])("%s (%s) → %s", (input, country, expected) => {
    expect(normalizePhone(input, country)).toBe(expected);
  });

  it.each([
    ["", "BF"],
    ["7012345", "BF"], // trop court
    ["701234567", "BF"], // trop long
    ["70 12 34 5a", "BF"], // lettre
    ["+999 12345678", "BF"], // indicatif inconnu
    ["12345678", "XX"], // pays inconnu
    ["<script>", "BF"],
    ["+226 70 12 34 56 78 90 12 34 56 78", "BF"],
  ])("refuse %s (%s)", (input, country) => {
    expect(normalizePhone(input, country)).toBeNull();
  });
});

describe("affichage", () => {
  it("formate et masque un numéro", () => {
    expect(formatPhoneForDisplay("+22670123456")).toBe("+226 70 12 34 56");
    expect(maskPhone("+22670123456")).toBe("+226 70 •• •• 56");
  });
});
