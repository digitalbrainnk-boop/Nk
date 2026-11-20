// Client de l'API REST. Chaque appel concernant des messages porte l'identifiant de la ligne.
export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function createApi(getConfig) {
  async function request(method, path, body) {
    const { base, token } = getConfig();
    if (!base) throw new ApiError(0, "no_server", "Adresse du serveur non renseignée (Réglages).");
    let res;
    try {
      res = await fetch(`${base}/api${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError(0, "network", "Serveur injoignable. Vérifie ta connexion ou l'adresse du serveur.");
    }
    if (res.status === 204) return null;
    let data = null;
    try {
      data = await res.json();
    } catch {
      // réponse non JSON
    }
    if (!res.ok) throw new ApiError(res.status, data?.error?.code ?? "error", data?.error?.message ?? `Erreur ${res.status}`);
    return data;
  }

  const enc = encodeURIComponent;
  return {
    listSessions: () => request("GET", "/sessions").then((d) => d.sessions),
    createSession: ({ label, phoneNumber }) => request("POST", "/sessions", { label, phoneNumber }).then((d) => d.session),
    renameSession: (id, label) => request("PATCH", `/sessions/${enc(id)}`, { label }).then((d) => d.session),
    connect: (id, phoneNumber) => request("POST", `/sessions/${enc(id)}/connect`, phoneNumber ? { phoneNumber } : {}).then((d) => d.session),
    disconnect: (id) => request("POST", `/sessions/${enc(id)}/disconnect`, {}).then((d) => d.session),
    logout: (id) => request("POST", `/sessions/${enc(id)}/logout`, {}),
    removeSession: (id) => request("DELETE", `/sessions/${enc(id)}`),
    chats: (id) => request("GET", `/sessions/${enc(id)}/chats`),
    messages: (id, chatId, { before, limit = 50 } = {}) =>
      request("GET", `/sessions/${enc(id)}/chats/${enc(chatId)}/messages?limit=${limit}${before ? `&before=${before}` : ""}`),
    markRead: (id, chatId) => request("POST", `/sessions/${enc(id)}/chats/${enc(chatId)}/read`, {}),
    send: (id, to, text) => request("POST", `/sessions/${enc(id)}/messages`, { to, text }),
  };
}
