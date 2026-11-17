// Connexion WebSocket au serveur, avec reconnexion automatique.

export class MarketSocket {
  constructor(onMessage, onState) {
    this.onMessage = onMessage;
    this.onState = onState;
    this.ws = null;
    this.delay = 1000;
    this.subscription = null;
    this.closedByUser = false;
  }

  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.onState('connecting');
    this.ws.onopen = () => {
      this.delay = 1000;
      this.onState('open');
      if (this.subscription) this.send({ type: 'subscribe', ...this.subscription });
    };
    this.ws.onmessage = (ev) => {
      try { this.onMessage(JSON.parse(ev.data)); } catch (err) { console.error(err); }
    };
    this.ws.onclose = (ev) => {
      // 4401 : code d'accès téléphone manquant ou changé → la page d'accès s'affiche.
      if (ev.code === 4401) { location.reload(); return; }
      this.onState('closed');
      if (this.closedByUser) return;
      setTimeout(() => this.connect(), this.delay);
      this.delay = Math.min(this.delay * 2, 15000);
    };
    this.ws.onerror = () => this.ws.close();
  }

  send(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  subscribe(symbol, tf) {
    this.subscription = { symbol, tf };
    this.send({ type: 'subscribe', symbol, tf });
  }
}
