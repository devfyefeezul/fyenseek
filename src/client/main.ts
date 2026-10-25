import './style.css';
import { MAPS, staticColliders, type Box } from '../shared/map';
import { PROPS, disguiseRadius, propExtents } from '../shared/props';
import { move, distToBox } from '../shared/movement';
import {
  PLAYER_COLORS, PLAYER_RADIUS, PLAYER_SPEED, SEEKER_SPEED, SWAP_RANGE, TAG_RANGE, MIN_PLAYERS, ROOM_CODE_LENGTH,
} from '../shared/constants';
import type { RoomInfo, ServerMsg, SnapPlayer, Phase } from '../shared/protocol';
import { Net, loadSession, saveSession, wakeServer } from './net';
import { Controls } from './controls';
import { World, type RenderPlayer } from './world';
import { sfx, spatial, unlockAudio } from './sfx';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------- State ----------
let me = '';
let room: RoomInfo | null = null;
let colliders: Box[] = [];
let snaps: { at: number; left: number; phase: Phase; players: Map<string, SnapPlayer> }[] = [];
let pred: { x: number; z: number } | null = null;
let lastSentDir = { dx: 0, dz: 0 };
let lastSentAt = 0;
let seq = 0;
let tapped: string | null = null;
let selected: string | null = null;
let lastPhase: Phase | null = null;
let lastCount = -1;
let autoRejoin = false;
const store = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};

wakeServer();
const net = new Net();
// Tell people why nothing happens while a sleeping server starts up.
let connected = false;
const slowTimer = setTimeout(() => { if (!connected) $('conn-status').hidden = false; }, 1500);
net.onStatus = (ok) => {
  connected = ok;
  if (ok) { clearTimeout(slowTimer); $('conn-status').hidden = true; }
  else if (!$('home').hidden) $('conn-status').hidden = false;
};
const world = new World($<HTMLCanvasElement>('canvas'));
const controls = new Controls($('stick'), document.querySelector('.stick-base') as HTMLElement, $('stick-knob'));

// ---------- Screens ----------
function show(id: 'home' | 'lobby' | 'game') {
  for (const s of ['home', 'lobby', 'game']) $(s).hidden = s !== id;
  if (id === 'game') requestAnimationFrame(() => world.resize());
}

function toast(text: string, kind: '' | 'good' | 'bad' = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = text;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), 2700);
}

const fmt = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// ---------- Home ----------
let myColor = store.get('hs.color') || PLAYER_COLORS[Math.floor(Math.random() * PLAYER_COLORS.length)];
$<HTMLInputElement>('name').value = store.get('hs.name') || '';
const swatches = $('colors');
for (const c of PLAYER_COLORS) {
  const b = document.createElement('button');
  b.className = 'swatch';
  b.style.background = c;
  b.setAttribute('role', 'radio');
  b.setAttribute('aria-label', `Colour ${c}`);
  b.setAttribute('aria-checked', String(c === myColor));
  b.onclick = () => {
    myColor = c;
    store.set('hs.color', c);
    for (const s of swatches.children) s.setAttribute('aria-checked', String(s === b));
  };
  swatches.appendChild(b);
}
const urlCode = (location.pathname.match(/^\/r\/([A-Za-z0-9]{4,8})/)?.[1] || new URLSearchParams(location.search).get('r') || '').toUpperCase();
if (urlCode) $<HTMLInputElement>('code').value = urlCode;

function myName() {
  const n = $<HTMLInputElement>('name').value.trim() || `Player ${Math.floor(Math.random() * 90 + 10)}`;
  store.set('hs.name', n);
  return n;
}

$('create').onclick = () => {
  unlockAudio();
  $('home-error').textContent = '';
  net.send({ t: 'create', name: myName(), color: myColor });
};
const doJoin = () => {
  unlockAudio();
  const code = $<HTMLInputElement>('code').value.trim().toUpperCase();
  if (code.length !== ROOM_CODE_LENGTH) { $('home-error').textContent = `Room codes have ${ROOM_CODE_LENGTH} letters.`; return; }
  $('home-error').textContent = '';
  net.send({ t: 'join', code, name: myName(), color: myColor });
};
$('join').onclick = doJoin;
$<HTMLInputElement>('code').addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(); });
$<HTMLInputElement>('code').addEventListener('input', (e) => {
  const el = e.target as HTMLInputElement;
  el.value = el.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});

