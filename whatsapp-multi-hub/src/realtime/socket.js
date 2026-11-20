// Temps réel (Socket.io).
// - Salle « sessions » : tous les clients connectés reçoivent l'ÉTAT des lignes
//   (connectée, QR, non-lus…) mais jamais le contenu des messages.
// - Salle « session:<id> » : seuls les clients qui ont sélectionné cette ligne
//   reçoivent ses messages. Un client n'est jamais dans deux salles de ligne à la fois.
const LIST_ROOM = "sessions";
export const roomOf = (sessionId) => `session:${sessionId}`;

function leaveSessionRooms(socket) {
  for (const room of socket.rooms) {
    if (room.startsWith("session:")) socket.leave(room);
  }
  socket.data.sessionId = null;
}

export function attachRealtime(io, manager, { auth, logger }) {
  const log = logger.child({ module: "realtime" });
  io.use(auth.socket);

  io.on("connection", (socket) => {
    socket.data.sessionId = null;
    socket.join(LIST_ROOM);
    socket.emit("sessions:list", manager.list());
    log.debug({ socket: socket.id }, "Client connecté");

    // Le client choisit la ligne affichée : il quitte l'ancienne salle avant de rejoindre la nouvelle.
    // « join:session » (avec l'identifiant seul) est accepté pour compatibilité avec l'API du hub.
    const select = (payload, ack) => {
      const reply = typeof ack === "function" ? ack : () => {};
      const sessionId = (typeof payload === "string" ? payload : payload?.sessionId) || null;
      leaveSessionRooms(socket);
      if (!sessionId) return reply({ ok: true, session: null });
      const session = manager.find(sessionId);
      if (!session) return reply({ ok: false, error: "Ligne introuvable" });
      socket.join(roomOf(sessionId));
      socket.data.sessionId = sessionId;
      socket.emit("session:state", session.summary);
      reply({ ok: true, session: session.summary });
    };
    socket.on("session:select", select);
    socket.on("join:session", select);

    socket.on("disconnect", (reason) => log.debug({ socket: socket.id, reason }, "Client déconnecté"));
  });

  manager.on("session:update", (summary) => io.to(LIST_ROOM).emit("session:update", summary));
  manager.on("session:removed", ({ sessionId }) => {
    io.in(roomOf(sessionId)).socketsLeave(roomOf(sessionId));
    io.to(LIST_ROOM).emit("session:removed", { sessionId });
  });

  // Contenu des conversations : uniquement vers la salle de la ligne concernée.
  manager.on("message:new", (payload) => io.to(roomOf(payload.sessionId)).emit("message:new", payload));
  manager.on("message:update", (payload) => io.to(roomOf(payload.sessionId)).emit("message:update", payload));
  manager.on("chat:update", (payload) => io.to(roomOf(payload.sessionId)).emit("chat:update", payload));
  manager.on("chats:reset", (payload) => io.to(roomOf(payload.sessionId)).emit("chats:reset", payload));
}
