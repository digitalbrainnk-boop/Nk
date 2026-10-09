// Petit bus d'événements : le tableau de bord s'y abonne (SSE) pour voir
// les conversations en direct.
import { EventEmitter } from "node:events";

export const bus = new EventEmitter();
bus.setMaxListeners(100);

export function emit(type, payload = {}) {
  bus.emit("event", { type, ...payload, at: Date.now() });
}
