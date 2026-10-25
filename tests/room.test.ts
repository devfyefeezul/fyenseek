import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Room, type Conn } from '../src/server/room';
import type { ServerMsg, SnapPlayer } from '../src/shared/protocol';
import { COUNTDOWN_MS, MAX_PLAYERS, RESULTS_MS, TAG_MISS_PENALTY_MS } from '../src/shared/constants';
import { MAPS } from '../src/shared/map';
import { PROPS } from '../src/shared/props';

class FakeConn implements Conn {
  msgs: ServerMsg[] = [];
  closed = false;
  send(m: ServerMsg) { this.msgs.push(m); }
  close() { this.closed = true; }
  last<T extends ServerMsg['t']>(t: T) { return [...this.msgs].reverse().find((m) => m.t === t) as Extract<ServerMsg, { t: T }> | undefined; }
}

function setup(n = 3) {
  let now = 1_000_000;
  const clock = { advance(ms: number) { now += ms; } };
  const room = new Room('ABC234', () => now);
  const players = Array.from({ length: n }, (_, i) => {
    const conn = new FakeConn();
    const r = room.join(conn, `P${i}`, '#ff7a59');
    if ('error' in r) throw new Error('full');
    return { id: r.id, token: r.token, conn };
  });
  // Step the room forward in simulated 50 ms ticks.
  const run = (ms: number) => { for (let t = 0; t < ms; t += 50) { clock.advance(50); room.tick(0.05); } };
  return { room, players, clock, run };
}

const map = MAPS['cozy-house'];

test('only the host can start, and it needs 2 players', () => {
  const { room, players } = setup(1);
  room.handle(players[0].id, { t: 'start' });
  assert.equal(players[0].conn.last('error')?.code, 'too_few');
  const other = new FakeConn();
  const r = room.join(other, 'B', '#4cb5ff');
  assert.ok(!('error' in r));
  room.handle(r.id, { t: 'start' });
  assert.equal(other.last('error')?.code, 'not_host');
  room.handle(players[0].id, { t: 'start' });
  assert.equal(room.currentPhase, 'countdown');
});

test('a room holds at most 8 players', () => {
  const { room } = setup(MAX_PLAYERS);
  assert.deepEqual(room.join(new FakeConn(), 'Extra', ''), { error: 'full' });
});

test('players get distinct colours and clean names', () => {
  const { room } = setup(3);
  const info = room.info();
  assert.equal(new Set(info.players.map((p) => p.color)).size, 3);
  const r = room.join(new FakeConn(), '<b>Very long name here!!</b>', '#nope');
  assert.ok(!('error' in r));
  const p = room.info().players.find((q) => q.id === r.id)!;
  assert.ok(!p.name.includes('<'));
  assert.ok(p.name.length <= 14);
});

test('full round: hide, swap, seek, tag everyone, seeker wins', () => {
  const { room, players, run } = setup(3);
  room.handle(players[0].id, { t: 'start' });
  const info = room.info();
  const seekerId = info.seekerId!;
  assert.equal(seekerId, players[0].id, 'first joiner seeks first in rotate mode');
  const hiders = players.filter((p) => p.id !== seekerId);
  const seeker = players.find((p) => p.id === seekerId)!;

  run(COUNTDOWN_MS + 50);
  assert.equal(room.currentPhase, 'hiding');

  // Seeker can't move during hiding.
  const before = seeker.conn.last('snap')!.players.find((p) => p.id === seekerId)!;
  room.handle(seekerId, { t: 'input', dx: 1, dz: 0, seq: 1 });
  run(500);
  const after = seeker.conn.last('snap')!.players.find((p) => p.id === seekerId)!;
  assert.deepEqual([after.x, after.z], [before.x, before.z]);

  // Each hider walks to a swappable prop and becomes it.
  for (const h of hiders) {
    const me = h.conn.last('snap')!.players.find((p) => p.id === h.id)!;
    const target = map.props
      .filter((p) => PROPS[p.type].swappable)
      .sort((a, b) => Math.hypot(a.x - me.x, a.z - me.z) - Math.hypot(b.x - me.x, b.z - me.z))[0];
    room.handle(h.id, { t: 'swap', target: target.id });
    const now = h.conn.last('snap');
    run(100);
    const snap = h.conn.last('snap')!.players.find((p) => p.id === h.id)!;
    assert.ok(now);
    if (snap.d === '') {
      // Too far from the nearest prop: the server refuses, which is also correct.
      assert.ok(Math.hypot(target.x - me.x, target.z - me.z) > 3);
    }
  }

  run(60_000);
  assert.equal(room.currentPhase, 'seeking');

  // The seeker sees aliases, never real ids, for hiders.
  const seekerSnap = seeker.conn.last('snap')!;
  const seen = seekerSnap.players.map((p) => p.id);
  for (const h of hiders) assert.ok(!seen.includes(h.id), 'real hider id leaked to seeker');

  // Teleport-free check: tagging from across the map does nothing.
  const far = seekerSnap.players.find((p) => p.id !== seekerId)!;
  room.handle(seekerId, { t: 'tag', target: far.id });
  run(800);
  assert.equal(room.currentPhase, 'seeking');

  // Walk the seeker to each hider and tag it.
  for (let guard = 0; guard < 40 && room.currentPhase === 'seeking'; guard++) {
    const snap = seeker.conn.last('snap')!;
    const me = snap.players.find((p) => p.id === seekerId)!;
    const targets = snap.players.filter((p) => p.id !== seekerId);
    if (!targets.length) break;
    const t = targets[0];
    // Walking can get stuck behind furniture (reachability is covered by map.test),
    // so put the seeker next to the target: this test is about tagging.
    walkTo(room, seekerId, me, t, run, () => seeker.conn.last('snap')!.players.find((p) => p.id === seekerId)!);
    const sp = (room as unknown as { players: Map<string, { x: number; z: number }> }).players.get(seekerId)!;
    if (Math.hypot(sp.x - t.x, sp.z - t.z) > 1.6) { sp.x = t.x + 1; sp.z = t.z; }
    run(800);
    room.handle(seekerId, { t: 'tag', target: t.id });
    run(100);
  }
  const res = players[1].conn.last('results');
  assert.ok(res, 'round ended');
  assert.equal(res!.result.winner, 'seeker');
  assert.equal(res!.result.found.length, 2);
  assert.ok(res!.result.points[seekerId] >= 200);
});

function walkTo(room: Room, id: string, from: SnapPlayer, to: SnapPlayer, run: (ms: number) => void, me: () => SnapPlayer) {
  // Server-side helper for tests: teleport isn't possible through the protocol,
  // so steer with inputs and nudge around furniture with a simple wall-follow.
  for (let i = 0; i < 400; i++) {
    const p = me();
    const dx = to.x - p.x, dz = to.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d < 1.6) break;
    const jitter = i % 40 < 20 ? 0 : (i % 80 < 40 ? 1 : -1);
    room.handle(id, { t: 'input', dx: dx / d + jitter * (-dz / d), dz: dz / d + jitter * (dx / d), seq: i });
    run(50);
  }
  room.handle(id, { t: 'input', dx: 0, dz: 0, seq: 999 });
}

test('tagging a real prop costs the seeker 5 seconds', () => {
  const { room, players, run } = setup(2);
  room.handle(players[0].id, { t: 'start' });
  run(COUNTDOWN_MS + 60_000 + 100);
  assert.equal(room.currentPhase, 'seeking');
  const leftBefore = players[0].conn.last('snap')!.left;
  // Seeker spawn is in the hallway; the hallway rug is flat, so pick a solid prop nearby by walking to it.
  const lamp = map.props.find((p) => p.type === 'stool_wood' && p.x === 19)!;
  const me = players[0].conn.last('snap')!.players.find((p) => p.id === players[0].id)!;
  walkTo(room, players[0].id, me, { ...me, x: lamp.x, z: lamp.z }, run, () => players[0].conn.last('snap')!.players.find((p) => p.id === players[0].id)!);
  const elapsedStart = players[0].conn.last('snap')!.left;
  room.handle(players[0].id, { t: 'tag', target: lamp.id });
  const miss = players[0].conn.last('miss');
  assert.ok(miss, 'got a miss');
  run(50);
  const leftAfter = players[0].conn.last('snap')!.left;
  assert.ok(elapsedStart - leftAfter >= TAG_MISS_PENALTY_MS - 100, `penalty applied (${elapsedStart} -> ${leftAfter})`);
  assert.ok(leftBefore > leftAfter);
});

test('hiders win when time runs out; scores add up across rounds and the match returns to the lobby', () => {
  const { room, players, run } = setup(2);
  room.handle(players[0].id, { t: 'settings', s: { hideSeconds: 20, seekSeconds: 60, rounds: 2 } });
  room.handle(players[0].id, { t: 'start' });
  run(COUNTDOWN_MS + 20_000 + 60_000 + 200);
  const r1 = players[0].conn.last('results')!.result;
  assert.equal(r1.winner, 'hiders');
  assert.equal(r1.final, false);
  const hider = players[1].id;
  assert.equal(r1.points[hider], 6 * 10 + 150);
  run(RESULTS_MS + 100);
  assert.equal(room.info().seekerId, players[1].id, 'seeker rotates');
  run(COUNTDOWN_MS + 20_000 + 60_000 + 200);
  const r2 = players[0].conn.last('results')!.result;
  assert.equal(r2.final, true);
  run(RESULTS_MS + 100);
  assert.equal(room.currentPhase, 'lobby');
  const info = room.info();
  assert.equal(info.players.find((p) => p.id === hider)!.score, 210);
});

test('a dropped player can rejoin with their token and keep their slot', () => {
  const { room, players, run } = setup(3);
  room.handle(players[0].id, { t: 'start' });
  run(COUNTDOWN_MS + 100);
  room.disconnect(players[2].id, players[2].conn);
  run(5_000);
  const again = new FakeConn();
  const r = room.join(again, 'whatever', '', players[2].token);
  assert.ok(!('error' in r) && r.id === players[2].id);
  run(100);
  assert.ok(again.last('snap'));
});

test('the seeker leaving ends the round for the hiders', () => {
  const { room, players, run } = setup(3);
  room.handle(players[0].id, { t: 'start' });
  run(COUNTDOWN_MS + 100);
  room.leave(players[0].id);
  assert.equal(players[1].conn.last('results')!.result.winner, 'hiders');
  assert.equal(room.info().hostId, players[1].id, 'host passes on');
});
