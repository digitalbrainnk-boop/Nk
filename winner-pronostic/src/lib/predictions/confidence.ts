/**
 * Indice de confiance (1 à 5) d'une sélection.
 * Version provisoire basée sur la probabilité et l'écart avec la cote ;
 * la phase 4 l'affinera avec la qualité des données (nombre de matchs
 * analysés, absences connues, écart entre modèles).
 */
export function confidenceFrom(probability: number, edge: number | null): number {
  let score = probability >= 0.75 ? 5 : probability >= 0.62 ? 4 : probability >= 0.5 ? 3 : probability >= 0.38 ? 2 : 1;
  if (edge !== null && edge < -0.05) score -= 1;
  return Math.max(1, Math.min(5, score));
}