// Rejoin after a refresh.
const saved = loadSession();
if (saved && (!urlCode || urlCode === saved.code)) {
  autoRejoin = true;
  net.send({ t: 'join', code: saved.code, name: saved.name, color: saved.color, token: saved.token });
}
net.onReconnect = () => {
  const s = loadSession();
  if (s) { autoRejoin = true; net.send({ t: 'join', code: s.code, name: s.name, color: s.color, token: s.token }); }
};

// ---------- Lobby ----------
$('leave').onclick = () => {
  net.send({ t: 'leave' });
  saveSession(null);
  room = null;
  history.replaceState(null, '', '/');
  show('home');
};
$('share').onclick = async () => {
  if (!room) return;
  const url = `${location.origin}/r/${room.code}`;
  try {
    if (navigator.share) await navigator.share({ title: 'HidenSeek', text: `Join my HidenSeek room: ${room.code}`, url });
    else { await navigator.clipboard.writeText(url); toastLobby('Invite link copied'); }
  } catch { /* user cancelled */ }
};
function toastLobby(text: string) { $('lobby-error').textContent = ''; $('settings-note').textContent = text; setTimeout(() => { $('settings-note').textContent = ''; }, 2500); }
$('ready').onclick = () => {
  const p = room?.players.find((q) => q.id === me);
  net.send({ t: 'ready', v: !p?.ready });
};
$('start').onclick = () => { unlockAudio(); net.send({ t: 'start' }); };
const settingInputs: [string, keyof RoomInfo['settings'], boolean][] = [
  ['set-map', 'mapId', false], ['set-hide', 'hideSeconds', true], ['set-seek', 'seekSeconds', true],
  ['set-rounds', 'rounds', true], ['set-seeker', 'seekerMode', false],
];
for (const [id, key, numeric] of settingInputs) {
  $<HTMLSelectElement>(id).onchange = (e) => {
    const v = (e.target as HTMLSelectElement).value;
    net.send({ t: 'settings', s: { [key]: numeric ? Number(v) : v } });
  };
}

function renderLobby() {
  if (!room) return;
  const isHost = room.hostId === me;
  $('room-code').textContent = room.code;
  $('player-count').textContent = `${room.players.length}/8`;
  const ul = $('players');
  ul.replaceChildren();
  for (const p of room.players) {
    const li = document.createElement('li');
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = p.color;
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = p.name + (p.id === me ? ' (you)' : '');
    li.append(dot, name);
    const tag = (text: string, cls = '') => { const t = document.createElement('span'); t.className = `tag ${cls}`; t.textContent = text; li.append(t); };
    if (p.id === room.hostId) tag('Host');
    if (!p.connected) tag('Offline', 'off');
    else if (p.ready) tag('Ready', 'ready');
    if (isHost && p.id !== me) {
      const k = document.createElement('button');
      k.className = 'kick';
      k.textContent = 'Remove';
      k.setAttribute('aria-label', `Remove ${p.name}`);
      k.onclick = () => net.send({ t: 'kick', id: p.id });
      li.append(k);
    }
    ul.append(li);
  }
  const s = room.settings;
  $<HTMLSelectElement>('set-map').value = s.mapId;
  $<HTMLSelectElement>('set-hide').value = String(s.hideSeconds);
  $<HTMLSelectElement>('set-seek').value = String(s.seekSeconds);
  $<HTMLSelectElement>('set-rounds').value = String(s.rounds);
  $<HTMLSelectElement>('set-seeker').value = s.seekerMode;
  for (const [id] of settingInputs) $<HTMLSelectElement>(id).disabled = !isHost;
  if (!$('settings-note').textContent || $('settings-note').dataset.auto === '1') {
    $('settings-note').textContent = isHost ? '' : '(host picks)';
    $('settings-note').dataset.auto = '1';
  }
  const mine = room.players.find((p) => p.id === me);
  $('ready').textContent = mine?.ready ? 'Ready!' : "I'm ready";
  $('ready').classList.toggle('on', !!mine?.ready);
  $('start').hidden = !isHost;
  const online = room.players.filter((p) => p.connected).length;
  $<HTMLButtonElement>('start').disabled = online < MIN_PLAYERS;
  $('start').textContent = online < MIN_PLAYERS ? `Need ${MIN_PLAYERS} players` : 'Start game';
}

