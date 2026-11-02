import { describe, expect, it } from "vitest";
import { authErrorMessage } from "@/lib/auth/errors";
import { publicValues } from "@/lib/auth/form-state";
import {
  fieldErrorsOf,
  formDataToObject,
  signInPhoneSchema,
  signUpEmailSchema,
  signUpPhoneSchema,
  updatePasswordSchema,
  verifyOtpSchema,
} from "@/lib/auth/schemas";

function birthDateYearsAgo(years: number): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

const validEmailSignup = {
  displayName: "  Awa Ouédraogo ",
  email: " Awa@Exemple.COM ",
  password: "motdepasse1",
  birthDate: birthDateYearsAgo(25),
  country: "bf",
  terms: "on",
};

describe("inscription par e-mail", () => {
  it("accepte et normalise des données valides", () => {
    const result = signUpEmailSchema.parse(validEmailSignup);
    expect(result.displayName).toBe("Awa Ouédraogo");
    expect(result.email).toBe("awa@exemple.com");
    expect(result.country).toBe("BF");
  });

  it("refuse un mineur", () => {
    const result = signUpEmailSchema.safeParse({ ...validEmailSignup, birthDate: birthDateYearsAgo(17) });
    expect(result.success).toBe(false);
    expect(fieldErrorsOf(result.error!).birthDate).toMatch(/18 ans/);
  });

  it("exige l'acceptation des conditions", () => {
    const withoutTerms: Partial<typeof validEmailSignup> = { ...validEmailSignup };
    delete withoutTerms.terms;
    const result = signUpEmailSchema.safeParse(withoutTerms);
    expect(fieldErrorsOf(result.error!).terms).toBeDefined();
  });

  it.each([
    ["password", "court1", /8 caractères/],
    ["password", "sanschiffre", /lettre et un chiffre/],
    ["email", "pas-un-email", /invalide/],
    ["displayName", "<script>", /uniquement/],
    ["birthDate", "2099-01-01", /futur/],
    ["country", "US", /non pris en charge/],
  ])("refuse %s = %s", (field, value, message) => {
    const result = signUpEmailSchema.safeParse({ ...validEmailSignup, [field]: value });
    expect(result.success).toBe(false);
    expect(fieldErrorsOf(result.error!)[field]).toMatch(message);
  });
});

describe("téléphone et code SMS", () => {
  it("normalise le numéro à l'inscription", () => {
    const result = signUpPhoneSchema.parse({
      displayName: "Issa",
      phone: "70 12 34 56",
      country: "BF",
      birthDate: birthDateYearsAgo(30),
      terms: "on",
    });
    expect(result.phone).toBe("+22670123456");
  });

  it("signale un numéro invalide sur le champ phone", () => {
    const result = signInPhoneSchema.safeParse({ phone: "123", country: "BF" });
    expect(fieldErrorsOf(result.error!).phone).toMatch(/invalide/);
  });

  it("valide le code à 6 chiffres", () => {
    expect(verifyOtpSchema.safeParse({ phone: "+22670123456", token: "123456" }).success).toBe(true);
    expect(verifyOtpSchema.safeParse({ phone: "+22670123456", token: "12345" }).success).toBe(false);
    expect(verifyOtpSchema.safeParse({ phone: "70123456", token: "123456" }).success).toBe(false);
  });
});

describe("mot de passe", () => {
  it("vérifie la confirmation", () => {
    const result = updatePasswordSchema.safeParse({ password: "nouveau123", confirm: "nouveau124" });
    expect(fieldErrorsOf(result.error!).confirm).toMatch(/correspondent pas/);
  });
});

describe("utilitaires de formulaire", () => {
  it("ignore les champs internes de Next.js et les fichiers", () => {
    const fd = new FormData();
    fd.set("email", "a@b.co");
    fd.set("$ACTION_ID_123", "");
    fd.set("fichier", new Blob(["x"]));
    expect(formDataToObject(fd)).toEqual({ email: "a@b.co" });
  });

  it("ne renvoie jamais les mots de passe au navigateur", () => {
    expect(publicValues({ email: "a@b.co", password: "secret1", confirm: "secret1", token: "123456" })).toEqual({
      email: "a@b.co",
    });
  });
});

describe("messages d'erreur Supabase", () => {
  it("traduit les codes connus", () => {
    expect(authErrorMessage({ code: "invalid_credentials" })).toBe("E-mail ou mot de passe incorrect.");
    expect(authErrorMessage({ message: "Database error saving new user" })).toMatch(/18 ans/);
    expect(authErrorMessage({ message: "Signups not allowed for otp" })).toMatch(/Aucun compte/);
    expect(authErrorMessage({ status: 429, message: "x" })).toMatch(/Trop de tentatives/);
  });

  it("n'affiche jamais un message technique inconnu", () => {
    expect(authErrorMessage({ message: "pq: relation secret does not exist" })).toBe(
      "Une erreur est survenue. Réessayez dans un instant.",
    );
  });
});
