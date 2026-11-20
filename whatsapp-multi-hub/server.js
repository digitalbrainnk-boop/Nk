// server.js — hub multi-sessions (relais de messages isolés par ligne)
require('dotenv').config({ quiet: true });

const crypto = require('crypto');
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const cors = require('cors');

const PORT = process.env.PORT || 3000;
// Jeton d'accès facultatif : s'il est défini dans .env, l'API et Socket.io l'exigent.
const API_TOKEN = process.env.API_TOKEN || '';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const MAX_MESSAGES_PER_SESSION = 500;
// Identifiants autorisés : évite les noms de room arbitraires (ex. l'identifiant d'un socket).
const SESSION_ID_RE = /^[a-zA-Z0-9_-]{1,40}$/;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CORS_ORIGIN }
});

app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json({ limit: '64kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Room Socket.io d'une session, préfixée pour ne jamais coïncider avec une room interne
// (Socket.io place chaque client dans une room qui porte son propre identifiant).
const roomOf = (sessionId) => `session:${sessionId}`;

// Stockage isolé des sessions en mémoire (à persister en base ou fichiers selon besoin)
const sessions = new Map();

function createSession(sessionId) {
  const session = {
    id: sessionId,
    status: 'disconnected',
    messages: [],
    updatedAt: new Date().toISOString()
  };
  sessions.set(sessionId, session);
  return session;
}

const summary = ({ id, status, updatedAt }) => ({ id, status, updatedAt });

function tokenMatches(provided) {
  if (!API_TOKEN) return true;
  if (typeof provided !== 'string' || !provided) return false;
  const a = crypto.createHash('sha256').update(provided).digest();
  const b = crypto.createHash('sha256').update(API_TOKEN).digest();
  return crypto.timingSafeEqual(a, b);
}

// --- API REST -----------------------------------------------------------------

app.use('/api', (req, res, next) => {
  const header = req.get('authorization') || '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (tokenMatches(provided)) return next();
  res.status(401).json({ error: "Jeton d'accès manquant ou invalide." });
});

// Valide l'identifiant et retrouve la session, sans jamais en créer une au passage.
function findSession(req, res) {
  const { sessionId } = req.params;
  if (!SESSION_ID_RE.test(sessionId)) {
    res.status(400).json({ error: 'Identifiant de session invalide (lettres, chiffres, - et _ ; 40 caractères max).' });
    return null;
  }
  const session = sessions.get(sessionId);
  if (!session) {
    res.status(404).json({ error: `Session inconnue : ${sessionId}. Initialise-la d'abord.` });
    return null;
  }
  return session;
}

// Lister toutes les sessions
app.get('/api/sessions', (req, res) => {
  res.json({ sessions: Array.from(sessions.values()).map(summary) });
});

// Initialiser une session isolée (ex: "ligne-1", "ligne-2") — seule route qui crée une session
app.post('/api/sessions/:sessionId/init', (req, res) => {
  const { sessionId } = req.params;
  if (!SESSION_ID_RE.test(sessionId)) {
    return res.status(400).json({ error: 'Identifiant de session invalide (lettres, chiffres, - et _ ; 40 caractères max).' });
  }
  const session = sessions.get(sessionId) || createSession(sessionId);
  session.status = 'qr_ready';
  session.updatedAt = new Date().toISOString();

  io.to(roomOf(sessionId)).emit('session:status', { sessionId, status: session.status });
  // L'état (jamais le contenu) est aussi envoyé à tous, pour le sélecteur de lignes.
  io.emit('sessions:update', summary(session));

  res.json({ ok: true, session: summary(session) });
});

// Recevoir/relayer un message strictement dans sa session
app.post('/api/sessions/:sessionId/messages', (req, res) => {
  const session = findSession(req, res);
  if (!session) return;
  const { sender = 'client', text } = req.body ?? {};

  if (typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'Le message est vide.' });
  }
  if (text.length > 4096) {
    return res.status(400).json({ error: 'Message trop long (4096 caractères max).' });
  }

  const message = {
    id: `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
    sessionId: session.id,
    sender: String(sender).slice(0, 40),
    text: text.trim(),
    timestamp: new Date().toISOString()
  };

  session.messages.push(message);
  if (session.messages.length > MAX_MESSAGES_PER_SESSION) {
    session.messages.splice(0, session.messages.length - MAX_MESSAGES_PER_SESSION);
  }
  session.updatedAt = message.timestamp;

  // Émission ciblée uniquement sur la room de ce sessionId
  io.to(roomOf(session.id)).emit('message:new', message);

  res.status(201).json({ ok: true, message });
});

// Récupérer l'historique d'une seule session
app.get('/api/sessions/:sessionId/messages', (req, res) => {
  const session = findSession(req, res);
  if (!session) return;
  res.json({ sessionId: session.id, messages: session.messages });
});

// Erreurs (JSON invalide, etc.) renvoyées proprement au lieu d'une page HTML.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Corps JSON invalide.' });
  console.error(err);
  res.status(500).json({ error: 'Erreur interne du serveur.' });
});

// --- Temps réel -----------------------------------------------------------------

io.use((socket, next) => {
  if (tokenMatches(socket.handshake.auth?.token)) return next();
  next(new Error('unauthorized'));
});

io.on('connection', (socket) => {
  socket.emit('sessions:list', Array.from(sessions.values()).map(summary));

  socket.on('join:session', (sessionId, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    // On quitte d'abord la session précédente : un client n'écoute qu'une ligne à la fois.
    for (const room of socket.rooms) {
      if (room.startsWith('session:')) socket.leave(room);
    }
    const session = typeof sessionId === 'string' && SESSION_ID_RE.test(sessionId) ? sessions.get(sessionId) : null;
    if (!session) return reply({ ok: false, error: 'Session inconnue' });
    socket.join(roomOf(session.id));
    socket.emit('session:state', session);
    reply({ ok: true });
  });
});

server.listen(PORT, () => {
  console.log(`Serveur multi-session actif sur http://localhost:${PORT}`);
  if (!API_TOKEN) {
    console.warn("⚠️  Aucun API_TOKEN dans .env : l'API est ouverte à quiconque peut joindre ce serveur.");
  }
});
