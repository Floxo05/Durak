import { beats, buildDeck, sameCard, weakestCard, type Card, type Suit } from '../shared/cards';
import { HAND_SIZE, type GameAction, type GameView, type LastEvent, type Settings, type TablePair } from '../shared/protocol';

export interface GPlayer {
  id: string;
  hand: Card[];
  out: boolean;
  place: number | null;
}

export interface GameOptions {
  rng?: () => number;
  /** player who should attack first; default: holder of the lowest trump */
  firstAttackerId?: string;
  /** pre-built deck for tests (drawn from the end, deck[0] is the trump card) */
  deck?: Card[];
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Durak engine (Podkidnoy / Perevodnoy). Only neighbours of the defender may throw in.
 * Pure state machine: the caller handles timers by calling `timeout()` once `deadline` passes.
 */
export class DurakGame {
  players: GPlayer[];
  deck: Card[];
  trumpCard: Card;
  trump: Suit;
  discardCount = 0;
  defender = 0;
  table: TablePair[] = [];
  taking = false;
  passed = new Set<string>();
  limit = HAND_SIZE;
  finished = false;
  durakId: string | null = null;
  deadline: number | null = null;
  timerFor: string[] = [];
  event: LastEvent | null = null;
  private seq = 0;
  private placeCounter = 0;

  constructor(
    ids: string[],
    readonly settings: Settings,
    opts: GameOptions = {},
    now = Date.now(),
  ) {
    const rng = opts.rng ?? Math.random;
    this.players = ids.map((id) => ({ id, hand: [], out: false, place: null }));
    this.deck = opts.deck ? [...opts.deck] : shuffle(buildDeck(settings.lowestRank), rng);
    this.trumpCard = this.deck[0];
    this.trump = this.trumpCard.s;
    for (let round = 0; round < HAND_SIZE; round++) {
      for (const p of this.players) if (this.deck.length) p.hand.push(this.deck.pop()!);
    }

    let first = opts.firstAttackerId ? this.idx(opts.firstAttackerId) : -1;
    if (first < 0) {
      let best = 99;
      this.players.forEach((p, i) => {
        for (const c of p.hand) if (c.s === this.trump && c.r < best) { best = c.r; first = i; }
      });
    }
    if (first < 0) first = Math.floor(rng() * this.players.length);
    this.defender = this.nextActive(first);
    this.limit = Math.min(HAND_SIZE, this.players[this.defender].hand.length);
    this.emit('start', this.players[first].id);
    this.settle(now);
  }

  // ---------- helpers ----------
  idx(id: string) {
    return this.players.findIndex((p) => p.id === id);
  }
  nextActive(i: number): number {
    const n = this.players.length;
    for (let k = 1; k <= n; k++) {
      const j = (i + k) % n;
      if (!this.players[j].out) return j;
    }
    return -1;
  }
  prevActive(i: number): number {
    const n = this.players.length;
    for (let k = 1; k <= n; k++) {
      const j = (i - k + n * 2) % n;
      if (!this.players[j].out) return j;
    }
    return -1;
  }
  get attacker(): number {
    return this.prevActive(this.defender);
  }
  get coAttacker(): number | null {
    const c = this.nextActive(this.defender);
    return c === this.attacker || c === this.defender ? null : c;
  }
  /** players allowed to throw in (neighbours of the defender) */
  throwers(): number[] {
    const t = [this.attacker];
    const c = this.coAttacker;
    if (c !== null) t.push(c);
    return t;
  }
  get unbeaten() {
    return this.table.filter((p) => !p.defense).length;
  }
  tableRanks(): Set<number> {
    const s = new Set<number>();
    for (const p of this.table) {
      s.add(p.attack.r);
      if (p.defense) s.add(p.defense.r);
    }
    return s;
  }
  private emit(type: LastEvent['type'], playerId: string | null) {
    this.event = { seq: ++this.seq, type, playerId };
  }
  private takeFromHand(p: GPlayer, card: Card): boolean {
    const i = p.hand.findIndex((c) => sameCard(c, card));
    if (i < 0) return false;
    p.hand.splice(i, 1);
    return true;
  }
  canTransfer(card: Card): boolean {
    if (!this.settings.transfer || this.taking || this.table.length === 0) return false;
    if (this.table.some((p) => p.defense)) return false;
    if (card.r !== this.table[0].attack.r) return false;
    const nd = this.nextActive(this.defender);
    if (nd === this.defender) return false;
    return this.table.length + 1 <= HAND_SIZE && this.players[nd].hand.length >= this.table.length + 1;
  }

