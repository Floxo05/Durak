import { randomBytes, randomInt } from 'node:crypto';
import { DurakGame } from './game';
import { SUITS, deckSize, sortHand, type Card } from '../shared/cards';
import {
  DEFAULT_SETTINGS,
  HAND_SIZE,
  TIMER_OPTIONS,
  type GameAction,
  type PlayerView,
  type RoomView,
  type Settings,
} from '../shared/protocol';

export interface RPlayer {
  id: string;
  token: string;
  name: string;
  sockets: Set<string>;
  spectator: boolean;
  durakCount: number;
  disconnectedAt: number | null;
}

/** how long a disconnected player's turn waits when the room has no timer */
const OFFLINE_GRACE_MS = 20_000;
/** a lobby player that is gone longer than this is removed */
const LOBBY_DROP_MS = 45_000;

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function newCode(existing: Map<string, Room>): string {
  for (;;) {
    let code = '';
    for (let i = 0; i < 4; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    if (!existing.has(code)) return code;
  }
}

export const cleanName = (n: unknown) =>
  String(n ?? '')
    .replace(/[\u0000-\u001f<>]/g, '')
    .trim()
    .slice(0, 16);

export function cleanCard(c: unknown): Card | undefined {
  if (!c || typeof c !== 'object') return undefined;
  const { s, r } = c as Card;
  if (!SUITS.includes(s) || !Number.isInteger(r) || r < 2 || r > 14) return undefined;
  return { s, r };
}

export function maxPlayersFor(lowestRank: number) {
  return Math.min(8, Math.floor(deckSize(lowestRank) / HAND_SIZE));
}

export class Room {
  players: RPlayer[] = [];
  hostId = '';
  settings: Settings = { ...DEFAULT_SETTINGS };
  phase: 'lobby' | 'playing' | 'finished' = 'lobby';
  game: DurakGame | null = null;
  lastActivity = Date.now();
  private timer: NodeJS.Timeout | null = null;
  private lastDurak: string | null = null;

  constructor(
    readonly code: string,
    private readonly onChange: (room: Room) => void,
  ) {}

  byToken(token: string) {
    return this.players.find((p) => p.token === token);
  }
  byId(id: string) {
    return this.players.find((p) => p.id === id);
  }
  get seated() {
    return this.players.filter((p) => !p.spectator);
  }

  join(token: string, name: string): RPlayer | string {
    this.lastActivity = Date.now();
    const existing = this.byToken(token);
    if (existing) {
      if (name) existing.name = name;
      return existing;
    }
    if (!name) return 'err.nameRequired';
    if (this.players.length >= 12) return 'err.roomFull';
    const playing = this.phase === 'playing';
    const spectator = playing || this.seated.length >= this.settings.maxPlayers;
    if (spectator && this.phase === 'lobby') return 'err.roomFull';
    const p: RPlayer = {
      id: randomBytes(6).toString('hex'),
      token,
      name,
      sockets: new Set(),
      spectator,
      durakCount: 0,
      disconnectedAt: null,
    };
    this.players.push(p);
    if (!this.hostId) this.hostId = p.id;
    return p;
  }

  connect(p: RPlayer, socketId: string) {
    p.sockets.add(socketId);
    p.disconnectedAt = null;
    this.schedule();
  }

  disconnect(p: RPlayer, socketId: string) {
    p.sockets.delete(socketId);
    if (p.sockets.size === 0) {
      p.disconnectedAt = Date.now();
      setTimeout(() => this.dropIfGone(p), LOBBY_DROP_MS + 100);
      this.schedule();
    }
  }

  private dropIfGone(p: RPlayer) {
    if (p.sockets.size > 0 || !this.players.includes(p)) return;
    if (this.phase === 'playing' && !p.spectator) return; // keep seat; timers play for them
    this.remove(p.id);
    this.onChange(this);
  }

  /** explicit leave or kick */
  remove(id: string) {
    const p = this.byId(id);
    if (!p) return;
    if (this.phase === 'playing' && !p.spectator) {
      // keep the seat so the game can continue (timers act for them); just forget the session
      p.token = `left-${randomBytes(8).toString('hex')}`;
      p.disconnectedAt = p.disconnectedAt ?? Date.now();
      p.sockets.clear();
    } else {
      this.players = this.players.filter((x) => x !== p);
    }
    if (this.hostId === id) this.pickHost();
    this.schedule();
  }

  private pickHost() {
    const next = this.players.find((p) => p.sockets.size > 0 && !p.token.startsWith('left-')) ?? this.players[0];
    this.hostId = next?.id ?? '';
  }

  updateSettings(by: string, s: Partial<Settings>): string | null {
    if (by !== this.hostId) return 'err.onlyHost';
    if (this.phase === 'playing') return 'err.gameRunning';
    const next = { ...this.settings };
    if (s.lowestRank !== undefined) next.lowestRank = Math.min(10, Math.max(2, Math.round(Number(s.lowestRank)) || 6));
    if (s.turnSeconds !== undefined && TIMER_OPTIONS.includes(Number(s.turnSeconds))) next.turnSeconds = Number(s.turnSeconds);
    if (s.transfer !== undefined) next.transfer = !!s.transfer;
    if (s.maxPlayers !== undefined) next.maxPlayers = Math.round(Number(s.maxPlayers)) || 6;
    next.maxPlayers = Math.min(maxPlayersFor(next.lowestRank), Math.max(2, next.maxPlayers));
    this.settings = next;
    return null;
  }

  start(by: string): string | null {
    if (by !== this.hostId) return 'err.onlyHost';
    if (this.phase === 'playing') return 'err.gameRunning';
    // spectators join the next game if there is room
    for (const p of this.players) {
      if (p.spectator && this.seated.length < this.settings.maxPlayers && !p.token.startsWith('left-')) p.spectator = false;
    }
    // players who left for good are dropped between games
    this.players = this.players.filter((p) => !p.token.startsWith('left-'));
    const seated = this.seated;
    if (seated.length < 2) return 'err.needTwo';
    if (seated.length > maxPlayersFor(this.settings.lowestRank)) return 'err.tooManyForDeck';

    const ids = seated.map((p) => p.id);
    let firstAttackerId: string | undefined;
    const di = this.lastDurak ? ids.indexOf(this.lastDurak) : -1;
    // the previous Durak gets attacked first
    if (di >= 0) firstAttackerId = ids[(di - 1 + ids.length) % ids.length];
    this.game = new DurakGame(ids, this.settings, { firstAttackerId });
    this.phase = 'playing';
    this.lastActivity = Date.now();
    this.schedule();
    return null;
  }

  act(by: string, a: GameAction): string | null {
    if (!this.game || this.phase !== 'playing') return 'err.noGame';
    const action: GameAction = { type: a.type };
    if (!['attack', 'defend', 'transfer', 'take', 'pass'].includes(a.type)) return 'err.invalid';
    if (a.card !== undefined) {
      action.card = cleanCard(a.card);
      if (!action.card) return 'err.invalid';
    }
    if (a.target !== undefined) action.target = Number(a.target);
    const err = this.game.act(by, action);
    if (!err) this.afterGameChange();
    return err;
  }

  private afterGameChange() {
    this.lastActivity = Date.now();
    const g = this.game;
    if (g?.finished && this.phase === 'playing') {
      this.phase = 'finished';
      this.lastDurak = g.durakId;
      const d = g.durakId ? this.byId(g.durakId) : null;
      if (d) d.durakCount++;
    }
    this.schedule();
  }

  /** (re)arm the turn timer */
  schedule() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const g = this.game;
    if (!g || this.phase !== 'playing' || g.finished) return;
    let deadline = g.deadline;
    if (deadline === null) {
      // no timer configured: still don't let an offline player block the table forever
      const offline = g.timerFor.some((id) => {
        const p = this.byId(id);
        return !p || p.sockets.size === 0;
      });
      if (!offline) return;
      deadline = Date.now() + OFFLINE_GRACE_MS;
    }
    const seq = g.event?.seq;
    const tableSize = g.table.length;
    this.timer = setTimeout(
      () => {
        if (this.game !== g || g.event?.seq !== seq || g.table.length !== tableSize) return;
        g.timeout();
        this.afterGameChange();
        this.onChange(this);
      },
      Math.max(0, deadline - Date.now()) + 150,
    );
  }

  dispose() {
    if (this.timer) clearTimeout(this.timer);
  }

  view(forId: string): RoomView {
    const g = this.game;
    const gp = (id: string) => g?.players.find((p) => p.id === id);
    const players: PlayerView[] = this.players.map((p) => ({
      id: p.id,
      name: p.name,
      connected: p.sockets.size > 0,
      isHost: p.id === this.hostId,
      handCount: gp(p.id)?.hand.length ?? 0,
      out: gp(p.id)?.out ?? false,
      place: gp(p.id)?.place ?? null,
      spectator: p.spectator,
      durakCount: p.durakCount,
    }));
    // order players by seat in the running game, spectators last
    if (g) {
      const seat = (id: string) => {
        const i = g.players.findIndex((x) => x.id === id);
        return i < 0 ? 99 : i;
      };
      players.sort((a, b) => seat(a.id) - seat(b.id));
    }
    const mine = gp(forId);
    return {
      code: this.code,
      you: forId,
      hostId: this.hostId,
      settings: this.settings,
      players,
      phase: this.phase,
      hand: mine && g ? sortHand(mine.hand, g.trump) : [],
      game: g ? g.view() : null,
      serverNow: Date.now(),
    };
  }
}
