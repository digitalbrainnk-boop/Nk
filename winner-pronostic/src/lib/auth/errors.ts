/**
 * Traduction en français des erreurs de Supabase Auth.
 * On n'affiche jamais le message technique brut à l'utilisateur.
 */
type AuthErrorLike = { code?: string | null; message?: string | null; status?: number | null } | null | undefined;

const MESSAGES: Record<string, string> = {
  invalid_credentials: "E-mail ou mot de passe incorrect.",
  email_not_confirmed: "Confirmez d'abord votre adresse e-mail grâce au lien reçu par mail.",
  phone_not_confirmed: "Confirmez d'abord votre numéro avec le code reçu par SMS.",
  user_already_exists: "Un compte existe déjà avec ces informations. Connectez-vous.",
  email_exists: "Un compte existe déjà avec cette adresse e-mail. Connectez-vous.",
  phone_exists: "Un compte existe déjà avec ce numéro. Connectez-vous.",
  weak_password: "Mot de passe trop faible : choisissez-en un plus long et moins courant.",
  same_password: "Le nouveau mot de passe doit être différent de l'ancien.",
  otp_expired: "Code expiré ou incorrect. Demandez un nouveau code.",
  over_email_send_rate_limit: "Trop d'e-mails envoyés. Réessayez dans quelques minutes.",
  over_sms_send_rate_limit: "Trop de SMS envoyés. Réessayez dans quelques minutes.",
  over_request_rate_limit: "Trop de tentatives. Réessayez dans quelques minutes.",
  sms_send_failed: "L'envoi du SMS a échoué. Vérifiez le numéro ou réessayez plus tard.",
  phone_provider_disabled: "La connexion par téléphone n'est pas encore activée. Utilisez l'e-mail.",
  email_provider_disabled: "La connexion par e-mail n'est pas activée. Utilisez le téléphone.",
  signup_disabled: "Les inscriptions sont momentanément fermées.",
  otp_disabled: "Aucun compte ne correspond à ce numéro. Créez d'abord un compte.",
  user_not_found: "Aucun compte ne correspond à ces informations.",
  session_not_found: "Votre session a expiré. Reconnectez-vous.",
  validation_failed: "Informations invalides. Vérifiez le formulaire.",
};

export const GENERIC_AUTH_ERROR = "Une erreur est survenue. Réessayez dans un instant.";

export function authErrorMessage(error: AuthErrorLike): string {
  if (!error) return GENERIC_AUTH_ERROR;
  if (error.code && MESSAGES[error.code]) return MESSAGES[error.code];

  const message = (error.message ?? "").toLowerCase();
  // Erreurs levées par le déclencheur SQL handle_new_user()
  if (message.includes("age_requirement")) return "Vous devez avoir au moins 18 ans pour créer un compte.";
  if (message.includes("terms_required")) return "Vous devez accepter les conditions d'utilisation.";
  if (message.includes("database error saving new user")) {
    return "Inscription refusée : vérifiez votre date de naissance (18 ans minimum) et les conditions.";
  }
  if (message.includes("signups not allowed for otp")) return MESSAGES.otp_disabled;
  if (message.includes("token has expired") || message.includes("invalid token")) return MESSAGES.otp_expired;
  if (message.includes("rate limit") || error.status === 429) return MESSAGES.over_request_rate_limit;
  return GENERIC_AUTH_ERROR;
}
