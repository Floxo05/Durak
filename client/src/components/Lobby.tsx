import { useState } from 'react';
import { useI18n } from '../i18n';
import { api } from '../net';
import { deckSize, RANK_LABEL } from '../../../shared/cards';
import { HAND_SIZE, TIMER_OPTIONS, type RoomView } from '../../../shared/protocol';
import { Avatar, LangSwitch, Logo, MuteButton, RulesModal } from './ui';

const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10];

export function Lobby({ view, onError, onLeave }: { view: RoomView; onError: (e: string) => void; onLeave: () => void }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [rules, setRules] = useState(false);
  const isHost = view.you === view.hostId;
  const s = view.settings;
  const seated = view.players.filter((p) => !p.spectator);
  const host = view.players.find((p) => p.id === view.hostId);
  const link = `${location.origin}/${view.code}`;
  const maxForDeck = Math.min(8, Math.floor(deckSize(s.lowestRank) / HAND_SIZE));

  const set = async (patch: Parameters<typeof api.settings>[0]) => {
    const r = await api.settings(patch);
    if (!r.ok && r.error) onError(r.error);
  };

  const copy = async () => {
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) {
        await navigator.share({ title: 'Durak', url: link });
      } else {
        await navigator.clipboard.writeText(link);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* user cancelled */
    }
  };

  return (
    <div className="lobby">
      <header className="topbar">
        <Logo small />
        <div className="topbar-right">
          <button className="icon-btn" onClick={() => setRules(true)} title={t('home.rules')}>
            📜
          </button>
          <MuteButton />
          <LangSwitch />
        </div>
      </header>

      <div className="lobby-grid">
        <section className="panel invite">
          <h3>{t('lobby.share')}</h3>
          <div className="room-code" aria-label={t('home.code')}>
            {view.code.split('').map((ch, i) => (
              <span key={i}>{ch}</span>
            ))}
          </div>
          <div className="link-row">
            <code>{link}</code>
            <button className="btn small" onClick={copy}>
              {copied ? `✅ ${t('lobby.copied')}` : `🔗 ${t('lobby.copy')}`}
            </button>
          </div>
        </section>

        <section className="panel">
          <h3>
            {t('lobby.players')} <span className="muted">
              {seated.length}/{s.maxPlayers}
            </span>
          </h3>
          <ul className="player-list">
            {view.players.map((p) => (
              <li key={p.id} className={p.connected ? '' : 'offline'}>
                <Avatar id={p.id} name={p.name} size={38} dim={!p.connected} />
                <span className="pname">
                  {p.name}
                  {p.id === view.you && <em className="muted"> ({t('lobby.you')})</em>}
                </span>
                {p.isHost && <span className="badge gold">👑 {t('lobby.host')}</span>}
                {p.spectator && <span className="badge">👀 {t('lobby.spectator')}</span>}
                {p.durakCount > 0 && <span className="badge red">🤡 {t('lobby.durakCount', { n: p.durakCount })}</span>}
                {!p.connected && <span className="badge">{t('game.offline')}</span>}
                {isHost && p.id !== view.you && (
                  <button className="link-btn" onClick={() => api.kick(p.id)}>
                    {t('lobby.kick')}
                  </button>
                )}
              </li>
            ))}
            {Array.from({ length: Math.max(0, s.maxPlayers - seated.length) }).map((_, i) => (
              <li key={`e${i}`} className="empty-seat">
                <div className="avatar empty">?</div>
                <span className="muted">{t('lobby.empty')}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className={`panel settings ${isHost ? '' : 'readonly'}`}>
          <h3>{t('lobby.settings')}</h3>
          <div className="setting">
            <label>
              {t('lobby.deck')} <b>{RANK_LABEL[s.lowestRank]}</b>
              <span className="muted"> · {t('lobby.cards', { n: deckSize(s.lowestRank) })}</span>
            </label>
            <div className="chips">
              {RANKS.map((r) => (
                <button
                  key={r}
                  disabled={!isHost}
                  className={`chip ${s.lowestRank === r ? 'on' : ''}`}
                  onClick={() => set({ lowestRank: r })}
                  title={t('lobby.cards', { n: deckSize(r) })}
                >
                  {RANK_LABEL[r]}
                  <small>{deckSize(r)}</small>
                </button>
              ))}
            </div>
          </div>
          <div className="setting">
            <label>⏱️ {t('lobby.timer')}</label>
            <div className="chips">
              {TIMER_OPTIONS.map((sec) => (
                <button
                  key={sec}
                  disabled={!isHost}
                  className={`chip ${s.turnSeconds === sec ? 'on' : ''}`}
                  onClick={() => set({ turnSeconds: sec })}
                >
                  {sec === 0 ? t('lobby.off') : `${sec}s`}
                </button>
              ))}
            </div>
          </div>
          <div className="setting row">
            <label>↪️ {t('lobby.transfer')}</label>
            <button
              disabled={!isHost}
              className={`toggle ${s.transfer ? 'on' : ''}`}
              onClick={() => set({ transfer: !s.transfer })}
              aria-pressed={s.transfer}
            >
              <span />
            </button>
          </div>
          <div className="setting row">
            <label>👥 {t('lobby.maxPlayers')}</label>
            <div className="stepper">
              <button disabled={!isHost || s.maxPlayers <= 2} onClick={() => set({ maxPlayers: s.maxPlayers - 1 })}>
                −
              </button>
              <b>{s.maxPlayers}</b>
              <button
                disabled={!isHost || s.maxPlayers >= maxForDeck}
                onClick={() => set({ maxPlayers: s.maxPlayers + 1 })}
              >
                +
              </button>
            </div>
          </div>
        </section>
      </div>

      <footer className="lobby-actions">
        <button className="btn ghost" onClick={onLeave}>
          🚪 {t('lobby.leave')}
        </button>
        {isHost ? (
          <button
            className="btn primary big pulse"
            disabled={seated.length < 2}
            onClick={async () => {
              const r = await api.start();
              if (!r.ok && r.error) onError(r.error);
            }}
          >
            {seated.length < 2 ? t('lobby.needTwo') : `🃏 ${t('lobby.start')}`}
          </button>
        ) : (
          <div className="waiting">{t('lobby.waitHost', { name: host?.name ?? '…' })}</div>
        )}
      </footer>
      {rules && <RulesModal onClose={() => setRules(false)} />}
    </div>
  );
}
