// HTTP + WebSocket server. Serves the built client from dist/ and runs every
// room in this one process.
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import express from 'express';
import { WebSocketServer, type WebSocket } from 'ws';
import { EMPTY_ROOM_TTL_MS, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, TICK_HZ } from '../shared/constants';
import type { ClientMsg, ServerMsg } from '../shared/protocol';
import { Room, type Conn } from './room';

const PORT = Number(process.env.PORT) || 3000;
const rooms = new Map<string, Room>();

function newCode(): string {
  for (;;) {
    let code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_CODE_ALPHABET[crypto.randomInt(ROOM_CODE_ALPHABET.length)];
    if (!rooms.has(code)) return code;
  }
}

const app = express();
app.get('/health', (_req, res) => { res.json({ ok: true, rooms: rooms.size }); });
const dist = path.resolve('dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { maxAge: '1h', index: 'index.html' }));
  // Room links like /r/K7QF2M open the app, which reads the code from the URL.
  app.get('/r/:code', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });

wss.on('connection', (ws: WebSocket) => {
  let room: Room | null = null;
  let playerId = '';
  const conn: Conn = {
    send(msg: ServerMsg) { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg)); },
    close() { ws.close(); },
  };
  let alive = true;
  ws.on('pong', () => { alive = true; });
  const heartbeat = setInterval(() => {
    if (!alive) return ws.terminate();
    alive = false;
    ws.ping();
  }, 15_000);

  ws.on('message', (raw) => {
    let msg: ClientMsg;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    if (!room) {
      if (msg.t === 'create') {
        const code = newCode();
        room = new Room(code);
        rooms.set(code, room);
        const r = room.join(conn, msg.name, msg.color);
        if ('error' in r) return;
        playerId = r.id;
        conn.send({ t: 'welcome', code, you: r.id, token: r.token, mapId: room.info().settings.mapId });
      } else if (msg.t === 'join') {
        const code = String(msg.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        const target = rooms.get(code);
        if (!target) return conn.send({ t: 'error', code: 'not_found', message: 'Room not found. Check the code and try again.' });
        const r = target.join(conn, msg.name, msg.color, msg.token);
        if ('error' in r) return conn.send({ t: 'error', code: 'full', message: 'This room is full (8 players).' });
        room = target;
        playerId = r.id;
        conn.send({ t: 'welcome', code, you: r.id, token: r.token, mapId: room.info().settings.mapId });
      }
      return;
    }
    if (msg.t === 'leave') {
      room.leave(playerId);
      room = null;
      return;
    }
    room.handle(playerId, msg);
  });

  ws.on('close', () => {
    clearInterval(heartbeat);
    room?.disconnect(playerId, conn);
  });
});

let last = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  for (const [code, room] of rooms) {
    room.tick(dt);
    if ((room.playerCount === 0 || room.connectedCount === 0) && room.emptySince && now - room.emptySince > EMPTY_ROOM_TTL_MS) rooms.delete(code);
  }
}, 1000 / TICK_HZ);

server.listen(PORT, () => console.log(`Fyenseek server on http://localhost:${PORT}`));
