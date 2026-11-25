import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { api } from '../net';
import { play } from '../sound';
import { beats, cardId, sameCard, SUIT_SYMBOL, type Card } from '../../../shared/cards';
import { HAND_SIZE, REACTIONS, type PlayerView, type RoomView } from '../../../shared/protocol';
import { PlayingCard } from './Card';
import { Avatar, LangSwitch, Logo, MuteButton, RulesModal, useCountdown } from './ui';

export interface FloatingReaction {
  key: number;
  from: string;
  emoji: string;
}

interface Props {
  view: RoomView;
  offset: number;
  reactions: FloatingReaction[];
  onError: (e: string) => void;
  onToast: (msg: string) => void;
  onLeave: () => void;
  onShowLobby: () => void;
}

function TimerRing({ deadline, total, offset, size }: { deadline: number; total: number; offset: number; size: number }) {
  const { frac } = useCountdown(deadline, total, offset);
  const r = size / 2 - 3;
  const C = 2 * Math.PI * r;
  const color = frac > 0.5 ? '#7CFC9A' : frac > 0.25 ? '#FFD166' : '#FF5D5D';
  return (
    <svg className="timer-ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(0,0,0,.35)" strokeWidth="5" fill="none" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke={color}
        strokeWidth="5"
        fill="none"
        strokeLinecap="round"
        strokeDasharray={C}
        strokeDashoffset={C * (1 - frac)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}

function MyTimerBar({ deadline, total, offset }: { deadline: number; total: number; offset: number }) {
  const { frac, secs } = useCountdown(deadline, total, offset);
  const prev = useRef(secs);
  useEffect(() => {
    if (secs !== prev.current && secs <= 5 && secs > 0) play('tick');
    prev.current = secs;
  }, [secs]);
  return (
    <div className={`my-timer ${secs <= 5 ? 'urgent' : ''}`}>
      <div className="my-timer-fill" style={{ transform: `scaleX(${frac})` }} />
      <span>{secs}s</span>
    </div>
  );
}

function Seat({
  p,
  view,
  offset,
  total,
  reactions,
  style,
}: {
  p: PlayerView;
  view: RoomView;
  offset: number;
  total: number;
  reactions: FloatingReaction[];
  style?: React.CSSProperties;
}) {
  const { t } = useI18n();
  const g = view.game!;
  const role =
    g.defenderId === p.id ? 'def' : g.attackerId === p.id ? 'att' : g.coAttackerId === p.id ? 'co' : null;
  const timed = !g.finished && g.deadline !== null && g.timerFor.includes(p.id);
  const unbeaten = g.table.some((x) => !x.defense);
  const passed = g.passed.includes(p.id) && g.table.length > 0 && (!unbeaten || g.taking);
  const fan = Math.min(p.handCount, 8);
  return (
    <div className={`seat ${role ?? ''} ${p.out ? 'is-out' : ''} ${timed ? 'active' : ''}`} style={style}>
      <div className="seat-fan">
        {Array.from({ length: fan }).map((_, i) => (
          <PlayingCard key={i} back className="mini" style={{ ['--i' as string]: i - (fan - 1) / 2 }} />
        ))}
        {p.handCount > 0 && <span className="count">{p.handCount}</span>}
      </div>
      <div className="seat-avatar">
        {timed && <TimerRing deadline={g.deadline!} total={total} offset={offset} size={62} />}
        <Avatar id={p.id} name={p.name} size={48} dim={!p.connected} />
        {role && <span className={`role-badge ${role}`}>{role === 'def' ? '🛡️' : role === 'att' ? '⚔️' : '🗡️'}</span>}
        {p.isHost && <span className="crown">👑</span>}
        {reactions
          .filter((r) => r.from === p.id)
          .map((r) => (
            <span key={r.key} className="float-emoji">
              {r.emoji}
            </span>
          ))}
      </div>
      <div className="seat-name">
        {p.name}
        {!p.connected && <small className="offline-tag"> · {t('game.offline')}</small>}
      </div>
      <div className="seat-status">
        {p.out && p.place !== null && <span className="badge gold">🏅 {t('game.place', { n: p.place })}</span>}
        {g.taking && role === 'def' && <span className="badge red">✋ {t('game.taking')}</span>}
        {passed && role !== 'def' && <span className="badge">✔ {t('game.passed')}</span>}
      </div>
    </div>
  );
}

export function Table({ view, offset, reactions, onError, onToast, onLeave, onShowLobby }: Props) {
  const { t } = useI18n();
  const g = view.game!;
  const me = view.you;
  const [selected, setSelected] = useState<Card | null>(null);
  const [rules, setRules] = useState(false);
  const [busy, setBusy] = useState(false);
  const name = (id: string | null) => view.players.find((p) => p.id === id)?.name ?? '?';

  const seated = view.players.filter((p) => !p.spectator);
  const mePlayer = view.players.find((p) => p.id === me);
  const amSeated = !!mePlayer && !mePlayer.spectator;
  const others = useMemo(() => {
    const i = seated.findIndex((p) => p.id === me);
    if (i < 0) return seated;
    return [...seated.slice(i + 1), ...seated.slice(0, i)];
  }, [seated, me]);

  const isDef = g.defenderId === me;
  const isAtt = g.attackerId === me;
  const isCo = g.coAttackerId === me;
  const unbeaten = g.table.filter((p) => !p.defense).length;
  const ranks = useMemo(() => {
    const s = new Set<number>();
    g.table.forEach((p) => {
      s.add(p.attack.r);
      if (p.defense) s.add(p.defense.r);
    });
    return s;
  }, [g.table]);

  const nextDefender = useMemo(() => {
    const active = seated.filter((p) => !p.out);
    const i = active.findIndex((p) => p.id === me);
    return i < 0 ? null : active[(i + 1) % active.length];
  }, [seated, me]);

  const total = (g.table.length === 0 || (unbeaten > 0 && !g.taking) ? view.settings.turnSeconds : Math.max(5, Math.ceil(view.settings.turnSeconds / 2))) * 1000;

  const canLead = (c: Card) => !g.finished && isAtt && g.table.length === 0 && !!c;
  const canThrow = (c: Card) =>
    !g.finished && (isAtt || isCo) && g.table.length > 0 && g.table.length < g.limit && ranks.has(c.r);
  const targetsFor = (c: Card) =>
    isDef && !g.taking ? g.table.map((p, i) => (!p.defense && beats(c, p.attack, g.trump) ? i : -1)).filter((i) => i >= 0) : [];
  const canTransfer = (c: Card) =>
    isDef &&
    view.settings.transfer &&
    !g.taking &&
    g.table.length > 0 &&
    g.table.every((p) => !p.defense) &&
    c.r === g.table[0].attack.r &&
    !!nextDefender &&
    nextDefender.id !== me &&
    nextDefender.handCount >= g.table.length + 1 &&
    g.table.length + 1 <= HAND_SIZE;
  const playable = (c: Card) => canLead(c) || canThrow(c) || targetsFor(c).length > 0 || canTransfer(c);

  // drop selection when it no longer makes sense
  useEffect(() => {
    if (selected && (!view.hand.some((c) => sameCard(c, selected)) || !playable(selected))) setSelected(null);
  });

  // sounds + toasts for game events
  const lastSeq = useRef<number>(g.event?.seq ?? 0);
  useEffect(() => {
    const ev = g.event;
    if (!ev || ev.seq === lastSeq.current) return;
    lastSeq.current = ev.seq;
    const who = name(ev.playerId);
    switch (ev.type) {
      case 'attack':
      case 'defend':
        play('card');
        break;
      case 'auto':
        play('card');
        onToast(`⏰ ${t('ev.auto', { name: who })}`);
        break;
      case 'transfer':
        play('transfer');
        onToast(`↪️ ${t('ev.transfer', { name: who })}`);
        break;
      case 'take':
        play('pop');
        break;
      case 'bito':
        play('bito');
        onToast(`🧹 ${t('ev.bito', { name: who })}`);
        break;
      case 'pickup':
        play('pickup');
        onToast(`😬 ${t('ev.pickup', { name: who })}`);
        break;
      case 'start':
        play('turn');
        onToast(`🎴 ${t('ev.start', { name: who })}`);
        break;
      case 'end':
        play(ev.playerId === me ? 'durak' : 'win');
        break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g.event?.seq]);

  // ping when it becomes my turn
  const myTurn = !g.finished && g.timerFor.includes(me);
  const wasMyTurn = useRef(myTurn);
  useEffect(() => {
    if (myTurn && !wasMyTurn.current) play('turn');
    wasMyTurn.current = myTurn;
  }, [myTurn]);

  const send = async (a: Parameters<typeof api.action>[0]) => {
    if (busy) return;
    setBusy(true);
    const r = await api.action(a);
    setBusy(false);
    setSelected(null);
    if (!r.ok && r.error) {
      play('error');
      onError(r.error);
    }
  };

  const clickHand = (c: Card) => {
    if (g.finished) return;
    if (isDef) {
      const targets = targetsFor(c);
      const tr = canTransfer(c);
      if (targets.length === 1 && !tr) return send({ type: 'defend', card: c, target: targets[0] });
      if (targets.length === 0 && tr) return send({ type: 'transfer', card: c });
      if (targets.length === 0 && !tr) {
        play('error');
        return;
      }
      setSelected(selected && sameCard(selected, c) ? null : c);
      return;
    }
    if (canLead(c) || canThrow(c)) return send({ type: 'attack', card: c });
    play('error');
  };

  const selTargets = selected ? targetsFor(selected) : [];
  const selTransfer = selected ? canTransfer(selected) : false;
  const anyTransfer = isDef && view.hand.some(canTransfer);

  let status = '';
  if (g.finished) status = g.durakId ? t('game.durakIs', { name: name(g.durakId) }) : t('game.draw');
  else if (!amSeated) status = t('game.spectating');
  else if (mePlayer?.out) status = t('game.youOut');
  else if (isDef) status = g.taking ? t('game.youTaking') : unbeaten > 0 ? t('game.youDefend') : t('game.youDefendDone');
  else if (g.table.length === 0) status = isAtt ? t('game.yourLead') : t('game.otherLead', { name: name(g.attackerId) });
  else if ((isAtt || isCo) && !g.passed.includes(me) && view.hand.some(canThrow)) status = t('game.throwIn');
  else status = t('game.waitDefender', { name: name(g.defenderId) });
  if (selected && selTargets.length + (selTransfer ? 1 : 0) > 1) status = t('game.pickTarget');

  const showTake = isDef && !g.taking && unbeaten > 0;
  const showPass = (isAtt || isCo) && g.table.length > 0 && (unbeaten === 0 || g.taking) && !g.passed.includes(me);
  const myTimed = myTurn && g.deadline !== null;

  const n = others.length;
  const durak = g.finished ? view.players.find((p) => p.id === g.durakId) : null;

  return (
    <div className={`game ${isDef ? 'me-def' : ''}`}>
      <header className="topbar">
        <Logo small />
        <div className="trump-pill" title={t('game.trump')}>
          {t('game.trump')} <b className={g.trump === 'H' || g.trump === 'D' ? 'red' : ''}>{SUIT_SYMBOL[g.trump]}</b>
        </div>
        <div className="topbar-right">
          <button className="icon-btn rules-btn" onClick={() => setRules(true)} title={t('home.rules')}>
            📜
          </button>
          <MuteButton />
          <LangSwitch />
          <button
            className="icon-btn"
            title={t('game.leave')}
            onClick={() => {
              if (confirm(t('game.confirmLeave'))) onLeave();
            }}
          >
            🚪
          </button>
        </div>
      </header>

      <div className="felt">
        <div className="opponents" style={{ ['--n' as string]: Math.max(1, n) }}>
          {others.map((p, i) => {
            const x = (i + 1) / (n + 1);
            const lift = Math.sin(Math.PI * x);
            return (
              <Seat
                key={p.id}
                p={p}
                view={view}
                offset={offset}
                total={total}
                reactions={reactions}
                style={{ left: `${x * 100}%`, top: `${(1 - lift) * 42}%` }}
              />
            );
          })}
        </div>

        <div className="center">
          <div className="piles">
            <div className="deck-pile" title={t('game.deck')}>
              {g.deckCount > 0 ? (
                <>
                  <PlayingCard card={g.trumpCard} className="trump-card" />
                  {g.deckCount > 1 && <PlayingCard back className="deck-top" />}
                  <span className="pile-count">{g.deckCount}</span>
                </>
              ) : (
                <div className={`trump-ghost ${g.trump === 'H' || g.trump === 'D' ? 'red' : ''}`}>{SUIT_SYMBOL[g.trump]}</div>
              )}
            </div>
            {g.discardCount > 0 && (
              <div className="discard-pile" title={t('game.discard')}>
                {Array.from({ length: Math.min(5, Math.ceil(g.discardCount / 4)) }).map((_, i) => (
                  <PlayingCard key={i} back className="discard" style={{ ['--r' as string]: `${(i * 37) % 50 - 25}deg` }} />
                ))}
                <span className="pile-count">{g.discardCount}</span>
              </div>
            )}
          </div>

          <div className={`battlefield ${g.taking ? 'taking' : ''}`}>
            {g.table.length === 0 && !g.finished && (
              <div className="battle-hint">
                ⚔️ {name(g.attackerId)} ➜ 🛡️ {name(g.defenderId)}
              </div>
            )}
            {g.table.map((pair, i) => {
              const isTarget = selTargets.includes(i);
              return (
                <div
                  key={cardId(pair.attack)}
                  className={`pair ${isTarget ? 'target' : ''}`}
                  onClick={isTarget && selected ? () => send({ type: 'defend', card: selected, target: i }) : undefined}
                >
                  <PlayingCard card={pair.attack} className={`attack ${pair.by === me ? 'from-me' : 'from-top'}`} />
                  {pair.defense && (
                    <PlayingCard
                      key={cardId(pair.defense)}
                      card={pair.defense}
                      className={`defense ${isDef ? 'from-me' : 'from-top'}`}
                    />
                  )}
                </div>
              );
            })}
            {anyTransfer && nextDefender && (
              <div
                className={`pair transfer-slot ${selTransfer ? 'target' : ''}`}
                onClick={selTransfer && selected ? () => send({ type: 'transfer', card: selected }) : undefined}
              >
                <span>↪️ {t('game.transfer', { name: nextDefender.name })}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="me-area">
        <div className="me-bar">
          {amSeated && mePlayer && (
            <div className={`me-avatar ${isDef ? 'def' : isAtt ? 'att' : isCo ? 'co' : ''}`}>
              <Avatar id={me} name={mePlayer.name} size={40} />
              {(isDef || isAtt || isCo) && (
                <span className={`role-badge ${isDef ? 'def' : isAtt ? 'att' : 'co'}`}>{isDef ? '🛡️' : isAtt ? '⚔️' : '🗡️'}</span>
              )}
              {reactions
                .filter((r) => r.from === me)
                .map((r) => (
                  <span key={r.key} className="float-emoji">
                    {r.emoji}
                  </span>
                ))}
            </div>
          )}
          <div className={`status ${myTurn ? 'my-turn' : ''}`}>{status}</div>
          <div className="actions">
            {showTake && (
              <button className="btn danger" disabled={busy} onClick={() => send({ type: 'take' })}>
                ✋ {t('game.take')}
              </button>
            )}
            {showPass && (
              <button className="btn primary" disabled={busy} onClick={() => send({ type: 'pass' })}>
                {g.taking ? `👌 ${t('game.passTake')}` : `🧹 ${t('game.pass')}`}
              </button>
            )}
          </div>
        </div>
        {myTimed && <MyTimerBar deadline={g.deadline!} total={total} offset={offset} />}

        <div className="hand" style={{ ['--n' as string]: view.hand.length }}>
          {view.hand.map((c, i) => {
            const can = myTurn || isDef || isAtt || isCo ? playable(c) : false;
            const sel = selected && sameCard(selected, c);
            return (
              <PlayingCard
                key={cardId(c)}
                card={c}
                className={`in-hand ${can ? 'playable' : 'idle'} ${sel ? 'selected' : ''} ${c.s === g.trump ? 'is-trump' : ''}`}
                style={{ ['--i' as string]: i - (view.hand.length - 1) / 2 }}
                onClick={() => clickHand(c)}
              />
            );
          })}
        </div>

        <div className="reaction-bar">
          {REACTIONS.map((e) => (
            <button key={e} onClick={() => api.react(e)}>
              {e}
            </button>
          ))}
        </div>
      </div>

      {g.finished && (
        <div className="end-overlay">
          <div className="end-card">
            {durak ? (
              <>
                <div className="jester">🤡</div>
                <div className="stamp">{t('game.durak')}</div>
                <h2>{durak.id === me ? t('game.youDurak') : t('game.durakIs', { name: durak.name })}</h2>
              </>
            ) : (
              <>
                <div className="jester">🤝</div>
                <h2>{t('game.draw')}</h2>
              </>
            )}
            <ol className="results">
              {[...seated]
                .sort((a, b) => (a.place ?? 99) - (b.place ?? 99))
                .map((p) => (
                  <li key={p.id} className={p.id === g.durakId ? 'loser' : ''}>
                    <span className="medal">
                      {p.id === g.durakId ? '🤡' : p.place === 1 ? '🥇' : p.place === 2 ? '🥈' : p.place === 3 ? '🥉' : '🏅'}
                    </span>
                    <Avatar id={p.id} name={p.name} size={30} />
                    <span className="pname">{p.name}</span>
                    {p.durakCount > 0 && <span className="muted">🤡×{p.durakCount}</span>}
                  </li>
                ))}
            </ol>
            <div className="end-actions">
              <button className="btn ghost" onClick={onShowLobby}>
                ⚙️ Lobby
              </button>
              {view.hostId === me ? (
                <button
                  className="btn primary big pulse"
                  onClick={async () => {
                    const r = await api.start();
                    if (!r.ok && r.error) onError(r.error);
                  }}
                >
                  🔁 {t('game.rematch')}
                </button>
              ) : (
                <div className="waiting">{t('game.waitRematch')}</div>
              )}
            </div>
          </div>
          {durak && durak.id !== me && <Confetti />}
        </div>
      )}
      {rules && <RulesModal onClose={() => setRules(false)} />}
    </div>
  );
}

function Confetti() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 60 }, (_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * 1.5,
        dur: 2.5 + Math.random() * 2,
        hue: (i * 47) % 360,
        sym: ['♥', '♠', '♦', '♣'][i % 4],
      })),
    [],
  );
  return (
    <div className="confetti" aria-hidden>
      {pieces.map((p, i) => (
        <span
          key={i}
          style={{ left: `${p.left}%`, animationDelay: `${p.delay}s`, animationDuration: `${p.dur}s`, color: `hsl(${p.hue} 85% 60%)` }}
        >
          {p.sym}
        </span>
      ))}
    </div>
  );
}