// ---------- Messages ----------
net.onMessage = (msg: ServerMsg) => {
  switch (msg.t) {
    case 'welcome': {
      me = msg.you;
      autoRejoin = false;
      saveSession({ code: msg.code, token: msg.token, name: myName(), color: myColor });
      history.replaceState(null, '', `/r/${msg.code}`);
      if (room) onRoom(room);
      break;
    }
    case 'error':
      if (autoRejoin && msg.code === 'not_found') {
        autoRejoin = false;
        saveSession(null);
        history.replaceState(null, '', '/');
        show('home');
        $('home-error').textContent = 'That room has closed.';
        return;
      }
      if (!$('home').hidden) $('home-error').textContent = msg.message;
      else if (!$('lobby').hidden) $('lobby-error').textContent = msg.message;
      else toast(msg.message, 'bad');
      break;
    case 'room':
      room = msg.room;
      if (me) onRoom(msg.room);
      break;
    case 'snap': {
      const players = new Map(msg.players.map((p) => [p.id, p]));
      snaps.push({ at: performance.now(), left: msg.left, phase: msg.phase, players });
      if (snaps.length > 30) snaps.shift();
      reconcile(players.get(me));
      break;
    }
    case 'swapped': {
      if (msg.id === me) sfx.swap();
      else {
        const sp = spatial(Math.hypot(msg.x - (pred?.x ?? msg.x), msg.z - (pred?.z ?? msg.z)), world.screenX(msg.x, msg.z));
        if (sp.vol > 0.05) sfx.pop(0.3 * sp.vol, sp.pan);
      }
      break;
    }
    case 'found': {
      world.poof(msg.x, msg.z);
      sfx.found();
      const who = room?.players.find((p) => p.id === msg.id);
      if (msg.id === me) toast('You were found!', 'bad');
      else toast(`${who?.name ?? 'A hider'} was found!`, msg.by === me ? 'good' : '');
      break;
    }
    case 'miss': {
      sfx.miss();
      const prop = world.map?.props.find((p) => p.id === msg.target);
      toast(`Just a ${prop ? PROPS[prop.type].name.toLowerCase() : 'thing'}. −5 s`, 'bad');
      break;
    }
    case 'ping':
      for (const s of msg.spots) {
        world.ping(s.x, s.z, msg.manual ? '#ff6fb5' : '#ffcc33');
        const here = pred ?? { x: s.x, z: s.z };
        const sp = spatial(Math.hypot(s.x - here.x, s.z - here.z), world.screenX(s.x, s.z));
        sfx.taunt(Math.max(sp.vol, 0.08), sp.pan);
      }
      break;
    case 'reveal':
      for (const s of msg.spots) world.reveal(s.x, s.z);
      toast('30 seconds left! Hiders flashed.', '');
      break;
    case 'results': showResults(msg.result); break;
    case 'chat': toast(`${msg.name}: ${msg.text}`); break;
    case 'kicked':
      saveSession(null);
      room = null;
      history.replaceState(null, '', '/');
      show('home');
      $('home-error').textContent = 'You were removed from the room.';
      break;
  }
};

function onRoom(r: RoomInfo) {
  const map = MAPS[r.settings.mapId];
  if (world.map?.id !== map.id) {
    colliders = staticColliders(map);
    void world.loadMap(map);
  }
  if (r.phase === 'lobby') {
    if (lastPhase && lastPhase !== 'lobby') { $('results').hidden = true; }
    show('lobby');
    renderLobby();
  } else {
    show('game');
    if (r.phase !== lastPhase) onPhase(r.phase);
  }
  lastPhase = r.phase;
}

function role() { return room?.players.find((p) => p.id === me)?.role ?? 'spectator'; }
function amSeeker() { return room?.seekerId === me; }
function amAlive() { const p = room?.players.find((q) => q.id === me); return !!p && p.alive && p.role !== 'spectator'; }

