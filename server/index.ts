import express from 'express';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server, type Socket } from 'socket.io';
import { Room, cleanName, newCode, type RPlayer } from './rooms';
import { REACTIONS, type GameAction, type Settings } from '../shared/protocol';

const envInt = (name: string, fallback: number) => {
  const v = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

const PORT = envInt('PORT', 3000);
/** max. tables at the same time */
const MAX_ROOMS = envInt('MAX_ROOMS', 5);
/** max. simultaneous socket connections (all tables together) */
const MAX_CONNECTIONS = envInt('MAX_CONNECTIONS', 60);
/** a table nobody is connected to for this long is freed */
const ABANDONED_MS = envInt('ABANDONED_MINUTES', 5) * 60_000;
const ROOM_IDLE_MS = 1000 * 60 * 60 * 3;

const app = express();
const http = createServer(app);
const io = new Server(http, {
  cors: { origin: process.env.CORS_ORIGIN ?? false },
  // game messages are tiny; refuse anything big
  maxHttpBufferSize: 16 * 1024,
  allowRequest: (_req, cb) => cb(null, io.engine.clientsCount < MAX_CONNECTIONS),
});

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = [join(here, 'public'), join(here, '../dist/public')].find((d) => existsSync(d));

app.get('/healthz', (_req, res) => {
  res.json({ ok: true, rooms: rooms.size, maxRooms: MAX_ROOMS });
});
if (publicDir) {
  app.use(express.static(publicDir, { maxAge: '1h', index: false }));
  app.get('/{*path}', (_req, res) => res.sendFile(join(publicDir, 'index.html')));
}

const rooms = new Map<string, Room>();

/** since when nobody is connected to the table (null = someone is there) */
function abandonedSince(room: Room): number | null {
  if (room.players.length === 0) return 0;
  let since = 0;
  for (const p of room.players) {
    if (p.sockets.size > 0) return null;
    since = Math.max(since, p.disconnectedAt ?? room.lastActivity);
  }
  return since;
}

function deleteRoom(code: string) {
  rooms.get(code)?.dispose();
  rooms.delete(code);
}

function pruneRooms(now = Date.now()) {
  for (const [code, room] of rooms) {
    const since = abandonedSince(room);
    if ((since !== null && now - since > ABANDONED_MS) || now - room.lastActivity > ROOM_IDLE_MS) deleteRoom(code);
  }
}

function broadcast(room: Room) {
  for (const p of room.players) {
    if (!p.sockets.size) continue;
    const view = room.view(p.id);
    for (const sid of p.sockets) io.to(sid).emit('state', view);
  }
}

interface Ctx {
  room?: Room;
  player?: RPlayer;
}
type Ack = (res: { ok: boolean; error?: string; code?: string }) => void;
const safeAck = (ack: unknown): Ack => (typeof ack === 'function' ? (ack as Ack) : () => {});

io.on('connection', (socket: Socket) => {
  const ctx: Ctx = {};

  const leaveCurrent = () => {
    if (ctx.room && ctx.player) {
      ctx.room.disconnect(ctx.player, socket.id);
      socket.leave(ctx.room.code);
      broadcast(ctx.room);
    }
    ctx.room = undefined;
    ctx.player = undefined;
  };

  socket.on('join', (msg: { code?: string; create?: boolean; name?: string; token?: string }, ackRaw) => {
    const ack = safeAck(ackRaw);
    const token = String(msg?.token ?? '').slice(0, 64);
    if (token.length < 16) return ack({ ok: false, error: 'err.invalid' });
    const name = cleanName(msg?.name);

    let room: Room | undefined;
    if (msg?.create) {
      if (!name) return ack({ ok: false, error: 'err.nameRequired' });
      if (rooms.size >= MAX_ROOMS) pruneRooms();
      if (rooms.size >= MAX_ROOMS) return ack({ ok: false, error: 'err.tooManyRooms' });
      room = new Room(newCode(rooms), broadcast);
      rooms.set(room.code, room);
    } else {
      room = rooms.get(String(msg?.code ?? '').toUpperCase().trim());
      if (!room) return ack({ ok: false, error: 'err.roomNotFound' });
    }
    const res = room.join(token, name);
    if (typeof res === 'string') return ack({ ok: false, error: res });

    if (ctx.room !== room || ctx.player !== res) leaveCurrent();
    ctx.room = room;
    ctx.player = res;
    socket.join(room.code);
    room.connect(res, socket.id);
    ack({ ok: true, code: room.code });
    broadcast(room);
  });

  const withRoom =
    <T>(fn: (room: Room, player: RPlayer, payload: T) => string | null | void) =>
    (payload: T, ackRaw?: unknown) => {
      const ack = safeAck(ackRaw);
      const { room, player } = ctx;
      if (!room || !player || !room.players.includes(player)) return ack({ ok: false, error: 'err.noRoom' });
      const err = fn(room, player, payload);
      if (err) return ack({ ok: false, error: err });
      ack({ ok: true });
      broadcast(room);
    };

  socket.on('settings', withRoom<Partial<Settings>>((room, p, s) => room.updateSettings(p.id, s ?? {})));
  socket.on('start', withRoom<void>((room, p) => room.start(p.id)));
  socket.on('action', withRoom<GameAction>((room, p, a) => (a ? room.act(p.id, a) : 'err.invalid')));
  socket.on(
    'kick',
    withRoom<string>((room, p, id) => {
      if (p.id !== room.hostId) return 'err.onlyHost';
      if (id === p.id) return 'err.invalid';
      const target = room.byId(id);
      if (!target) return 'err.invalid';
      for (const sid of target.sockets) {
        io.to(sid).emit('kicked');
        io.sockets.sockets.get(sid)?.leave(room.code);
      }
      room.remove(id);
    }),
  );
  socket.on(
    'leave',
    withRoom<void>((room, p) => {
      room.remove(p.id);
      socket.leave(room.code);
      ctx.room = undefined;
      ctx.player = undefined;
      broadcast(room);
      if (room.players.length === 0) deleteRoom(room.code);
    }),
  );

  let lastReaction = 0;
  socket.on('reaction', (emoji: string) => {
    const { room, player } = ctx;
    const now = Date.now();
    if (!room || !player || !REACTIONS.includes(emoji) || now - lastReaction < 700) return;
    lastReaction = now;
    io.to(room.code).emit('reaction', { from: player.id, emoji });
  });

  socket.on('disconnect', leaveCurrent);
});

// housekeeping: free abandoned / idle tables
setInterval(() => pruneRooms(), 30_000).unref();

http.listen(PORT, () => {
  console.log(
    `Durak server listening on :${PORT} (max ${MAX_ROOMS} tables, ${MAX_CONNECTIONS} connections)${publicDir ? '' : ' – no client build found'}`,
  );
});
