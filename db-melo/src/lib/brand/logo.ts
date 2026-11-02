// Logo DB.Mélo : une croche et un cœur dorés dans un anneau doré, entourés de petits symboles de
// musique. Source unique de l'en-tête du site, de l'icône de l'onglet et des icônes de l'application.

const CREAM = "#F5F3EE";

/** Dégradés or, nommés d'après `id` pour ne pas se mélanger entre deux logos d'une même page. */
function gradients(id: string): string {
  return `<linearGradient id="${id}-or" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#F3C969"/><stop offset="0.6" stop-color="#E5A93C"/><stop offset="1" stop-color="#9A6B1C"/>
  </linearGradient>
  <linearGradient id="${id}-clair" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#FFE3A3"/><stop offset="1" stop-color="#F0B84E"/>
  </linearGradient>`;
}

// Cœur unité : pointe en bas, lobes en haut.
const HEART = "M0,0.78 C-0.55,0.38 -1,0.02 -1,-0.4 C-1,-0.76 -0.72,-1 -0.42,-1 C-0.22,-1 -0.07,-0.9 0,-0.74 C0.07,-0.9 0.22,-1 0.42,-1 C0.72,-1 1,-0.76 1,-0.4 C1,0.02 0.55,0.38 0,0.78 Z";

// Petits symboles de musique, dessinés autour de (0, 0) sur environ 20 unités.
const SYMBOLS = {
  croche: `<ellipse cx="-2.4" cy="5" rx="3.2" ry="2.5" transform="rotate(-20 -2.4 5)"/><rect x="0" y="-7" width="1.6" height="12" rx="0.6"/><path d="M0,-7.6 L1.6,-7.6 C2.3,-5 5.6,-4.2 5.2,-0.4 C4.7,-2.1 3.3,-3 1.6,-3.5 Z"/>`,
  double: `<ellipse cx="-5" cy="5.6" rx="3" ry="2.3" transform="rotate(-20 -5 5.6)"/><ellipse cx="4.4" cy="3.6" rx="3" ry="2.3" transform="rotate(-20 4.4 3.6)"/><rect x="-2.6" y="-6" width="1.4" height="11.6" rx="0.5"/><rect x="6.8" y="-8" width="1.4" height="11.6" rx="0.5"/><path d="M-2.6,-6 L8.2,-8 L8.2,-5.4 L-2.6,-3.4 Z"/>`,
  noire: `<ellipse cx="-1.6" cy="5" rx="3.3" ry="2.5" transform="rotate(-20 -1.6 5)"/><rect x="1" y="-7.5" width="1.6" height="12.6" rx="0.6"/>`,
  diese: `<rect x="-2.6" y="-7" width="1.3" height="14" rx="0.5"/><rect x="1.3" y="-7.8" width="1.3" height="14" rx="0.5"/><path d="M-5,-1.6 L5,-4 L5,-1.6 L-5,0.8 Z"/><path d="M-5,4 L5,1.6 L5,4 L-5,6.4 Z"/>`,
  bemol: `<rect x="-3" y="-8" width="1.4" height="15" rx="0.5"/><path d="M-1.6,7 C2,5.5 5.2,2.6 4.4,0 C3.7,-2 0.6,-1.6 -1.6,0.6 L-1.6,2.6 C0.4,0.6 2.6,0.4 2.6,1.6 C2.6,3.2 0.6,5 -1.6,5.8 Z"/>`,
};

// Centre de l'anneau ; symboles disposés tout autour : [symbole, angle (degrés), rayon, taille, crème ?, rotation].
const CX = 50;
const CY = 51;
const AROUND: [keyof typeof SYMBOLS, number, number, number, boolean, number][] = [
  ["croche", -135, 40, 0.95, true, -14],
  ["double", -58, 40, 0.88, false, 10],
  ["diese", 2, 41, 0.72, true, 8],
  ["noire", 58, 40, 0.85, false, 16],
  ["bemol", 124, 40, 0.78, true, -10],
  ["croche", 178, 41, 0.62, false, -8],
];

/** Motif du logo dans un carré de 100 × 100 (sans fond). `symbols: false` pour les très petites tailles. */
export function logoMotif(id: string, { symbols = true } = {}): string {
  const gold = `url(#${id}-or)`;
  const around = symbols
    ? AROUND.map(([name, angle, r, scale, cream, rot]) => {
        const a = (angle * Math.PI) / 180;
        const x = (CX + r * Math.cos(a)).toFixed(1);
        const y = (CY + r * Math.sin(a)).toFixed(1);
        return `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${scale})" fill="${cream ? CREAM : `url(#${id}-clair)`}">${SYMBOLS[name]}</g>`;
      }).join("")
    : "";
  return `<defs>${gradients(id)}</defs>
  <circle cx="${CX}" cy="${CY}" r="28" fill="#111118" stroke="${gold}" stroke-width="3.5"/>
  <g fill="${gold}">
    <ellipse cx="40" cy="62" rx="8.2" ry="6.3" transform="rotate(-20 40 62)"/>
    <rect x="44" y="30" width="5.4" height="32" rx="2"/>
    <path d="M44,29 L49.4,29 C51,35 59,37 58,47 C57,43 54,41 49.4,39 Z"/>
    <path d="${HEART}" transform="translate(65.5 37) scale(5.4)"/>
  </g>${around}`;
}

/**
 * Icône d'application complète (SVG) : fond nuit à lueur violette, logo au centre.
 * `maskable` : fond plein bord à bord, logo réduit pour rester dans la zone sûre (cercle de 80 %).
 * `symbols: false` pour l'icône d'onglet, trop petite pour les symboles.
 */
export function appIconSvg({ maskable = false, symbols = true }: { maskable?: boolean; symbols?: boolean } = {}): string {
  // Sans les symboles, l'anneau seul peut occuper presque toute l'icône.
  const scale = maskable ? 0.7 : symbols ? 0.82 : 1.45;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs><radialGradient id="fond" cx="0.3" cy="0.2" r="1">
    <stop offset="0" stop-color="#3a2a5c"/><stop offset="0.55" stop-color="#161622"/><stop offset="1" stop-color="#0B0B0F"/>
  </radialGradient></defs>
  <rect width="100" height="100" rx="${maskable ? 0 : 22}" fill="url(#fond)"/>
  <g transform="translate(50 50) scale(${scale}) translate(-${CX} -${CY})">${logoMotif("icone", { symbols })}</g>
</svg>`;
}