function onPhase(phase: Phase) {
  tapped = null;
  if (phase === 'countdown') {
    pred = null;
    snaps = [];
    $('results').hidden = true;
    $('spectate').hidden = true;
    const seeker = room?.players.find((p) => p.id === room?.seekerId);
    $('intro-round').textContent = `Round ${room?.round} of ${room?.totalRounds}`;
    if (role() === 'spectator') {
      $('intro-role').textContent = 'You are watching';
      $('intro-tip').textContent = 'You joined mid-match. You will play next round.';
    } else if (amSeeker()) {
      $('intro-role').textContent = 'You are the seeker!';
      $('intro-tip').textContent = 'Close your eyes while they hide. Then tap suspicious objects and press Tag. Wrong guesses cost 5 seconds.';
    } else {
      $('intro-role').textContent = 'You are hiding!';
      $('intro-tip').textContent = `Walk up to an object and press Swap to become it, then Lock to keep still. ${seeker?.name ?? 'The seeker'} is coming.`;
    }
    $('intro').hidden = false;
    lastCount = -1;
  } else {
    $('intro').hidden = true;
  }
  if (phase === 'hiding' || phase === 'seeking') sfx.go();
  $('blindfold').hidden = !(phase === 'hiding' && amSeeker());
  updateButtons();
}

function showResults(result: import('../shared/protocol').RoundResult) {
  if (!room) return;
  const iWon = (result.winner === 'seeker') === (result.seekerId === me);
  if (role() !== 'spectator') (iWon ? sfx.win : sfx.lose)();
  const seeker = room.players.find((p) => p.id === result.seekerId);
  $('res-title').textContent = result.winner === 'seeker' ? `${seeker?.name ?? 'Seeker'} found everyone!` : 'Hiders win!';
  $('res-sub').textContent = result.final ? 'Final scores' : `Round ${room.round} of ${room.totalRounds}`;
  const list = $('res-table');
  list.replaceChildren();
  const sorted = [...room.players].sort((a, b) => b.score - a.score);
  for (const p of sorted) {
    const li = document.createElement('li');
    const dot = document.createElement('span'); dot.className = 'dot'; dot.style.background = p.color;
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = p.name + (p.id === result.seekerId ? ' (seeker)' : '');
    const pts = document.createElement('span'); pts.className = 'pts'; pts.textContent = `+${result.points[p.id] ?? 0}`;
    const tot = document.createElement('span'); tot.className = 'tot'; tot.textContent = String(p.score);
    li.append(dot, nm, pts, tot);
    list.append(li);
  }
  $('res-next').dataset.final = result.final ? '1' : '0';
  $('results').hidden = false;
}

// ---------- Game actions ----------
function act(kind: 'swap' | 'lock' | 'rotate' | 'taunt' | 'tag') {
  unlockAudio();
  const phase = currentPhase();
  if (phase !== 'hiding' && phase !== 'seeking') return;
  const self = latestSelf();
  if (kind === 'swap' && selected) net.send({ t: 'swap', target: selected });
  if (kind === 'lock' && self?.d) net.send({ t: 'lock', v: !self.l });
  if (kind === 'rotate') net.send({ t: 'rotate' });
  if (kind === 'taunt') net.send({ t: 'taunt' });
  if (kind === 'tag' && selected) { net.send({ t: 'tag', target: selected }); tapped = null; }
}
$('b-swap').onclick = () => act('swap');
$('b-lock').onclick = () => act('lock');
$('b-rotate').onclick = () => act('rotate');
$('b-taunt').onclick = () => act('taunt');
$('b-tag').onclick = () => act('tag');
window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement)?.tagName === 'INPUT' || $('game').hidden) return;
  const k = e.key.toLowerCase();
  if (k === 'e') act('swap');
  else if (k === 'f') act('lock');
  else if (k === 'r') act('rotate');
  else if (k === 't') act('taunt');
  else if (k === ' ' || k === 'enter') { e.preventDefault(); act('tag'); }
});
$('canvas').addEventListener('pointerdown', (e) => {
  unlockAudio();
  const id = world.pick(e.clientX, e.clientY);
  tapped = id && id !== me ? id : null;
});

function currentPhase(): Phase { return snaps.at(-1)?.phase ?? room?.phase ?? 'lobby'; }
function latestSelf(): SnapPlayer | undefined { return snaps.at(-1)?.players.get(me); }

function reconcile(server: SnapPlayer | undefined) {
  if (!server) { pred = null; return; }
  if (!pred || !server.a) { pred = { x: server.x, z: server.z }; return; }
  const err = Math.hypot(server.x - pred.x, server.z - pred.z);
  if (err > 1.5 || server.l) pred = { x: server.x, z: server.z };
  else { pred.x += (server.x - pred.x) * 0.12; pred.z += (server.z - pred.z) * 0.12; }
}

function canMove(): boolean {
  const phase = currentPhase();
  if (!amAlive()) return false;
  if (phase === 'seeking') return !latestSelf()?.l;
  if (phase === 'hiding') return !amSeeker() && !latestSelf()?.l;
  return false;
}

