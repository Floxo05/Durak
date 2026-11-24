declare module '@letele/playing-cards' {
  import type { FC, SVGProps } from 'react';
  const cards: Record<string, FC<SVGProps<SVGSVGElement>>>;
  export = cards;
}
