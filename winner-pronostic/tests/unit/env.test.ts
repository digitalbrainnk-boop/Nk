import { describe, expect, it } from "vitest";
import { parsePublicEnv } from "@/lib/env";
import { parseServerEnv } from "@/lib/env.server";

describe("variables d'environnement", () => {
  it("valide la configuration publique et retire le / final", () => {
    const env = parsePublicEnv({
      NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_xxxxxxxxxxxxxxxxxxxx",
      NEXT_PUBLIC_SITE_URL: "https://winner.example.com/",
    });
    expect(env.NEXT_PUBLIC_SITE_URL).toBe("https://winner.example.com");
  });

  it("explique clairement ce qui manque", () => {
    expect(() => parsePublicEnv({})).toThrow(/NEXT_PUBLIC_SUPABASE_URL[\s\S]*NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
  });

  it("refuse un sel anti-abus trop court", () => {
    expect(() => parseServerEnv({ RATE_LIMIT_SALT: "court" })).toThrow(/RATE_LIMIT_SALT/);
    expect(parseServerEnv({})).toEqual({});
  });
});