function inRange(id: string, from: { x: number; z: number }, range: number) {
  const e = world.extents(id);
  return !!e && distToBox(from, e) <= range;
}

function pickTarget(from: { x: number; z: number }): string | null {
  const map = world.map;
  if (!map) return null;
  const seeker = amSeeker();
  const range = seeker ? TAG_RANGE : SWAP_RANGE;
  const ok = (id: string) => {
    if (id === me) return false;
    const prop = map.props.find((p) => p.id === id);
    if (prop) return seeker ? PROPS[prop.type].solid : PROPS[prop.type].swappable;
    return seeker; // other entities are hiders, only the seeker can target them
  };
  if (tapped && ok(tapped) && inRange(tapped, from, range)) return tapped;
  let best: string | null = null, bestD = Infinity;
  const consider = (id: string, box: { x: number; z: number; hx: number; hz: number }) => {
    if (!ok(id)) return;
    const d = distToBox(from, box);
    if (d <= range && d < bestD) { bestD = d; best = id; }
  };
  for (const p of map.props) {
    const [hx, hz] = propExtents(PROPS[p.type], p.rot);
    consider(p.id, { x: p.x, z: p.z, hx, hz });
  }
  if (seeker) for (const id of snaps.at(-1)?.players.keys() ?? []) { const e = world.extents(id); if (e) consider(id, e); }
  return best;
}

function targetName(id: string): string {
  const prop = world.map?.props.find((p) => p.id === id);
  if (prop) return PROPS[prop.type].name;
  const p = snaps.at(-1)?.players.get(id);
  return p?.d ? PROPS[p.d].name : 'Someone';
}

function updateButtons() {
  const phase = currentPhase();
  const seeker = amSeeker();
  const alive = amAlive();
  const playing = phase === 'hiding' || phase === 'seeking';
  $('hider-buttons').hidden = seeker;
  $('seeker-buttons').hidden = !seeker;
  const self = latestSelf();
  $<HTMLButtonElement>('b-swap').disabled = !(playing && alive && selected);
  $<HTMLButtonElement>('b-lock').disabled = !(playing && alive && self?.d);
  $('b-lock').classList.toggle('on', !!self?.l);
  $('b-lock').textContent = self?.l ? 'Locked' : 'Lock';
  $<HTMLButtonElement>('b-rotate').disabled = !(playing && alive);
  $<HTMLButtonElement>('b-taunt').disabled = !(phase === 'seeking' && alive);
  $<HTMLButtonElement>('b-tag').disabled = !(phase === 'seeking' && selected);
  controls.enabled = canMove();
}

