import { describe, expect, it } from "vitest";
import { buildId3v2, imageMime, readSynchsafe, stripId3v2, tagMp3 } from "@/lib/audio/id3";

const fakeMp3 = Uint8Array.from([0xff, 0xfb, 0x90, 0x64, 1, 2, 3, 4]);
const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9]);

function frames(tag: Uint8Array): Map<string, Uint8Array> {
  const size = readSynchsafe(tag, 6);
  const out = new Map<string, Uint8Array>();
  let o = 10;
  while (o < 10 + size && tag[o] !== 0) {
    const id = String.fromCharCode(...tag.subarray(o, o + 4));
    const len = (tag[o + 4] << 24) | (tag[o + 5] << 16) | (tag[o + 6] << 8) | tag[o + 7];
    out.set(id, tag.subarray(o + 10, o + 10 + len));
    o += 10 + len;
  }
  return out;
}

const utf16 = (b: Uint8Array) => new TextDecoder("utf-16le").decode(b.subarray(3));

describe("ID3v2.3", () => {
  it("écrit titre, artiste, paroles et pochette", () => {
    const tag = buildId3v2({ title: "Joyeux anniversaire Aïcha", artist: "DB.Mélo", lyrics: "[Refrain]\nÔ joie", cover: { data: png, mime: "image/png" } });
    expect(String.fromCharCode(...tag.subarray(0, 3))).toBe("ID3");
    expect(tag[3]).toBe(3);
    const f = frames(tag);
    expect(utf16(f.get("TIT2")!)).toBe("Joyeux anniversaire Aïcha");
    expect(utf16(f.get("TPE1")!)).toBe("DB.Mélo");
    expect(f.get("USLT")).toBeDefined();
    const apic = f.get("APIC")!;
    expect(String.fromCharCode(...apic.subarray(1, 10))).toBe("image/png");
    expect(apic.subarray(apic.length - png.length)).toEqual(png);
  });

  it("remplace une étiquette existante sans toucher à l'audio", () => {
    const once = tagMp3(fakeMp3, { title: "A", artist: "B" });
    const twice = tagMp3(once, { title: "C", artist: "D" });
    expect(stripId3v2(twice)).toEqual(fakeMp3);
    expect(utf16(frames(twice).get("TIT2")!)).toBe("C");
  });

  it("reconnaît JPEG et PNG", () => {
    expect(imageMime(png)).toBe("image/png");
    expect(imageMime(Uint8Array.from([0xff, 0xd8, 0xff]))).toBe("image/jpeg");
    expect(imageMime(Uint8Array.from([1, 2, 3, 4]))).toBeNull();
  });
});
