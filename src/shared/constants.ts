// Game rules shared by the server and the client. Distances are in world
// units (a dining chair is about 1.25 units tall).

export const MAX_PLAYERS = 8;
export const MIN_PLAYERS = 2;
export const NAME_MAX = 14;
export const CHAT_MAX = 200;

export const ROOM_CODE_LENGTH = 6;
// No look-alike characters (0/O, 1/I/L).
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export const TICK_HZ = 20;

export const DEFAULT_SETTINGS = {
  hideSeconds: 60,
  seekSeconds: 180,
  rounds: 0, // 0 = one round per player, so everyone seeks once
  seekerMode: 'rotate' as 'rotate' | 'random',
  mapId: 'cozy-house',
};
export type RoomSettings = typeof DEFAULT_SETTINGS;

export const COUNTDOWN_MS = 10_000;
export const RESULTS_MS = 15_000;

export const PLAYER_RADIUS = 0.4;
export const PLAYER_SPEED = 4.2; // units per second
export const SEEKER_SPEED = 4.6;

export const SWAP_RANGE = 3.2;
export const SWAP_COOLDOWN_MS = 2_000;
export const TAG_RANGE = 2.6;
export const TAG_COOLDOWN_MS = 750;
export const TAG_MISS_PENALTY_MS = 5_000;
export const TAUNT_COOLDOWN_MS = 10_000;

// Automatic "ping" from every hider, starting when this much seek time is left.
export const PING_START_MS = 60_000;
export const PING_EVERY_MS = 20_000;
// One-second silhouette flash at this much time left.
export const REVEAL_AT_MS = 30_000;

export const RECONNECT_GRACE_MS = 60_000;
export const EMPTY_ROOM_TTL_MS = 5 * 60_000;

export const PLAYER_COLORS = ['#ff7a59', '#4cb5ff', '#7ed957', '#ffcc33', '#c58bff', '#ff6fb5', '#33d6c2', '#ff9f43'];

export const SCORE = {
  seekerPerFind: 100,
  seekerPer30sLeft: 50,
  hiderPer10s: 10,
  hiderSurvived: 150,
  hiderTaunt: 25,
};
