# 🃏 Durak Online

Echtzeit-Multiplayer für das russische Kartenspiel **Durak**, im Browser, ohne Accounts.
Namen eingeben, Tisch eröffnen, Link an die Freunde schicken, losspielen.

- **Schiebe-Durak (Perewodnoj)** als Standard, in der Lobby abschaltbar
- **Nachlegen nur durch die Nachbarn** des Verteidigers
- **Deckgröße wählbar**: Karten ab 2 (52 Karten) bis ab 10 (20 Karten), Standard ab 6 (36)
- **Timer pro Zug** (aus / 10–90 s):
  - Verteidiger zu langsam → nimmt automatisch auf
  - Angreifer zu langsam → seine niedrigste Karte wird automatisch ausgespielt
  - Beim Nachlegen läuft die halbe Zeit, danach gilt „Bito“
- 2–6 Spieler (bei 52 Karten bis 8), Zuschauer steigen in der nächsten Runde ein
- Sofortige Updates über WebSockets, Reload bringt dich an deinen Platz zurück
- 🇩🇪 Deutsch, 🇫🇷 Französisch, 🇬🇧 Englisch, 🇮🇹 Italienisch, 🇳🇴 Norwegisch, 🇹🇷 Türkisch: pro Spieler umschaltbar, Standard nach Browsersprache
- Emoji-Reaktionen, Soundeffekte, Revanche-Knopf, Durak-Zähler pro Tisch
- Kartengrafiken: [@letele/playing-cards](https://github.com/letele/playing-cards) nach Adrian Kennards SVG-Karten (CC0)

## Deployment mit Dockge

GitHub Actions baut bei jedem Push ein Multi-Arch-Image (amd64 + arm64) und legt es in die
GitHub Container Registry: `ghcr.io/floxo05/durak`.

| Tag | wann |
| --- | --- |
| `latest` | Push auf den Default-Branch |
| `<branch>` | jeder Push auf einen Branch (`/` → `-`) |
| `sha-xxxxxxx` | jeder Commit |
| `1.2.3` | Git-Tag `v1.2.3` |

In Dockge einen neuen Stack anlegen und die [`compose.yaml`](compose.yaml) aus dem Repo einfügen.

### Einstellungen (Umgebungsvariablen)

| Variable | Standard | Bedeutung |
| --- | --- | --- |
| `MAX_ROOMS` | `5` | Tische gleichzeitig. Weitere werden mit Hinweis abgelehnt. |
| `MAX_CONNECTIONS` | `60` | Browser-Verbindungen insgesamt |
| `ABANDONED_MINUTES` | `5` | Ist niemand mehr an einem Tisch verbunden, wird er nach dieser Zeit freigegeben. |
| `PORT` | `3000` | Port im Container |

### Absicherung

Die `compose.yaml` ist so gehärtet, dass der Container höchstens sich selbst lahmlegen kann:

- läuft als UID/GID `1000`, nie als root; die App-Dateien gehören root und sind für die App nur lesbar
- `read_only` Dateisystem (die App schreibt nichts auf die Platte), nur `/tmp` als kleines tmpfs
- `cap_drop: ALL` und `no-new-privileges`
- Limits: 256 MB RAM ohne Swap, 0,5 CPU, 64 Prozesse, 1024 Dateien, Log-Rotation
- eigener Stack = eigenes Docker-Netz, kein Zugriff auf andere Stacks
- Server-seitig: max. Tische und Verbindungen (s. o.), Nachrichten über 16 KB werden abgewiesen

Die `compose.yaml` veröffentlicht keinen Port, sondern hängt den Container an das externe Netz von Nginx Proxy Manager (`npm`). In NPM einen Proxy Host auf `http://durak:3000` anlegen und *Websockets Support* aktivieren. Heißt das NPM-Netz anders, `name:` unter `networks` anpassen (`docker network ls`).

**Privates Repo?** Dann ist auch das Paket auf GHCR privat. Entweder unter
GitHub → Packages → durak → *Package settings* die Sichtbarkeit auf *Public* stellen, oder auf dem Server
einmalig `docker login ghcr.io -u <github-user>` mit einem Personal Access Token (`read:packages`) ausführen.

**Reverse Proxy** (Nginx Proxy Manager, Traefik, Caddy …): WebSockets müssen erlaubt sein
(bei NPM: *Websockets Support* anhaken).

Der Spielzustand liegt nur im Arbeitsspeicher. Ein Neustart des Containers beendet laufende Tische.

## Entwicklung

```bash
npm install
npm run dev        # Server :3000 + Vite :5173 (mit Proxy)
npm test           # Regel-Tests (vitest)
npm run typecheck
npm run build && npm start
```

Lokal selbst bauen: `docker build -t durak .`

### Aufbau

```
shared/   Kartenmodell, Protokoll-Typen (Server + Client)
server/   game.ts   – Regel-Engine (rein, getestet)
          rooms.ts  – Tische, Sessions, Timer, Wiederverbinden
          index.ts  – Express + Socket.IO
client/   React + Vite Frontend (Lobby, Tisch, i18n, Sounds)
```
