// Pochettes : IA (Kie, offre Prestige), image Suno, ou « collector » DB.Mélo dessinée ici (avec la photo).
import { ImageResponse } from "next/og";
import { BRAND } from "../constants";
import type { CoverChoice, SongRecord } from "../types";
import { effectiveCoverChoice, sunoImage } from "./cover-choice";
import { imageMime } from "../audio/id3";
import { files, uploads } from "./store";

export interface ImagePayload {
  data: Uint8Array;
  mime: "image/png" | "image/jpeg";
}

async function photoSrc(song: SongRecord): Promise<string | null> {
  if (!song.config.photoUploadId) return null;
  const up = await uploads.get(song.config.photoUploadId);
  if (!up) return null;
  const local = up.localPath ? await files.read(up.localPath) : null;
  if (local) return `data:${up.mime};base64,${Buffer.from(local).toString("base64")}`;
  return up.publicUrl ?? null;
}

/** Visuel collector : fond studio, cadre or, titre, destinataire, photo si fournie. */
export async function collectorCover(song: SongRecord, size = 800): Promise<Uint8Array> {
  const photo = await photoSrc(song);
  const k = size / 800;
  const title = song.config.title;
  const recipient = song.config.recipientName;
  const res = new ImageResponse(
    (
      <div
        style={{
          width: size,
          height: size,
          display: "flex",
          position: "relative",
          backgroundColor: "#0B0B0F",
          backgroundImage: "radial-gradient(circle at 30% 20%, #3a2a5c 0%, #161622 45%, #0B0B0F 100%)",
          fontFamily: "sans-serif",
        }}
      >
        {photo ? (
          <img src={photo} alt="" width={size} height={size} style={{ position: "absolute", top: 0, left: 0, width: size, height: size, objectFit: "cover" }} />
        ) : (
          <div
            style={{
              position: "absolute",
              top: 120 * k,
              left: 160 * k,
              width: 480 * k,
              height: 480 * k,
              borderRadius: 9999,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              backgroundImage: "repeating-radial-gradient(circle, #111118 0px, #111118 6px, #1c1c28 7px, #111118 9px)",
              boxShadow: "0 0 80px rgba(229,169,60,0.35)",
            }}
          >
            <div style={{ width: 150 * k, height: 150 * k, borderRadius: 9999, backgroundImage: "linear-gradient(135deg, #F3C969, #E5A93C 55%, #9a6b1c)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 54 * k, color: "#0B0B0F", fontWeight: 800 }}>
              DB
            </div>
          </div>
        )}
        <div style={{ position: "absolute", top: 0, left: 0, width: size, height: size, backgroundImage: "linear-gradient(180deg, rgba(11,11,15,0.05) 35%, rgba(11,11,15,0.92) 100%)" }} />
        <div style={{ position: "absolute", top: 26 * k, left: 26 * k, right: 26 * k, bottom: 26 * k, border: `${3 * k}px solid #E5A93C`, borderRadius: 30 * k }} />
        <div style={{ position: "absolute", left: 70 * k, right: 70 * k, bottom: 70 * k, display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 24 * k, letterSpacing: 8 * k, color: "#E5A93C", textTransform: "uppercase", fontWeight: 700 }}>{BRAND.name}</div>
          <div style={{ fontSize: (title.length > 28 ? 52 : 68) * k, lineHeight: 1.05, color: "#ffffff", fontWeight: 800, marginTop: 12 * k }}>{title}</div>
          {recipient ? <div style={{ fontSize: 32 * k, color: "#F3C969", marginTop: 14 * k }}>{`pour ${recipient}`}</div> : null}
        </div>
      </div>
    ),
    { width: size, height: size },
  );
  return new Uint8Array(await res.arrayBuffer());
}

async function fetchImage(url: string): Promise<ImagePayload | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const data = new Uint8Array(await res.arrayBuffer());
    const mime = imageMime(data);
    return mime ? { data, mime } : null;
  } catch {
    return null;
  }
}

/** Pochette retenue pour la chanson (affichage, page cadeau, étiquette ID3). */
export async function loadCover(song: SongRecord, choice = effectiveCoverChoice(song), size = 800): Promise<ImagePayload> {
  const remote = choice === "ai" ? song.aiCover?.url : choice === "suno" ? sunoImage(song) : undefined;
  if (remote) {
    const img = await fetchImage(remote);
    if (img) return img;
  }
  return { data: await collectorCover(song, size), mime: "image/png" };
}
