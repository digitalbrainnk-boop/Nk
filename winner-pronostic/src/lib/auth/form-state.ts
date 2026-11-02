/** État renvoyé par les Server Actions de formulaire (utilisé avec useActionState). */
export type FormState = {
  status: "idle" | "error" | "success";
  /** Message général (erreur ou succès) affiché en haut du formulaire. */
  message?: string;
  /** Erreur par champ (clé = attribut name du champ). */
  fieldErrors?: Record<string, string>;
  /** Valeurs saisies à réafficher après une erreur (jamais les mots de passe). */
  values?: Record<string, string>;
};

export const initialFormState: FormState = { status: "idle" };

const SENSITIVE_FIELDS = new Set(["password", "confirm", "token"]);

/** Retire les champs sensibles avant de renvoyer les valeurs au navigateur. */
export function publicValues(values: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (!SENSITIVE_FIELDS.has(key)) out[key] = value.slice(0, 300);
  }
  return out;
}
