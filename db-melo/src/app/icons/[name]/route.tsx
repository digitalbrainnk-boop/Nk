import { ImageResponse } from "next/og";
import { AppIcon } from "../AppIcon";

const ICONS: Record<string, { size: number; maskable?: boolean }> = {
  "192": { size: 192 },
  "512": { size: 512 },
  "maskable-512": { size: 512, maskable: true },
};

export function generateStaticParams() {
  return Object.keys(ICONS).map((name) => ({ name }));
}

export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const icon = ICONS[(await params).name];
  if (!icon) return new Response("Not found", { status: 404 });
  return new ImageResponse(<AppIcon size={icon.size} maskable={icon.maskable} />, {
    width: icon.size,
    height: icon.size,
    headers: { "Cache-Control": "public, max-age=31536000, immutable" },
  });
}