// ---------- Frame loop ----------
let lastFrame = performance.now();
function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  if ($('game').hidden || !room || !world.map) return;
  const latest = snaps.at(-1);
  const phase = currentPhase();
  const self = latest?.players.get(me);

  // Move myself right away (prediction) and tell the server what I'm pressing.
  const dir = canMove() ? controls.direction() : { dx: 0, dz: 0 };
  if (pred && self && canMove()) {
    const speed = amSeeker() ? SEEKER_SPEED : PLAYER_SPEED * (self.d ? PROPS[self.d].speed : 1);
    const r = self.d ? disguiseRadius(PROPS[self.d]) : PLAYER_RADIUS;
    const map = world.map;
    const n = move(pred, dir.dx, dir.dz, speed, dt, r, colliders, map.width, map.depth);
    pred.x = n.x; pred.z = n.z;
  }
  const changed = Math.abs(dir.dx - lastSentDir.dx) > 0.05 || Math.abs(dir.dz - lastSentDir.dz) > 0.05;
  if (changed || ((dir.dx || dir.dz) && now - lastSentAt > 100)) {
    net.send({ t: 'input', dx: Math.round(dir.dx * 100) / 100, dz: Math.round(dir.dz * 100) / 100, seq: ++seq });
    lastSentDir = dir;
    lastSentAt = now;
  }

  // Others are drawn 100 ms in the past, between two snapshots, for smoothness.
  const renderAt = now - 100;
  let a = snaps[0], b = snaps[0];
  for (let i = snaps.length - 1; i >= 0; i--) {
    if (snaps[i].at <= renderAt) { a = snaps[i]; b = snaps[i + 1] ?? snaps[i]; break; }
  }
  const k = a && b && b.at > a.at ? Math.min(1, (renderAt - a.at) / (b.at - a.at)) : 1;
  const list: RenderPlayer[] = [];
  const seekerView = amSeeker() && phase !== 'results';
  if (latest) {
    for (const [id, p] of latest.players) {
      if (!p.a) continue;
      const pa = a?.players.get(id) ?? p, pb = b?.players.get(id) ?? p;
      let x = pa.x + (pb.x - pa.x) * k, z = pa.z + (pb.z - pa.z) * k;
      let r = pb.r;
      if (id === me && pred) { x = pred.x; z = pred.z; r = p.r; if (!p.d && (dir.dx || dir.dz)) r = Math.atan2(dir.dx, dir.dz); }
      const info = room.players.find((q) => q.id === id);
      const isSeeker = id === room.seekerId;
      list.push({
        id, x, z, r, d: p.d, color: info?.color ?? '#ffffff', name: info?.name ?? '', self: id === me, seeker: isSeeker,
        showName: id === me || isSeeker || (!seekerView && !!info),
      });
    }
  }
  // Seeker sees nothing during hiding.
  world.setPlayers(phase === 'hiding' && amSeeker() ? [] : list);

  // Camera: me while I'm in the round, otherwise the seeker.
  const followId = amAlive() ? me : room.seekerId;
  const f = list.find((p) => p.id === followId) ?? list[0];
  if (f) world.follow(f.x, f.z, phase === 'countdown');

  // Target selection for Swap / Tag.
  const from = pred ?? (self ? { x: self.x, z: self.z } : null);
  selected = from && amAlive() && (phase === 'hiding' || phase === 'seeking') && !(amSeeker() && phase === 'hiding') ? pickTarget(from) : null;
  if (amSeeker() && phase !== 'seeking') selected = null;
  world.select(selected);
  const label = $('target-label');
  if (selected) {
    label.hidden = false;
    label.textContent = amSeeker() ? `Tag: ${targetName(selected)}?` : `Swap into: ${targetName(selected)}`;
  } else label.hidden = true;

  // HUD.
  const left = latest ? latest.left - (now - latest.at) : 0;
  $('timer').textContent = fmt(left);
  $('timer').classList.toggle('low', phase === 'seeking' && left < 30_000);
  $('blind-timer').textContent = fmt(left);
  const chip = $('phase-chip');
  chip.className = `chip ${amSeeker() ? 'seeker' : role() === 'hider' ? 'hider' : ''}`;
  chip.textContent = phase === 'countdown' ? 'Get ready'
    : phase === 'hiding' ? (amSeeker() ? 'Wait...' : 'Hide!')
    : phase === 'seeking' ? (amSeeker() ? 'Seek!' : amAlive() ? 'Stay still!' : 'Found')
    : 'Round over';
  const hidersLeft = room.players.filter((p) => p.role === 'hider' && p.alive).length;
  $('left-chip').textContent = `${hidersLeft} hiding`;
  $('spectate').hidden = !(phase === 'seeking' || phase === 'hiding') || amAlive() || amSeeker();
  if (phase === 'countdown') {
    const c = Math.ceil(left / 1000);
    $('intro-count').textContent = String(Math.max(c, 0));
    if (c !== lastCount && c <= 3 && c > 0) sfx.tick();
    lastCount = c;
  }
  if (phase === 'results' && !$('results').hidden) {
    $('res-next').textContent = $('res-next').dataset.final === '1' ? `Back to the lobby in ${Math.ceil(left / 1000)} s` : `Next round in ${Math.ceil(left / 1000)} s`;
  }
  updateButtons();
  world.render();
}
requestAnimationFrame(frame);

window.addEventListener('resize', () => world.resize());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') lastFrame = performance.now();
});

// Keep the screen on while in a room, where supported.
let wakeLock: { release(): Promise<void> } | null = null;
async function keepAwake() {
  try {
    const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } };
    if (nav.wakeLock && !wakeLock) wakeLock = await nav.wakeLock.request('screen');
  } catch { /* not allowed: fine */ }
}
document.addEventListener('pointerdown', () => { if (room) void keepAwake(); }, { once: false });

// Debug handle for automated tests.
(window as unknown as { __hs: unknown }).__hs = { get me() { return me; }, get room() { return room; }, get selected() { return selected; }, get pred() { return pred; }, snaps: () => snaps.at(-1), world, act };
