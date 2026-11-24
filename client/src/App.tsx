import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { I18nContext, detectLang, makeT } from './i18n';
import { api, saveName, saveRoom, savedName, savedRoom, socket } from './net';
import type { Lang, Reaction, RoomView } from '../../shared/protocol';
import { Home } from './components/Home';
import { Lobby } from './components/Lobby';
import { Table, type FloatingReaction } from './components/Table';

const codeFromPath = () => {
  const m = location.pathname.match(/^\/([A-Za-z0-9]{4})\/?$/);
  return m ? m[1].toUpperCase() : null;
};

interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error';
}

export function App() {
  const [lang, setLangState] = useState<Lang>(detectLang);
  const t = useMemo(() => makeT(lang), [lang]);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem('durak.lang', l);
    } catch {
      /* ignore */
    }
    document.documentElement.lang = l;
  }, []);

  const [view, setView] = useState<RoomView | null>(null);
  const [offset, setOffset] = useState(0);
  const [connected, setConnected] = useState(socket.connected);
  const [busy, setBusy] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [reactions, setReactions] = useState<FloatingReaction[]>([]);
  const [showLobby, setShowLobby] = useState(false);
  const invite = useRef(codeFromPath());
  const toastId = useRef(0);
  const roomRef = useRef<{ code: string; name: string } | null>(null);

  const toast = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = ++toastId.current;
    setToasts((ts) => [...ts.slice(-3), { id, text, kind }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), kind === 'error' ? 3200 : 2600);
  }, []);
  const error = useCallback((key: string) => toast(t(key), 'error'), [t, toast]);
  const errorRef = useRef(error);
  errorRef.current = error;

  const enterRoom = useCallback((code: string, name: string) => {
    roomRef.current = { code, name };
    saveRoom(code);
    saveName(name);
    if (location.pathname !== `/${code}`) history.replaceState(null, '', `/${code}`);
  }, []);

  const resetToHome = useCallback(() => {
    roomRef.current = null;
    saveRoom(null);
    setView(null);
    history.replaceState(null, '', '/');
    invite.current = null;
  }, []);

  useEffect(() => {
    const onState = (v: RoomView) => {
      setOffset(v.serverNow - Date.now());
      setView(v);
    };
    const onReaction = (r: Reaction) => {
      const key = Math.random();
      setReactions((rs) => [...rs.slice(-12), { key, ...r }]);
      setTimeout(() => setReactions((rs) => rs.filter((x) => x.key !== key)), 2200);
    };
    const onConnect = async () => {
      setConnected(true);
      const cur = roomRef.current;
      if (cur) {
        const r = await api.join(cur.code, cur.name);
        if (!r.ok) {
          errorRef.current(r.error ?? 'err.noRoom');
          resetToHome();
        }
      }
    };
    const onDisconnect = () => setConnected(false);
    const onKicked = () => {
      errorRef.current('err.kicked');
      resetToHome();
    };
    socket.on('state', onState);
    socket.on('reaction', onReaction);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('kicked', onKicked);

    // reconnect after reload: same tab token + room remembered in sessionStorage
    const remembered = savedRoom();
    const name = savedName();
    const code = invite.current;
    if (remembered && code === remembered && name) {
      roomRef.current = { code, name };
      if (socket.connected) void onConnect();
    }
    return () => {
      socket.off('state', onState);
      socket.off('reaction', onReaction);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('kicked', onKicked);
    };
  }, [resetToHome]);

  useEffect(() => {
    if (view?.phase === 'playing') setShowLobby(false);
  }, [view?.phase]);

  const create = async (name: string) => {
    setBusy(true);
    const r = await api.create(name);
    setBusy(false);
    if (r.ok && r.code) enterRoom(r.code, name);
    else error(r.error ?? 'err.invalid');
  };
  const join = async (code: string, name: string) => {
    setBusy(true);
    const r = await api.join(code, name);
    setBusy(false);
    if (r.ok && r.code) enterRoom(r.code, name);
    else {
      error(r.error ?? 'err.invalid');
      if (r.error === 'err.roomNotFound') {
        invite.current = null;
        history.replaceState(null, '', '/');
      }
    }
  };
  const leave = async () => {
    await api.leave();
    resetToHome();
  };

  let screen;
  if (!view || !roomRef.current) {
    screen = (
      <Home invite={invite.current} initialName={savedName()} busy={busy || !connected} onCreate={create} onJoin={join} />
    );
  } else if (view.phase === 'lobby' || (view.phase === 'finished' && showLobby) || !view.game) {
    screen = <Lobby view={view} onError={error} onLeave={leave} />;
  } else {
    screen = (
      <Table
        view={view}
        offset={offset}
        reactions={reactions}
        onError={error}
        onToast={toast}
        onLeave={leave}
        onShowLobby={() => setShowLobby(true)}
      />
    );
  }

  return (
    <I18nContext.Provider value={{ lang, t, setLang }}>
      {screen}
      {!connected && <div className="conn-banner">📡 {t('err.disconnected')}</div>}
      <div className="toasts">
        {toasts.map((x) => (
          <div key={x.id} className={`toast ${x.kind}`}>
            {x.text}
          </div>
        ))}
      </div>
    </I18nContext.Provider>
  );
}
