/**
 * Erreur « métier » avec un code HTTP : son message est renvoyé tel quel au client.
 * Toute autre erreur devient une 500 au message générique (détails dans les logs).
 */
export class AppError extends Error {
  constructor(status, message, code = "error") {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.expose = true;
  }
}

export const badRequest = (message, code = "bad_request") => new AppError(400, message, code);
export const notFound = (message, code = "not_found") => new AppError(404, message, code);
export const conflict = (message, code = "conflict") => new AppError(409, message, code);
