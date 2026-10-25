// WebSocket connection with automatic reconnect. After a drop it rejoins the
// same room with the saved token, so a phone that sleeps for a few seconds
// keeps its place.
import type { ClientMsg, ServerMsg } from '../shared/protocol';

type Handler = (msg: ServerMsg) => void;

const SESSION_KEY = 'hidenseek.session';

export interface Session { code: string; token: string; name: string; color: string }

export function loadSession(): Session | null {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
}
export function saveSession(s: Session | null) {
  try {
    if (s) sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch { /* storage blocked: reconnect after refresh just won't work */ }
}

export class Net {
  private ws: WebSocket | null = null;
  private queue: string[] = [];
  private retry = 0;
  private wantOpen = true;
  onMessage: Handler = () => {};
  onStatus: (connected: boolean) => void = () => {};
  /** Called after an unexpected reconnect so the app can rejoin its room. */
  onReconnect: () => void = () => {};

  constructor() { this.open(false); }

  private open(isRetry: boolean) {
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.onStatus(true);
      if (isRetry) this.onReconnect();
      for (const m of this.queue) ws.send(m);
      this.queue = [];
    };
    ws.onmessage = (e) => {
      try { this.onMessage(JSON.parse(e.data)); } catch (err) { console.error('bad message', err); }
    };
    ws.onclose = () => {
      this.onStatus(false);
      if (!this.wantOpen) return;
      const delay = Math.min(5000, 300 * 2 ** this.retry++);
      setTimeout(() => this.open(true), delay);
    };
  }

  send(msg: ClientMsg) {
    const s = JSON.stringify(msg);
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(s);
    else if (msg.t !== 'input') this.queue.push(s);
  }
}
