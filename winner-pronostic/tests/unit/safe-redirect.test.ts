import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/security/safe-redirect";

describe("safeNextPath", () => {
  it.each(["/compte", "/match/123?onglet=stats", "/coupons#resultat"])("accepte le chemin interne %s", (path) => {
    expect(safeNextPath(path)).toBe(path);
  });

  it.each([
    "https://evil.com",
    "//evil.com",
    "/\\evil.com",
    "\\\\evil.com",
    "javascript:alert(1)",
    "compte",
    "/compte\nSet-Cookie: x=1",
    "",
    null,
    undefined,
    42,
    `/${"a".repeat(400)}`,
  ])("refuse %s", (value) => {
    expect(safeNextPath(value, "/accueil")).toBe("/accueil");
  });
});
