export type Suit = 'S' | 'H' | 'D' | 'C';
export const SUITS: Suit[] = ['S', 'H', 'D', 'C'];

/** Rank 2..14 (11 = J, 12 = Q, 13 = K, 14 = A) */
export interface Card {
  s: Suit;
  r: number;
}

export const cardId = (c: Card) => `${c.s}${c.r}`;
export const sameCard = (a: Card, b: Card) => a.s === b.s && a.r === b.r;

export function buildDeck(lowestRank: number): Card[] {
  const deck: Card[] = [];
  for (const s of SUITS) for (let r = lowestRank; r <= 14; r++) deck.push({ s, r });
  return deck;
}

export const deckSize = (lowestRank: number) => (15 - lowestRank) * 4;

/** Does `def` beat `att` with the given trump suit? */
export function beats(def: Card, att: Card, trump: Suit): boolean {
  if (def.s === att.s) return def.r > att.r;
  return def.s === trump;
}

/** Sort a hand: non-trumps grouped by suit (alternating colours), trumps last; ascending rank. */
export function sortHand(hand: Card[], trump: Suit | null): Card[] {
  const order: Suit[] = ['S', 'H', 'C', 'D'];
  const key = (c: Card) => {
    const suitIdx = c.s === trump ? 9 : order.indexOf(c.s);
    return suitIdx * 100 + c.r;
  };
  return [...hand].sort((a, b) => key(a) - key(b));
}

/** Strength used for auto-play: lowest non-trump first, then lowest trump. */
export function weakestCard(hand: Card[], trump: Suit): Card | undefined {
  return [...hand].sort((a, b) => (a.s === trump ? 100 : 0) + a.r - ((b.s === trump ? 100 : 0) + b.r))[0];
}

export const RANK_LABEL: Record<number, string> = {
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A',
};
export const SUIT_SYMBOL: Record<Suit, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };
