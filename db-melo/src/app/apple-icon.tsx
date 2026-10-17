import { ImageResponse } from "next/og";
import { AppIcon } from "./icons/AppIcon";

// Icône de l'écran d'accueil iPhone / iPad (iOS remplit lui-même les coins).
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(<AppIcon size={180} maskable />, size);
}
