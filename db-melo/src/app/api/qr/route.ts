// GET /api/qr?text=… : QR code SVG (page cadeau).
import QRCode from "qrcode";

export async function GET(req: Request) {
  const text = new URL(req.url).searchParams.get("text") ?? "";
  if (!text || text.length > 500) return new Response("Texte invalide", { status: 400 });
  const svg = await QRCode.toString(text, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#0B0B0F", light: "#F5F3EE" } });
  return new Response(svg, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400" } });
}
