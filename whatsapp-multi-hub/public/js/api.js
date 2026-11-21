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
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
    send: (id, to, text, replyTo) => request("POST", `/sessions/${enc(id)}/messages`, { to, text, ...(replyTo ? { replyTo } : {}) }),
    react: (id, chatId, messageId, emoji) =>
      request("POST", `/sessions/${enc(id)}/chats/${enc(chatId)}/messages/${enc(messageId)}/react`, { emoji }),
    deleteMessage: (id, chatId, messageId) => request("DELETE", `/sessions/${enc(id)}/chats/${enc(chatId)}/messages/${enc(messageId)}`),
    capabilities: () => request("GET", "/sessions/capabilities"),
    exchangeLoginCode: (code) => request("POST", "/auth/exchange", { code }).then((d) => d.token),
    rotateToken: () => request("POST", "/auth/rotate", {}).then((d) => d.token),
    pushKey: () => request("GET", "/push/key"),
    pushSubscribe: (subscription, preview) => request("POST", "/push/subscribe", { subscription, preview }),
    pushUnsubscribe: (endpoint) => request("POST", "/push/unsubscribe", { endpoint }),
    pushTest: () => request("POST", "/push/test", {}),
    notificationsStatus: () => request("GET", "/notifications"),
    notificationsUpdate: (patch) => request("PUT", "/notifications", patch),
    notificationsCheck: () => request("POST", "/notifications/check", {}),
    notificationsTest: () => request("POST", "/notifications/test", {}),

    /** Adresse complète d'un fichier (les adresses /media/... sont signées par le serveur). */
    mediaUrl: (path) => (path ? `${getConfig().base}${path}` : ""),

    /**
     * Envoie un fichier avec suivi de la progression (0 à 1).
     * XMLHttpRequest plutôt que fetch : seul lui donne la progression de l'envoi.
     */
    sendMedia(id, { to, file, caption, replyTo, voice }, onProgress) {
      const { base, token } = getConfig();
      const form = new FormData();
      form.append("to", to);
      if (caption) form.append("caption", caption);
      if (replyTo) form.append("replyTo", replyTo);
      if (voice) form.append("voice", "1");
      form.append("file", file, file.name || "fichier");
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `${base}/api/sessions/${enc(id)}/messages/media`);
        xhr.setRequestHeader("Authorization", `Bearer ${token}`);
        xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
        xhr.onerror = () => reject(new ApiError(0, "network", "Serveur injoignable pendant l'envoi du fichier."));
        xhr.onload = () => {
          let data = null;
          try {
            data = JSON.parse(xhr.responseText);
          } catch {
            // réponse non JSON
          }
          if (xhr.status >= 200 && xhr.status < 300) resolve(data);
          else reject(new ApiError(xhr.status, data?.error?.code ?? "error", data?.error?.message ?? `Erreur ${xhr.status}`));
        };
        xhr.send(form);
      });
    },
  };
}
