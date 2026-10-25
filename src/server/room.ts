// One game room: lobby, round phases, movement, disguises, tagging and scoring.
// The server decides everything; browsers only send intentions.
import crypto from 'node:crypto';
import {
  COUNTDOWN_MS, DEFAULT_SETTINGS, MAX_PLAYERS, MIN_PLAYERS, NAME_MAX, CHAT_MAX, PING_EVERY_MS, PING_START_MS,
  PLAYER_COLORS, PLAYER_RADIUS, PLAYER_SPEED, RECONNECT_GRACE_MS, RESULTS_MS, REVEAL_AT_MS, SCORE, SEEKER_SPEED,
  SWAP_COOLDOWN_MS, SWAP_RANGE, TAG_COOLDOWN_MS, TAG_MISS_PENALTY_MS, TAG_RANGE, TAUNT_COOLDOWN_MS, type RoomSettings,
} from '../shared/constants';
import { MAPS, staticColliders, type Box, type MapDef } from '../shared/map';
import { move, dist, distToBox } from '../shared/movement';
import { PROPS, disguiseRadius, propExtents } from '../shared/props';
import type { ClientMsg, LobbyPlayer, Phase, Role, RoomInfo, RoundResult, ServerMsg, SnapPlayer } from '../shared/protocol';

export interface Conn { send(msg: ServerMsg): void; close(): void }

interface Player {
  id: string;
  token: string;
  name: string;
  color: string;
  conn: Conn | null;
  ready: boolean;
  joinedAt: number;
  disconnectedAt: number;
  score: number;
  role: Role;
  alive: boolean;
  x: number;
  z: number;
  r: number;
  disguise: string;
  locked: boolean;
  input: { dx: number; dz: number; seq: number };
  lastSwap: number;
  lastTag: number;
  lastTaunt: number;
  alias: string; // id shown to the seeker for this round
  roundPoints: number;
  hasSeeked: boolean;
}

const clean = (s: unknown, max: number) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);

export class Room {
  readonly code: string;
  private players = new Map<string, Player>();
  private hostId = '';
  private phase: Phase = 'lobby';
  private phaseEndsAt = 0;
  private settings: RoomSettings = { ...DEFAULT_SETTINGS };
  private round = 0;
  private totalRounds = 0;
  private seekerId: string | null = null;
  private seekerOrder: string[] = [];
  private map: MapDef = MAPS[DEFAULT_SETTINGS.mapId];
  private colliders: Box[] = staticColliders(this.map);
  private found: RoundResult['found'] = [];
  private nextPingAt = 0;
  private revealed = false;
  private seekStartedAt = 0;
  emptySince = 0;

  constructor(code: string, private now: () => number = Date.now) {
    this.code = code;
  }

  get playerCount() { return this.players.size; }
  get connectedCount() { let n = 0; for (const p of this.players.values()) if (p.conn) n++; return n; }
  get currentPhase() { return this.phase; }

  /** Add a player or reconnect one by token. Returns the player id, or an error. */
  join(conn: Conn, name: string, color: string, token?: string): { id: string; token: string } | { error: 'full' } {
    if (token) {
      for (const p of this.players.values()) {
        if (p.token === token) {
          p.conn?.close();
          p.conn = conn;
          p.disconnectedAt = 0;
          this.emptySince = 0;
          this.broadcastRoom();
          return { id: p.id, token: p.token };
        }
      }
    }
    if (this.players.size >= MAX_PLAYERS) return { error: 'full' };
    const id = crypto.randomBytes(4).toString('hex');
    const used = new Set([...this.players.values()].map((p) => p.color));
    const pickedColor = PLAYER_COLORS.includes(color) && !used.has(color) ? color : PLAYER_COLORS.find((c) => !used.has(c)) ?? PLAYER_COLORS[0];
    const inGame = this.phase !== 'lobby';
    const spawn = this.map.hiderSpawns[this.players.size % this.map.hiderSpawns.length];
    const p: Player = {
      id, token: crypto.randomBytes(16).toString('hex'), name: clean(name, NAME_MAX) || 'Player', color: pickedColor,
      conn, ready: false, joinedAt: this.now(), disconnectedAt: 0, score: 0,
      role: inGame ? 'spectator' : 'hider', alive: !inGame, x: spawn.x, z: spawn.z, r: 0, disguise: '', locked: false,
      input: { dx: 0, dz: 0, seq: 0 }, lastSwap: 0, lastTag: 0, lastTaunt: 0, alias: id, roundPoints: 0, hasSeeked: false,
    };
    this.players.set(id, p);
    if (!this.hostId) this.hostId = id;
    this.emptySince = 0;
    this.broadcastRoom();
    return { id, token: p.token };
  }

  disconnect(id: string, conn: Conn) {
    const p = this.players.get(id);
    if (!p || p.conn !== conn) return;
    p.conn = null;
    p.disconnectedAt = this.now();
    if (this.connectedCount === 0) this.emptySince = this.now();
    this.broadcastRoom();
  }

  leave(id: string) {
    const p = this.players.get(id);
    if (!p) return;
    this.players.delete(id);
    this.seekerOrder = this.seekerOrder.filter((s) => s !== id);
    if (this.hostId === id) this.passHost();
    if (this.players.size === 0) { this.emptySince = this.now(); return; }
    if (this.phase !== 'lobby' && this.phase !== 'results') {
      if (id === this.seekerId) this.endRound('hiders');
      else this.checkAllFound();
    }
    this.broadcastRoom();
  }

  private passHost() {
    const next = [...this.players.values()].filter((p) => p.conn).sort((a, b) => a.joinedAt - b.joinedAt)[0]
      ?? [...this.players.values()].sort((a, b) => a.joinedAt - b.joinedAt)[0];
    this.hostId = next?.id ?? '';
  }

  handle(id: string, msg: ClientMsg) {
    const p = this.players.get(id);
    if (!p) return;
    const t = this.now();
    switch (msg.t) {
      case 'ready':
        if (this.phase === 'lobby') { p.ready = !!msg.v; this.broadcastRoom(); }
        break;
      case 'settings': {
        if (id !== this.hostId) return this.err(p, 'not_host', 'Only the host can change settings.');
        if (this.phase !== 'lobby') return;
        const s = msg.s ?? {};
        if (typeof s.hideSeconds === 'number') this.settings.hideSeconds = Math.round(Math.min(120, Math.max(20, s.hideSeconds)));
        if (typeof s.seekSeconds === 'number') this.settings.seekSeconds = Math.round(Math.min(300, Math.max(60, s.seekSeconds)));
        if (typeof s.rounds === 'number') this.settings.rounds = Math.round(Math.min(10, Math.max(0, s.rounds)));
        if (s.seekerMode === 'rotate' || s.seekerMode === 'random') this.settings.seekerMode = s.seekerMode;
        if (typeof s.mapId === 'string' && MAPS[s.mapId]) this.settings.mapId = s.mapId;
        this.broadcastRoom();
        break;
      }
      case 'kick': {
        if (id !== this.hostId || msg.id === id) return;
        const target = this.players.get(msg.id);
        if (!target) return;
        target.conn?.send({ t: 'kicked' });
        target.conn?.close();
        this.leave(msg.id);
        break;
      }
      case 'start':
        if (id !== this.hostId) return this.err(p, 'not_host', 'Only the host can start the game.');
        if (this.phase !== 'lobby') return;
        if (this.connectedCount < MIN_PLAYERS) return this.err(p, 'too_few', `You need at least ${MIN_PLAYERS} players to start.`);
        this.startMatch();
        break;
      case 'input': {
        const dx = Number(msg.dx), dz = Number(msg.dz);
        if (!Number.isFinite(dx) || !Number.isFinite(dz)) return;
        p.input = { dx: Math.max(-1, Math.min(1, dx)), dz: Math.max(-1, Math.min(1, dz)), seq: Number(msg.seq) || 0 };
        break;
      }
      case 'swap': this.trySwap(p, String(msg.target), t); break;
      case 'lock':
        if (p.role === 'hider' && p.alive && p.disguise) p.locked = !!msg.v;
        break;
      case 'rotate':
        if (p.role === 'hider' && p.alive && (this.phase === 'hiding' || this.phase === 'seeking')) p.r = (p.r + Math.PI / 4) % (Math.PI * 2);
        break;
      case 'tag': this.tryTag(p, String(msg.target), t); break;
      case 'taunt': {
        if (p.role !== 'hider' || !p.alive || this.phase !== 'seeking' || t - p.lastTaunt < TAUNT_COOLDOWN_MS) return;
        p.lastTaunt = t;
        p.roundPoints += SCORE.hiderTaunt;
        this.sendPing([p], true);
        break;
      }
      case 'chat': {
        const text = clean(msg.text, CHAT_MAX);
        if (!text) return;
        // Found players and spectators only talk to each other during a round.
        const ghost = this.phase !== 'lobby' && this.phase !== 'results' && (!p.alive || p.role === 'spectator');
        for (const o of this.players.values()) {
          const oGhost = this.phase !== 'lobby' && this.phase !== 'results' && (!o.alive || o.role === 'spectator');
          if (!ghost || oGhost) o.conn?.send({ t: 'chat', id: p.id, name: p.name, text });
        }
        break;
      }
      case 'leave': this.leave(id); break;
    }
  }

  private err(p: Player, code: Extract<ServerMsg, { t: 'error' }>['code'], message: string) {
    p.conn?.send({ t: 'error', code, message });
  }

  private startMatch() {
    this.map = MAPS[this.settings.mapId];
    this.colliders = staticColliders(this.map);
    const ids = [...this.players.values()].filter((p) => p.conn).sort((a, b) => a.joinedAt - b.joinedAt).map((p) => p.id);
    this.seekerOrder = this.settings.seekerMode === 'random' ? shuffle(ids) : ids;
    this.totalRounds = this.settings.rounds || ids.length;
    this.round = 0;
    for (const p of this.players.values()) { p.score = 0; p.hasSeeked = false; }
    this.startRound();
  }

  private pickSeeker(): string {
    const present = this.seekerOrder.filter((id) => this.players.has(id));
    const fresh = present.filter((id) => !this.players.get(id)!.hasSeeked);
    const pool = fresh.length ? fresh : present;
    return pool[0] ?? [...this.players.keys()][0];
  }

  private startRound() {
    this.round++;
    this.seekerId = this.pickSeeker();
    this.found = [];
    this.revealed = false;
    const spawns = shuffle([...this.map.hiderSpawns]);
    let i = 0;
    for (const p of this.players.values()) {
      p.disguise = '';
      p.locked = false;
      p.input = { dx: 0, dz: 0, seq: p.input.seq };
      p.lastSwap = p.lastTag = p.lastTaunt = 0;
      p.roundPoints = 0;
      p.alias = 'e' + crypto.randomBytes(3).toString('hex');
      p.ready = false;
      if (p.id === this.seekerId) {
        p.role = 'seeker';
        p.alive = true;
        p.hasSeeked = true;
        Object.assign(p, this.map.seekerSpawn);
      } else {
        p.role = p.conn ? 'hider' : 'spectator';
        p.alive = p.role === 'hider';
        const s = spawns[i++ % spawns.length];
        p.x = s.x; p.z = s.z;
      }
      p.r = 0;
    }
    this.setPhase('countdown', COUNTDOWN_MS);
  }

  private setPhase(phase: Phase, ms: number) {
    this.phase = phase;
    this.phaseEndsAt = this.now() + ms;
    if (phase === 'seeking') {
      this.seekStartedAt = this.now();
      this.nextPingAt = this.phaseEndsAt - PING_START_MS;
    }
    this.broadcastRoom();
  }

  private trySwap(p: Player, target: string, t: number) {
    if (p.role !== 'hider' || !p.alive) return;
    if (this.phase !== 'hiding' && this.phase !== 'seeking') return;
    if (t - p.lastSwap < SWAP_COOLDOWN_MS) return;
    const prop = this.map.props.find((q) => q.id === target);
    if (!prop) return;
    const type = PROPS[prop.type];
    if (!type.swappable) return;
    const [hx, hz] = propExtents(type, prop.rot);
    if (distToBox(p, { x: prop.x, z: prop.z, hx, hz }) > SWAP_RANGE) return;
    p.lastSwap = t;
    p.disguise = prop.type;
    p.locked = false;
    p.r = (prop.rot * Math.PI) / 2;
    // Make sure the bigger disguise isn't stuck inside furniture.
    const r = disguiseRadius(type);
    const fixed = move(p, 0, 0, 0, 0, r, this.colliders, this.map.width, this.map.depth);
    p.x = fixed.x; p.z = fixed.z;
    for (const o of this.players.values()) {
      o.conn?.send({ t: 'swapped', id: o.id === this.seekerId ? p.alias : p.id, prop: prop.type, x: p.x, z: p.z });
    }
  }

  private tryTag(p: Player, target: string, t: number) {
    if (p.id !== this.seekerId || this.phase !== 'seeking') return;
    if (t - p.lastTag < TAG_COOLDOWN_MS) return;
    p.lastTag = t;
    const hider = [...this.players.values()].find((o) => o.alias === target && o.role === 'hider' && o.alive);
    if (hider) {
      const reach = TAG_RANGE + (hider.disguise ? disguiseRadius(PROPS[hider.disguise]) : PLAYER_RADIUS) + 0.3;
      if (dist(p, hider) > reach) return;
      hider.alive = false;
      hider.locked = false;
      const atMs = t - this.seekStartedAt;
      this.found.push({ id: hider.id, by: p.id, atMs });
      p.roundPoints += SCORE.seekerPerFind;
      hider.roundPoints += Math.floor(atMs / 10_000) * SCORE.hiderPer10s;
      this.broadcast({ t: 'found', id: hider.id, by: p.id, x: hider.x, z: hider.z });
      this.broadcastRoom();
      this.checkAllFound();
      return;
    }
    const prop = this.map.props.find((q) => q.id === target);
    if (!prop || !PROPS[prop.type].solid) return;
    const [hx, hz] = propExtents(PROPS[prop.type], prop.rot);
    if (distToBox(p, { x: prop.x, z: prop.z, hx, hz }) > TAG_RANGE) return;
    this.phaseEndsAt -= TAG_MISS_PENALTY_MS;
    p.conn?.send({ t: 'miss', target, penaltyMs: TAG_MISS_PENALTY_MS });
  }

  private checkAllFound() {
    if (this.phase !== 'seeking' && this.phase !== 'hiding') return;
    const left = [...this.players.values()].filter((o) => o.role === 'hider' && o.alive);
    if (left.length === 0) this.endRound('seeker');
  }

  private endRound(winner: 'seeker' | 'hiders') {
    const t = this.now();
    const seeker = this.seekerId ? this.players.get(this.seekerId) : undefined;
    const survivedMs = this.phase === 'seeking' ? t - this.seekStartedAt : 0;
    for (const p of this.players.values()) {
      if (p.role === 'hider' && p.alive) {
        p.roundPoints += Math.floor(survivedMs / 10_000) * SCORE.hiderPer10s + SCORE.hiderSurvived;
      }
    }
    if (winner === 'seeker' && seeker) {
      const leftMs = Math.max(0, this.phaseEndsAt - t);
      seeker.roundPoints += Math.floor(leftMs / 30_000) * SCORE.seekerPer30sLeft;
    }
    const points: Record<string, number> = {};
    for (const p of this.players.values()) { p.score += p.roundPoints; points[p.id] = p.roundPoints; }
    const final = this.round >= this.totalRounds;
    const result: RoundResult = { winner, seekerId: this.seekerId ?? '', found: this.found, points, final };
    this.setPhase('results', RESULTS_MS);
    this.broadcast({ t: 'results', result });
  }

  /** Advance the simulation by dt seconds. Called TICK_HZ times per second. */
  tick(dt: number) {
    const t = this.now();
    // Drop players whose reconnect window ran out.
    for (const p of [...this.players.values()]) {
      if (!p.conn && p.disconnectedAt && t - p.disconnectedAt > (this.phase === 'lobby' ? 15_000 : RECONNECT_GRACE_MS)) this.leave(p.id);
    }
    if (this.phase === 'lobby') return;

    if (t >= this.phaseEndsAt) {
      if (this.phase === 'countdown') this.setPhase('hiding', this.settings.hideSeconds * 1000);
      else if (this.phase === 'hiding') this.setPhase('seeking', this.settings.seekSeconds * 1000);
      else if (this.phase === 'seeking') this.endRound('hiders');
      else if (this.phase === 'results') {
        if (this.round >= this.totalRounds || this.connectedCount < MIN_PLAYERS) {
          this.phase = 'lobby';
          for (const p of this.players.values()) { p.role = 'hider'; p.alive = true; p.disguise = ''; }
          this.seekerId = null;
          this.broadcastRoom();
          return;
        }
        this.startRound();
      }
    }

    if (this.phase === 'hiding' || this.phase === 'seeking') {
      for (const p of this.players.values()) {
        if (!p.alive || p.role === 'spectator') continue;
        const frozen = (p.role === 'seeker' && this.phase === 'hiding') || p.locked;
        if (frozen) continue;
        const { dx, dz } = p.input;
        if (dx === 0 && dz === 0) continue;
        const speed = p.role === 'seeker' ? SEEKER_SPEED : PLAYER_SPEED * (p.disguise ? PROPS[p.disguise].speed : 1);
        const r = p.disguise ? disguiseRadius(PROPS[p.disguise]) : PLAYER_RADIUS;
        const next = move(p, dx, dz, speed, dt, r, this.colliders, this.map.width, this.map.depth);
        if (!p.disguise) p.r = Math.atan2(dx, dz);
        p.x = next.x; p.z = next.z;
      }
    }

    if (this.phase === 'seeking') {
      const left = this.phaseEndsAt - t;
      if (left <= PING_START_MS && t >= this.nextPingAt) {
        this.nextPingAt = t + PING_EVERY_MS;
        this.sendPing([...this.players.values()].filter((p) => p.role === 'hider' && p.alive), false);
      }
      if (!this.revealed && left <= REVEAL_AT_MS) {
        this.revealed = true;
        const spots = [...this.players.values()].filter((p) => p.role === 'hider' && p.alive).map((p) => ({ x: p.x, z: p.z }));
        if (spots.length) this.broadcast({ t: 'reveal', spots });
      }
    }
    this.sendSnapshots(t);
  }

  private sendPing(hiders: Player[], manual: boolean) {
    if (!hiders.length) return;
    for (const o of this.players.values()) {
      const seeker = o.id === this.seekerId;
      o.conn?.send({ t: 'ping', manual, spots: hiders.map((h) => ({ x: h.x, z: h.z, id: seeker ? h.alias : h.id })) });
    }
  }

  private sendSnapshots(t: number) {
    const left = Math.max(0, this.phaseEndsAt - t);
    const all = [...this.players.values()].filter((p) => p.role !== 'spectator');
    const snap = (p: Player, forSeeker: boolean): SnapPlayer => ({
      id: forSeeker && p.role === 'hider' ? p.alias : p.id,
      x: round2(p.x), z: round2(p.z), r: round2(p.r), d: p.disguise,
      l: forSeeker ? false : p.locked, a: p.alive, s: p.input.seq,
    });
    // The seeker never learns which entity is which player.
    const seekerView = all.filter((p) => p.role === 'seeker' || p.alive).map((p) => snap(p, true));
    const fullView = all.map((p) => snap(p, false));
    for (const o of this.players.values()) {
      if (!o.conn) continue;
      const isSeeker = o.id === this.seekerId && this.phase !== 'results';
      o.conn.send({ t: 'snap', phase: this.phase, left, players: isSeeker ? seekerView : fullView });
    }
  }

  info(): RoomInfo {
    const players: LobbyPlayer[] = [...this.players.values()].sort((a, b) => a.joinedAt - b.joinedAt).map((p) => ({
      id: p.id, name: p.name, color: p.color, ready: p.ready, connected: !!p.conn, score: p.score, role: p.role, alive: p.alive,
    }));
    return {
      code: this.code, hostId: this.hostId, phase: this.phase, round: this.round, totalRounds: this.totalRounds,
      seekerId: this.seekerId, settings: { ...this.settings }, players,
    };
  }

  private broadcast(msg: ServerMsg) {
    for (const p of this.players.values()) p.conn?.send(msg);
  }

  private broadcastRoom() {
    const room = this.info();
    for (const p of this.players.values()) p.conn?.send({ t: 'room', room });
  }
}

function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
