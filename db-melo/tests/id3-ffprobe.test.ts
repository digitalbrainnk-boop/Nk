// Vérifie avec ffprobe (s'il est installé) qu'un vrai MP3 étiqueté est bien lu : titre, artiste, pochette.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { tagMp3 } from "@/lib/audio/id3";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0 && spawnSync("ffprobe", ["-version"]).status === 0;

describe.skipIf(!hasFfmpeg)("ID3 lu par ffprobe", () => {
  it("expose titre, artiste, album et pochette", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbmelo-id3-"));
    const mp3 = path.join(dir, "in.mp3");
    const png = path.join(dir, "cover.png");
    execFileSync("ffmpeg", ["-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-id3v2_version", "3", "-metadata", "title=Ancien", mp3]);
    execFileSync("ffmpeg", ["-loglevel", "error", "-f", "lavfi", "-i", "color=c=0xE5A93C:s=64x64", "-frames:v", "1", png]);
    const out = path.join(dir, "out.mp3");
    fs.writeFileSync(
      out,
      tagMp3(new Uint8Array(fs.readFileSync(mp3)), {
        title: "Maman Aïcha, ma reine",
        artist: "DB.Mélo",
        album: "DB.Mélo — Chansons personnalisées",
        lyrics: "[Refrain]\nMaman",
        cover: { data: new Uint8Array(fs.readFileSync(png)), mime: "image/png" },
      }),
    );
    const info = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", out], { encoding: "utf8" }));
    expect(info.format.tags.title).toBe("Maman Aïcha, ma reine");
    expect(info.format.tags.artist).toBe("DB.Mélo");
    expect(info.format.tags.album).toBe("DB.Mélo — Chansons personnalisées");
    const streams = info.streams as { codec_type: string; codec_name: string; disposition?: { attached_pic?: number } }[];
    expect(streams.some((s) => s.codec_type === "audio" && s.codec_name === "mp3")).toBe(true);
    expect(streams.some((s) => s.disposition?.attached_pic === 1 && s.codec_name === "png")).toBe(true);
    expect(Number(info.format.duration)).toBeGreaterThan(1.5);
  });
});
