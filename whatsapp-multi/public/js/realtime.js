// Connexion Socket.io. Le client n'écoute qu'UNE ligne à la fois : changer de
// ligne fait quitter la salle de l'ancienne côté serveur.
export function createRealtime({ base, token, handlers }) {
  const socket = window.io(base, {
    auth: { token },
    transports: ["websocket", "polling"],
    reconnectionDelayMax: 10000,
  });
  let selected = null;
  let connectedOnce = false;

  socket.on("connect", () => {
    handlers.status("online");
    // Après une coupure, le serveur a oublié notre salle : on la rejoint à nouveau.
    if (selected) socket.emit("session:select", { sessionId: selected }, () => {});
    if (connectedOnce) handlers.resync();
    connectedOnce = true;
  });
  socket.on("disconnect", () => handlers.status("offline"));
  socket.on("connect_error", (err) => {
    handlers.status("offline");
    if (err.message === "unauthorized" || err.message === "too_many_attempts") handlers.unauthorized(err.data?.message);
  });

  const events = ["sessions:list", "session:update", "session:removed", "message:new", "message:update", "chat:update", "chats:reset"];
  for (const name of events) socket.on(name, (payload) => handlers.event(name, payload));

  return {
    /** Choisit la ligne écoutée ; résout avec la réponse du serveur (ou null si hors ligne). */
    select(sessionId) {
      selected = sessionId;
      if (!socket.connected) return Promise.resolve(null);
      return new Promise((resolve) => {
        socket.timeout(5000).emit("session:select", { sessionId }, (err, res) => resolve(err ? null : res));
      });
    },
    close() {
      socket.removeAllListeners();
      socket.close();
    },
  };
}
