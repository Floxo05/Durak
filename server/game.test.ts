import { describe, expect, it } from 'vitest';
import { DurakGame } from './game';
import { DEFAULT_SETTINGS } from '../shared/protocol';
import type { Card, Suit } from '../shared/cards';

const c = (s: string): Card => {
  const suit = s.slice(-1) as Suit;
  const r = s.slice(0, -1);
  const map: Record<string, number> = { J: 11, Q: 12, K: 13, A: 14 };
  return { s: suit, r: map[r] ?? Number(r) };
};
const cs = (...xs: string[]) => xs.map(c);

/** game with fixed hands, empty-ish deck, trump = hearts, p0 attacks p1 */
function setup(hands: string[][], deck: string[] = [], opts: Partial<typeof DEFAULT_SETTINGS> = {}) {
  const ids = hands.map((_, i) => `p${i}`);
  const g = new DurakGame(ids, { ...DEFAULT_SETTINGS, ...opts }, { firstAttackerId: 'p0' }, 0);
  g.players.forEach((p, i) => (p.hand = cs(...hands[i])));
  g.deck = cs(...deck);
  g.trump = 'H';
  g.defender = 1;
  g.limit = Math.min(6, g.players[1].hand.length);
  return g;
}

describe('DurakGame', () => {
  it('deals 6 cards each and picks lowest trump holder as attacker', () => {
    const g = new DurakGame(['a', 'b', 'c'], DEFAULT_SETTINGS, { rng: () => 0.42 }, 0);
    expect(g.players.every((p) => p.hand.length === 6)).toBe(true);
    expect(g.deck.length).toBe(36 - 18);
    const lowest = Math.min(
      ...g.players.flatMap((p) => p.hand.filter((x) => x.s === g.trump).map((x) => x.r)),
    );
    const holder = g.players.find((p) => p.hand.some((x) => x.s === g.trump && x.r === lowest))!;
    expect(g.view().attackerId).toBe(holder.id);
  });

  it('respects configurable deck size', () => {
    const g = new DurakGame(['a', 'b'], { ...DEFAULT_SETTINGS, lowestRank: 2 }, {}, 0);
    expect(g.deck.length + 12).toBe(52);
  });

  it('only allows the attacker to lead, defender beats, bito discards and defender attacks next', () => {
    const g = setup([['6S', '9C'], ['7S', 'KD'], ['8D', '10D']]);
    expect(g.act('p2', { type: 'attack', card: c('8D') })).toBe('err.notYourTurn');
    expect(g.act('p0', { type: 'attack', card: c('6S') })).toBeNull();
    expect(g.act('p1', { type: 'defend', card: c('KD'), target: 0 })).toBe('err.doesNotBeat');
    expect(g.act('p1', { type: 'defend', card: c('7S'), target: 0 })).toBeNull();
    // nobody can throw in (no matching ranks) -> automatic bito
    expect(g.table.length).toBe(0);
    expect(g.discardCount).toBe(2);
    expect(g.view().attackerId).toBe('p1');
    expect(g.view().defenderId).toBe('p2');
  });

  it('trumps beat other suits', () => {
    const g = setup([['AS', '9C'], ['6H', 'KD'], ['8D', '10D']]);
    g.act('p0', { type: 'attack', card: c('AS') });
    expect(g.act('p1', { type: 'defend', card: c('6H'), target: 0 })).toBeNull();
  });

  it('only neighbours of the defender may throw in', () => {
    // 4 players: p0 attacks p1, neighbours are p0 and p2, p3 is not allowed
    const g = setup([['6S', '9C'], ['7S', 'KD', 'QD'], ['6C', '10D'], ['6D', '10S']]);
    g.act('p0', { type: 'attack', card: c('6S') });
    expect(g.act('p3', { type: 'attack', card: c('6D') })).toBe('err.onlyNeighbours');
    expect(g.act('p2', { type: 'attack', card: c('6C') })).toBeNull();
  });

  it('transfers the attack to the next player and the old defender becomes attacker', () => {
    const g = setup([['6S', '9C'], ['6D', 'KD'], ['8D', '10D', 'JC']]);
    g.act('p0', { type: 'attack', card: c('6S') });
    expect(g.act('p1', { type: 'transfer', card: c('6D') })).toBeNull();
    const v = g.view();
    expect(v.defenderId).toBe('p2');
    expect(v.attackerId).toBe('p1');
    expect(v.table.length).toBe(2);
  });

  it('forbids transfer after a card was beaten or when disabled or next player has too few cards', () => {
    const g = setup([['6S', '6C', '9C'], ['6D', '7S', 'KD'], ['8D', '10D', 'JC']]);
    g.act('p0', { type: 'attack', card: c('6S') });
    g.act('p1', { type: 'defend', card: c('7S'), target: 0 });
    g.act('p0', { type: 'attack', card: c('6C') });
    expect(g.act('p1', { type: 'transfer', card: c('6D') })).toBe('err.cannotTransfer');

    const g2 = setup([['6S', '9C'], ['6D', 'KD'], ['8D', '10D']], [], { transfer: false });
    g2.act('p0', { type: 'attack', card: c('6S') });
    expect(g2.act('p1', { type: 'transfer', card: c('6D') })).toBe('err.cannotTransfer');

    const g3 = setup([['6S', '9C'], ['6D', 'KD'], ['8D']]);
    g3.act('p0', { type: 'attack', card: c('6S') });
    expect(g3.act('p1', { type: 'transfer', card: c('6D') })).toBe('err.cannotTransfer');
  });

  it('defender takes, attackers may still throw in, then defender picks up and is skipped', () => {
    const g = setup([['6S', '6C', '9C'], ['7D', 'KD'], ['8D', '10D', 'JC'], ['AS', 'AC']]);
    g.act('p0', { type: 'attack', card: c('6S') });
    expect(g.act('p1', { type: 'take' })).toBeNull();
    expect(g.act('p0', { type: 'attack', card: c('6C') })).toBeNull();
    // table limited to defender hand size (2)
    expect(g.act('p0', { type: 'attack', card: c('6C') })).not.toBeNull();
    // p0 and p2 cannot add more -> auto pickup
    expect(g.players[1].hand.length).toBe(4);
    expect(g.view().attackerId).toBe('p2');
    expect(g.view().defenderId).toBe('p3');
  });

  it('limits the table to the defender hand size', () => {
    const g = setup([['6S', '6C', '6D', '9C'], ['7S', 'KD'], ['8D', '10D', 'JC']]);
    g.act('p0', { type: 'attack', card: c('6S') });
    g.act('p0', { type: 'attack', card: c('6C') });
    expect(g.act('p0', { type: 'attack', card: c('6D') })).toBe('err.tableFull');
  });

  it('players draw back up to 6, attacker first, defender last', () => {
    const g = setup(
      [['6S', '9C'], ['7S', 'KD'], ['8D', '10D']],
      ['AH', 'AC', 'AD', 'AS', 'KC', 'KS', 'QC', 'QS', 'QD', 'QH', 'JS', 'JD', 'JH'],
    );
    g.act('p0', { type: 'attack', card: c('6S') });
    g.act('p1', { type: 'defend', card: c('7S'), target: 0 });
    // 13 cards: p0 draws 5, p2 draws 4, defender p1 gets the remaining 4 incl. the trump card
    expect(g.players.map((p) => p.hand.length)).toEqual([6, 5, 6]);
    expect(g.deck.length).toBe(0);
    expect(g.players[1].hand).toContainEqual(c('AH'));
  });

  it('timeout: attacker auto-plays the weakest card, defender auto-takes, throwers auto-pass', () => {
    const g = setup([['KH', '9C', 'QS', '9S'], ['7S', 'KD'], ['8D', '10D', '9D']], [], { turnSeconds: 30 });
    expect(g.deadline).not.toBeNull();
    g.timeout(1000);
    expect(g.table[0].attack).toEqual(c('9C'));
    g.timeout(2000);
    expect(g.taking).toBe(true);
    // p0 can still throw 9S, p2 has 9D -> wait for them
    expect(g.table.length).toBe(1);
    g.timeout(3000);
    expect(g.players[1].hand.length).toBe(3);
  });

  it('ends the game when only one player has cards left -> that player is the Durak', () => {
    const g = setup([['6S'], ['7S', 'AD']]);
    g.act('p0', { type: 'attack', card: c('6S') });
    g.act('p1', { type: 'defend', card: c('7S'), target: 0 });
    expect(g.finished).toBe(true);
    expect(g.durakId).toBe('p1');
    expect(g.players[0].place).toBe(1);
  });

  it('a defender who beats with the last card while deck is empty gets out', () => {
    const g = setup([['6S', '9C'], ['7S'], ['8D', '10D']]);
    g.act('p0', { type: 'attack', card: c('6S') });
    g.act('p1', { type: 'defend', card: c('7S'), target: 0 });
    expect(g.players[1].out).toBe(true);
    expect(g.finished).toBe(false);
    // p1 is out -> p2 attacks next, p0 defends
    expect(g.view().attackerId).toBe('p2');
    expect(g.view().defenderId).toBe('p0');
  });

  it('a draw when the last two players run out together', () => {
    const g = setup([['6S'], ['7S']]);
    g.act('p0', { type: 'attack', card: c('6S') });
    g.act('p1', { type: 'defend', card: c('7S'), target: 0 });
    expect(g.finished).toBe(true);
    expect(g.durakId).toBeNull();
    expect(() => g.view()).not.toThrow();
  });

  it('pass is only possible once everything is beaten', () => {
    const g = setup([['6S', '7C'], ['7S', 'KD', '7H'], ['8D', '10D']]);
    g.act('p0', { type: 'attack', card: c('6S') });
    expect(g.act('p0', { type: 'pass' })).toBe('err.waitForDefender');
    g.act('p1', { type: 'defend', card: c('7S'), target: 0 });
    // p0 has 7C matching -> not auto passed
    expect(g.table.length).toBe(1);
    expect(g.act('p0', { type: 'pass' })).toBeNull();
    expect(g.table.length).toBe(0);
  });
});