  // ---------- actions ----------
  /** Returns an error key or null on success. */
  act(playerId: string, a: GameAction, now = Date.now()): string | null {
    if (this.finished) return 'err.finished';
    const pi = this.idx(playerId);
    if (pi < 0 || this.players[pi].out) return 'err.notInGame';
    const p = this.players[pi];
    const err = this.apply(pi, p, a);
    if (err) return err;
    this.settle(now);
    return null;
  }

  private apply(pi: number, p: GPlayer, a: GameAction): string | null {
    switch (a.type) {
      case 'attack': {
        if (!a.card) return 'err.invalid';
        if (pi === this.defender) return 'err.notYourTurn';
        if (this.table.length === 0) {
          if (pi !== this.attacker) return 'err.notYourTurn';
        } else {
          if (!this.throwers().includes(pi)) return 'err.onlyNeighbours';
          if (!this.tableRanks().has(a.card.r)) return 'err.rankNotOnTable';
        }
        if (this.table.length >= this.limit) return 'err.tableFull';
        if (!this.takeFromHand(p, a.card)) return 'err.invalid';
        this.table.push({ attack: a.card, defense: null, by: p.id });
        this.passed.clear();
        this.emit('attack', p.id);
        return null;
      }
      case 'defend': {
        if (!a.card || a.target === undefined) return 'err.invalid';
        if (pi !== this.defender || this.taking) return 'err.notYourTurn';
        const pair = this.table[a.target];
        if (!pair || pair.defense) return 'err.invalid';
        if (!p.hand.some((c) => sameCard(c, a.card!))) return 'err.invalid';
        if (!beats(a.card, pair.attack, this.trump)) return 'err.doesNotBeat';
        this.takeFromHand(p, a.card);
        pair.defense = a.card;
        this.passed.clear();
        this.emit('defend', p.id);
        return null;
      }
      case 'transfer': {
        if (!a.card) return 'err.invalid';
        if (pi !== this.defender) return 'err.notYourTurn';
        if (!p.hand.some((c) => sameCard(c, a.card!))) return 'err.invalid';
        if (!this.canTransfer(a.card)) return 'err.cannotTransfer';
        this.takeFromHand(p, a.card);
        this.table.push({ attack: a.card, defense: null, by: p.id });
        this.defender = this.nextActive(this.defender);
        this.limit = Math.min(HAND_SIZE, this.players[this.defender].hand.length);
        this.passed.clear();
        this.emit('transfer', p.id);
        return null;
      }
      case 'take': {
        if (pi !== this.defender || this.taking) return 'err.notYourTurn';
        if (this.unbeaten === 0) return 'err.invalid';
        this.taking = true;
        this.passed.clear();
        this.emit('take', p.id);
        return null;
      }
      case 'pass': {
        if (!this.throwers().includes(pi)) return 'err.notYourTurn';
        if (this.table.length === 0) return 'err.notYourTurn';
        if (this.unbeaten > 0 && !this.taking) return 'err.waitForDefender';
        this.passed.add(p.id);
        return null;
      }
    }
    return 'err.invalid';
  }

  /** Called by the room when the deadline is reached. */
  timeout(now = Date.now()) {
    if (this.finished) return;
    if (this.table.length === 0) {
      const att = this.players[this.attacker];
      const card = weakestCard(att.hand, this.trump);
      if (card) {
        this.takeFromHand(att, card);
        this.table.push({ attack: card, defense: null, by: att.id });
        this.emit('auto', att.id);
      }
    } else if (this.unbeaten > 0 && !this.taking) {
      this.taking = true;
      this.emit('take', this.players[this.defender].id);
    } else {
      for (const t of this.throwers()) this.passed.add(this.players[t].id);
    }
    this.settle(now);
  }

