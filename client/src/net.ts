import { io } from 'socket.io-client';
import type { GameAction, Settings } from '../../shared/protocol';

export const socket = io({ transports: ['websocket', 'polling'] });

function randomToken() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

const store = {
  get(k: string, session = false) {
    try {
      return (session ? sessionStorage : localStorage).getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string | null, session = false) {
    try {
      const s = session ? sessionStorage : localStorage;
      if (v === null) s.removeItem(k);
      else s.setItem(k, v);
    } catch {
      /* ignore */
    }
  },
};

/** one identity per browser tab; survives reloads, so a refresh puts you back at your seat */
export function getToken() {
  let t = store.get('durak.token', true);
  if (!t) {
    t = randomToken();
    store.set('durak.token', t, true);
  }
  return t;
}

export const savedName = () => store.get('durak.name') ?? '';
export const saveName = (n: string) => store.set('durak.name', n);
export const savedRoom = () => store.get('durak.room', true);
export const saveRoom = (c: string | null) => store.set('durak.room', c, true);

export interface AckRes {
  ok: boolean;
  error?: string;
  code?: string;
}

export function emit(event: string, payload?: unknown): Promise<AckRes> {
  return new Promise((resolve) => {
    socket.timeout(8000).emit(event, payload, (err: unknown, res: AckRes) => {
      resolve(err ? { ok: false, error: 'err.disconnected' } : res);
    });
  });
}

export const api = {
  join: (code: string, name: string) => emit('join', { code, name, token: getToken() }),
  create: (name: string) => emit('join', { create: true, name, token: getToken() }),
  settings: (s: Partial<Settings>) => emit('settings', s),
  start: () => emit('start'),
  action: (a: GameAction) => emit('action', a),
  kick: (id: string) => emit('kick', id),
  leave: () => emit('leave'),
  react: (emoji: string) => socket.emit('reaction', emoji),
};
