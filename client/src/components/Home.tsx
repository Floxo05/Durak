import { useState } from 'react';
import { useI18n } from '../i18n';
import { LangSwitch, Logo, RulesModal } from './ui';
import { PlayingCard } from './Card';

interface Props {
  invite: string | null;
  initialName: string;
  busy: boolean;
  onCreate: (name: string) => void;
  onJoin: (code: string, name: string) => void;
}

const SHOWCASE = [
  { s: 'H' as const, r: 14 },
  { s: 'S' as const, r: 13 },
  { s: 'D' as const, r: 12 },
  { s: 'C' as const, r: 11 },
  { s: 'H' as const, r: 6 },
];

export function Home({ invite, initialName, busy, onCreate, onJoin }: Props) {
  const { t } = useI18n();
  const [name, setName] = useState(initialName);
  const [code, setCode] = useState(invite ?? '');
  const [rules, setRules] = useState(false);
  const clean = name.trim();

  return (
    <div className="home">
      <div className="home-top">
        <LangSwitch />
        <button className="btn ghost small" onClick={() => setRules(true)}>
          📜 {t('home.rules')}
        </button>
      </div>
      <div className="home-hero">
        <div className="showcase">
          {SHOWCASE.map((c, i) => (
            <PlayingCard key={i} card={c} className="showcase-card" style={{ ['--i' as string]: i - 2 }} />
          ))}
        </div>
        <Logo />
        <p className="tagline">{t('app.tagline')}</p>
      </div>

      <form
        className="panel home-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!clean) return;
          if (invite || code.trim().length === 4) onJoin(code.trim().toUpperCase(), clean);
          else onCreate(clean);
        }}
      >
        {invite && <div className="invite-note">✉️ {t('home.invited', { code: invite })}</div>}
        <label className="field">
          <span>{t('home.name')}</span>
          <input
            autoFocus
            maxLength={16}
            value={name}
            placeholder={t('home.namePh')}
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        {invite ? (
          <button className="btn primary big" disabled={!clean || busy} type="submit">
            🚪 {t('home.join')} {invite}
          </button>
        ) : (
          <>
            <button className="btn primary big" disabled={!clean || busy} type="button" onClick={() => onCreate(clean)}>
              ✨ {t('home.create')}
            </button>
            <div className="divider">
              <span>{t('home.or')}</span>
            </div>
            <div className="join-row">
              <input
                className="code-input"
                maxLength={4}
                value={code}
                placeholder="ABCD"
                onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                aria-label={t('home.code')}
              />
              <button
                className="btn"
                disabled={!clean || code.length !== 4 || busy}
                type="button"
                onClick={() => onJoin(code, clean)}
              >
                {t('home.join')}
              </button>
            </div>
          </>
        )}
      </form>
      {rules && <RulesModal onClose={() => setRules(false)} />}
    </div>
  );
}