  private canStillThrow(ti: number): boolean {
    const p = this.players[ti];
    if (p.hand.length === 0 || this.table.length >= this.limit) return false;
    const ranks = this.tableRanks();
    return p.hand.some((c) => ranks.has(c.r));
  }

  /** Resolve automatic state transitions and refresh the timer. */
  private settle(now: number) {
    for (let guard = 0; guard < 10 && !this.finished; guard++) {
      if (this.table.length > 0) {
        const def = this.players[this.defender];
        if (!this.taking && this.unbeaten === 0 && def.hand.length === 0) {
          this.endBout(true);
          continue;
        }
        const throwers = this.throwers();
        for (const t of throwers) if (!this.canStillThrow(t)) this.passed.add(this.players[t].id);
        const allPassed = throwers.every((t) => this.passed.has(this.players[t].id));
        if (allPassed && (this.taking || this.unbeaten === 0)) {
          this.endBout(!this.taking);
          continue;
        }
      }
      break;
    }
    this.refreshTimer(now);
  }

  private refreshTimer(now: number) {
    if (this.finished) {
      this.deadline = null;
      this.timerFor = [];
      return;
    }
    const T = this.settings.turnSeconds;
    let secs = T;
    if (this.table.length === 0) {
      this.timerFor = [this.players[this.attacker].id];
    } else if (this.unbeaten > 0 && !this.taking) {
      this.timerFor = [this.players[this.defender].id];
    } else {
      secs = Math.max(5, Math.ceil(T / 2));
      this.timerFor = this.throwers()
        .map((t) => this.players[t].id)
        .filter((id) => !this.passed.has(id));
    }
    this.deadline = T > 0 ? now + secs * 1000 : null;
  }

  private endBout(success: boolean) {
    const def = this.players[this.defender];
    const attackerIdx = this.attacker;
    if (success) {
      this.discardCount += this.table.reduce((n, p) => n + (p.defense ? 2 : 1), 0);
      this.emit('bito', def.id);
    } else {
      for (const p of this.table) {
        def.hand.push(p.attack);
        if (p.defense) def.hand.push(p.defense);
      }
      this.emit('pickup', def.id);
    }
    this.table = [];
    this.taking = false;
    this.passed.clear();

    // draw: main attacker first, then the others in turn order, defender last
    const n = this.players.length;
    const order: number[] = [];
    for (let k = 0; k < n; k++) {
      const i = (attackerIdx + k) % n;
      if (i !== this.defender && !this.players[i].out) order.push(i);
    }
    order.push(this.defender);
    for (const i of order) {
      const p = this.players[i];
      while (p.hand.length < HAND_SIZE && this.deck.length) p.hand.push(this.deck.pop()!);
    }

    if (this.deck.length === 0) {
      for (const i of order) {
        const p = this.players[i];
        if (!p.out && p.hand.length === 0) {
          p.out = true;
          p.place = ++this.placeCounter;
        }
      }
    }

    const active = this.players.filter((p) => !p.out);
    if (active.length <= 1) {
      this.finished = true;
      this.durakId = active[0]?.id ?? null;
      this.emit('end', this.durakId);
      return;
    }

    let nextAttacker: number;
    if (success) nextAttacker = def.out ? this.nextActive(this.defender) : this.defender;
    else nextAttacker = this.nextActive(this.defender);
    this.defender = this.nextActive(nextAttacker);
    this.limit = Math.min(HAND_SIZE, this.players[this.defender].hand.length);
  }

  view(): GameView {
    const id = (i: number | null) => (i === null || i < 0 ? null : this.players[i].id);
    const co = this.finished ? null : this.coAttacker;
    return {
      trump: this.trump,
      trumpCard: this.trumpCard,
      deckCount: this.deck.length,
      discardCount: this.discardCount,
      table: this.table.map((p) => ({ ...p })),
      defenderId: this.finished ? '' : id(this.defender) ?? '',
      attackerId: this.finished ? '' : id(this.attacker) ?? '',
      coAttackerId: id(co),
      taking: this.taking,
      passed: [...this.passed],
      limit: this.limit,
      deadline: this.deadline,
      timerFor: this.timerFor,
      finished: this.finished,
      durakId: this.durakId,
      event: this.event,
    };
  }
}
