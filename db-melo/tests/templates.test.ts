import { describe, expect, it } from "vitest";
import { templateLyrics } from "@/lib/lyrics/templates";

describe("parolier de secours", () => {
  it("intègre les souvenirs sans les répéter et marque le duo", () => {
    const r = templateLyrics(
      { recipientName: "Aïcha", occasion: "birthday", anecdotes: "On s'est rencontrés à Cocody. Elle adore l'attiéké.", emotion: "joyful" },
      "duo",
    );
    expect(r.title).toBe("Joyeux anniversaire Aïcha");
    expect(r.lyrics).toContain("[Couplet 1 - Lui]");
    expect(r.lyrics).toContain("On s'est rencontrés à Cocody");
    expect(r.lyrics.match(/Cocody/g)).toHaveLength(1);
    expect(r.lyrics).toContain("Tous ces moments partagés");
  });

  it("n'indique pas de voix hors duo", () => {
    const r = templateLyrics({ recipientName: "Awa", occasion: "mothers_day", anecdotes: "Sa cuisine du dimanche me manque.", emotion: "nostalgic" }, "child");
    expect(r.lyrics).toContain("[Couplet 1]");
    expect(r.lyrics).not.toContain("- Lui");
  });
});
