<div align="center">

<img src="assets/icon.svg" width="88" height="88" alt="Crowd Decides">

# Crowd Decides

**Send a link. Settle the question.**

Create a quick poll and let your friends decide together.

**English** · [Русский](README.ru.md)

![platform: Node.js 24+](https://img.shields.io/badge/platform-Node.js_24%2B-287f76?style=flat-square&logo=nodedotjs&logoColor=white) ![source: JavaScript](https://img.shields.io/badge/source-JavaScript-5966b7?style=flat-square&logo=javascript&logoColor=white) ![UI: Light + Dark](https://img.shields.io/badge/UI-Light_%2B_Dark-555555?style=flat-square)

</div>

[Features](#features) · [Stack](#technology-stack) · [Quick start](#quick-start) · [License](LICENSE)

![Actual application with the English interface](assets/preview.jpg)

*Actual local application capture with an empty test database; this is not audience activity.*

## Features

- Two to six distinct choices
- Unguessable links for sharing
- Shared results and browser-local recent polls

**Try the flow: Ask → share → vote → decide.**

Documentation: English / Русский. App interface: English, Русский, selected from browser preferences or manually. System theme by default, with explicit light and dark modes. The system mode follows device changes; your choice is saved locally.

## Technology stack

| Layer | Implementation |
| --- | --- |
| Interface | HTML · CSS · JavaScript / native ES modules |
| Runtime | Node.js 24+ · SQLite |
| Development | JavaScript |
| Dependencies | No third-party browser libraries or remote fonts |

## Quick start

Requires Node.js 24+. No install or build step.

```sh
npm start
```

Open http://localhost:3000. The root opens this application; unrelated app routes and APIs are disabled. Data persists in `data/minute.sqlite`.

```sh
npm test
npm run check
```

## Deploy

Set `PUBLIC_ORIGIN` to the exact HTTPS origin, give the process a persistent `DATA_DIR`, and put an HTTPS reverse proxy in front. Example Dockerfile, Caddy config, environment file, and systemd unit are included. Each independent project needs its own port and data directory. `.env` is not loaded automatically: use exported variables or `node --env-file=.env server/index.mjs`. See [OPERATIONS.md](OPERATIONS.md) for backups, moderation, identity limitations, and storage details.

Polls have 2–6 distinct choices and unguessable share links. Everyone with the link can participate. Results are shared, recent poll history is browser-local. Anonymous browser voting is not identity verification.

---

[More by den9911](https://github.com/den9911) · [Report an issue](https://github.com/den9911/crowd-decides/issues) · [LICENSE](LICENSE)
