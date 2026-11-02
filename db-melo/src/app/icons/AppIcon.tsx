// Icône d'application pour ImageResponse (PNG généré au build), dessinée par lib/brand/logo.ts.
import { appIconSvg } from "@/lib/brand/logo";

export function AppIcon({ size, maskable = false }: { size: number; maskable?: boolean }) {
  const src = `data:image/svg+xml;base64,${Buffer.from(appIconSvg({ maskable })).toString("base64")}`;
  return (
    <div style={{ width: size, height: size, display: "flex" }}>
      <img src={src} width={size} height={size} alt="" />
    </div>
  );
}
