import type { Card, Suit } from './cards';

export type Lang = 'de' | 'fr' | 'en';

export interface Settings {
  /** lowest rank in the deck: 6 → 36 cards, 2 → 52 cards ... */
  lowestRank: number;
  /** seconds per turn; 0 = no timer */
  turnSeconds: number;
  /** Perevodnoy: defender may pass the attack on */
  transfer: boolean;
  maxPlayers: number;
}

export const DEFAULT_SETTINGS: Settings = { lowestRank: 6, turnSeconds: 30, transfer: true, maxPlayers: 6 };
export const TIMER_OPTIONS = [0, 10, 15, 20, 30, 45, 60, 90];
export const HAND_SIZE = 6;

export interface TablePair {
  attack: Card;
  defense: Card | null;
  by: string;
}

export interface PlayerView {
  id: string;
  name: string;
  connected: boolean;
  isHost: boolean;
  handCount: number;
  out: boolean;
  /** finishing place (1 = first out) */
  place: number | null;
  spectator: boolean;
  /** games lost as Durak in this room */
  durakCount: number;
}

export type ActionType = 'attack' | 'defend' | 'transfer' | 'take' | 'pass';

export interface GameAction {
  type: ActionType;
  card?: Card;
  /** index of the attack card on the table to beat */
  target?: number;
}

export interface LastEvent {
  seq: number;
  type: ActionType | 'bito' | 'pickup' | 'auto' | 'start' | 'out' | 'end';
  playerId: string | null;
}

export interface GameView {
  trump: Suit;
  trumpCard: Card;
  deckCount: number;
  discardCount: number;
  table: TablePair[];
  defenderId: string;
  attackerId: string;
  coAttackerId: string | null;
  taking: boolean;
  passed: string[];
  limit: number;
  /** epoch ms; null when no timer */
  deadline: number | null;
  /** who the current timer belongs to */
  timerFor: string[];
  finished: boolean;
  durakId: string | null;
  event: LastEvent | null;
}

export interface RoomView {
  code: string;
  you: string;
  hostId: string;
  settings: Settings;
  players: PlayerView[];
  phase: 'lobby' | 'playing' | 'finished';
  hand: Card[];
  game: GameView | null;
  serverNow: number;
}

export interface Reaction {
  from: string;
  emoji: string;
}

export const REACTIONS = ['👍', '😂', '😱', '🔥', '🤡', '😭', '🍀', '🥖'];
