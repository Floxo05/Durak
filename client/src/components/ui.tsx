import { useEffect, useState } from 'react';
import { LANGS, useI18n } from '../i18n';
import { isMuted, play, setMuted } from '../sound';

export function hue(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase();
}

export function Avatar({ id, name, size = 44, dim }: { id: string; name: string; size?: number; dim?: boolean }) {
  const h = hue(id);
  return (
    <div
      className={`avatar ${dim ? 'dim' : ''}`}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: `linear-gradient(135deg, hsl(${h} 70% 58%), hsl(${(h + 40) % 360} 65% 42%))`,
      }}
    >
      {initials(name)}
    </div>
  );
}

/** remaining fraction 0..1 of a deadline, ticking smoothly */
export function useCountdown(deadline: number | null, totalMs: number, offset: number) {
  const [now, setNow] = useState(() => Date.now() + offset);
  useEffect(() => {
    if (!deadline) return;
    let raf = 0;
    let last = 0;
    const loop = (ts: number) => {
      if (ts - last > 100) {
        last = ts;
        setNow(Date.now() + offset);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [deadline, offset]);
  if (!deadline) return { frac: 1, secs: 0 };
  const left = Math.max(0, deadline - now);
  return { frac: Math.min(1, left / totalMs), secs: Math.ceil(left / 1000) };
}

export function LangSwitch() {
  const { lang, setLang } = useI18n();
  const cur = LANGS.find((l) => l.id === lang) ?? LANGS[0];
  return (
    <label className="lang-switch" title={cur.label}>
      <span className="lang-current" aria-hidden>
        {cur.flag} <span className="lang-code">{cur.id.toUpperCase()}</span> ▾
      </span>
      <select value={lang} onChange={(e) => setLang(e.target.value as typeof lang)} aria-label="Language">
        {LANGS.map((l) => (
          <option key={l.id} value={l.id}>
            {l.flag} {l.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function MuteButton() {
  const { t } = useI18n();
  const [m, setM] = useState(isMuted());
  return (
    <button
      className="icon-btn"
      title={t('game.mute')}
      onClick={() => {
        setMuted(!m);
        setM(!m);
        if (m) play('pop');
      }}
    >
      {m ? '🔇' : '🔊'}
    </button>
  );
}

export function RulesModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{t('rules.title')}</h2>
        <ol className="rules">
          {[1, 2, 3, 4, 5, 6, 7].map((i) => (
            <li key={i}>{t(`rules.${i}`)}</li>
          ))}
        </ol>
        <button className="btn primary" onClick={onClose}>
          {t('common.close')}
        </button>
      </div>
    </div>
  );
}

export function Logo({ small }: { small?: boolean }) {
  return (
    <div className={`logo ${small ? 'small' : ''}`}>
      <span className="logo-hat">🃏</span>
      <span className="logo-text">DURAK</span>
      <span className="logo-suits">
        <i className="red">♥</i>
        <i>♠</i>
        <i className="red">♦</i>
        <i>♣</i>
      </span>
    </div>
  );
}
