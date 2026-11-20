import pino from "pino";
import pinoPretty from "pino-pretty";

/**
 * Journal lisible dans le terminal (LOG_FORMAT=json pour du JSON brut,
 * pratique derrière un collecteur de logs).
 */
export function createLogger(level = "info") {
  if (process.env.LOG_FORMAT === "json") return pino({ level });
  return pino(
    { level },
    pinoPretty({ colorize: true, translateTime: "SYS:HH:MM:ss", ignore: "pid,hostname", singleLine: true }),
  );
}
