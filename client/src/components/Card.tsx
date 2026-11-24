import { memo } from 'react';
import * as deck from '@letele/playing-cards';
import { RANK_LABEL, SUIT_SYMBOL, type Card } from '../../../shared/cards';

const RANK_KEY: Record<number, string> = { 11: 'j', 12: 'q', 13: 'k', 14: 'a' };
const componentName = (c: Card) => `${c.s === 'S' ? 'S' : c.s}${RANK_KEY[c.r] ?? c.r}`;

export const cardTitle = (c: Card) => `${RANK_LABEL[c.r]}${SUIT_SYMBOL[c.s]}`;

interface Props {
  card?: Card;
  back?: boolean;
  className?: string;
  style?: React.CSSProperties;
  onClick?: () => void;
}

export const PlayingCard = memo(function PlayingCard({ card, back, className = '', style, onClick }: Props) {
  if (back || !card) {
    return (
      <div className={`pcard back ${className}`} style={style} onClick={onClick}>
        <div className="back-inner">
          <span className="back-emblem">🃏</span>
        </div>
      </div>
    );
  }
  const Svg = deck[componentName(card)];
  return (
    <div
      className={`pcard ${className}`}
      style={style}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      aria-label={cardTitle(card)}
    >
      <Svg width="100%" height="100%" preserveAspectRatio="xMidYMid meet" />
    </div>
  );
});
