// Messages between browser and server. Everything is JSON over one WebSocket.
import type { RoomSettings } from './constants';

export type Phase = 'lobby' | 'countdown' | 'hiding' | 'seeking' | 'results';
export type Role = 'seeker' | 'hider' | 'spectator';

export type ClientMsg =
  | { t: 'create'; name: string; color: string }
  | { t: 'join'; code: string; name: string; color: string; token?: string }
  | { t: 'ready'; v: boolean }
  | { t: 'settings'; s: Partial<RoomSettings> }
  | { t: 'start' }
  | { t: 'kick'; id: string }
  | { t: 'input'; dx: number; dz: number; seq: number }
  | { t: 'swap'; target: string }
  | { t: 'lock'; v: boolean }
  | { t: 'rotate' }
  | { t: 'tag'; target: string }
  | { t: 'taunt' }
  | { t: 'chat'; text: string }
  | { t: 'leave' };

export interface LobbyPlayer {
  id: string;
  name: string;
  color: string;
  ready: boolean;
  connected: boolean;
  score: number;
  role: Role;
  alive: boolean;
}

export interface RoomInfo {
  code: string;
  hostId: string;
  phase: Phase;
  round: number;
  totalRounds: number;
  seekerId: string | null;
  settings: RoomSettings;
  players: LobbyPlayer[];
}

/** One player in a game snapshot. */
export interface SnapPlayer {
  id: string;
  x: number;
  z: number;
  /** Facing / disguise rotation in radians. */
  r: number;
  /** Disguise prop type, or '' when in normal form. */
  d: string;
  l: boolean; // locked
  a: boolean; // still in the round (not found)
  s: number; // last input seq processed (only meaningful for you)
}

export interface RoundResult {
  winner: 'seeker' | 'hiders';
  seekerId: string;
  found: { id: string; by: string; atMs: number }[];
  points: Record<string, number>;
  final: boolean;
}

export type ServerMsg =
  | { t: 'welcome'; code: string; you: string; token: string; mapId: string }
  | { t: 'error'; code: 'not_found' | 'full' | 'bad_request' | 'not_host' | 'too_few'; message: string }
  | { t: 'room'; room: RoomInfo }
  | { t: 'snap'; phase: Phase; left: number; players: SnapPlayer[] }
  | { t: 'swapped'; id: string; prop: string; x: number; z: number }
  | { t: 'found'; id: string; by: string; x: number; z: number }
  | { t: 'miss'; target: string; penaltyMs: number }
  | { t: 'ping'; spots: { x: number; z: number; id: string }[]; manual: boolean }
  | { t: 'reveal'; spots: { x: number; z: number }[] }
  | { t: 'results'; result: RoundResult }
  | { t: 'chat'; id: string; name: string; text: string }
  | { t: 'kicked' };
