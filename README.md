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
- The creator can close voting from the same browser; results remain visible

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


## Recent improvements / Последние улучшения

Creators can open Create a similar poll to prepare an editable draft with only the title and options. Votes, closure and ownership secrets are not copied. A new poll is published only on explicit submission; the template endpoint checks the creator’s current session.

Создатель может подготовить похожий опрос: только заголовок и варианты, без голосов и закрытия. Новый опрос публикуется отдельным действием; права проверяются сервером по сессии.

Startup diagnostics / Проверка запуска: `node server/index.mjs --check` checks the local address, configuration and writable data location without creating a database or starting the API. To use another port: `--port 3005`. No tokens are printed. / База и сервер при проверке не создаются; секреты не выводятся.


## Session ownership — 14 November

The original signing key is preserved on restart. Empty, malformed or oversized key files now stop startup before SQLite opens. A missing key beside an existing database is not regenerated: restore the matching database/session-key backup. Creating a new key does not recover a lost browser cookie, and no endpoint grants ownership to a stranger. Explicit managed options.secret must remain identical on every start; automatic key rotation is not implemented.

Fresh initialization writes and syncs a private temporary key, then publishes it with a same-filesystem hard link without replacing an existing key. Concurrent initializers read the same complete key. Normal temporary files are cleaned. The data filesystem must support hard links; unsupported storage fails rather than silently changing identity. This is not a hardware power-loss or arbitrary-filesystem guarantee. Disk keys are exactly 64 lowercase hex bytes; managed secrets are bounded to 32–128 bytes. No secret values are logged. Backups contain sensitive signing material and must remain private.

При отсутствии или повреждении session-key восстановите исходный ключ из согласованной резервной копии. Удаление ключа не сбрасывает пароль и не возвращает потерянную cookie. Публичная информация об опросе не содержит owner secret. Сервер не восстанавливает права на основании ID опроса.

Creator access belongs to the original browser session, not the share link or the recent-polls list. Keep its cookies and site data. If that session is lost, the app explains the limitation; it cannot recover ownership. Viewing and voting in open polls remain available.

Poll creation now retries the same saved request after a lost response, keeping one poll. An unconfirmed Close action refreshes server state before offering another action. Keep the original browser session and its pending request; clients that omit `requestId` retain the legacy create behavior.

After an interrupted creation, **Retry the same request** preserves the saved intent. Lost vote replies are checked against server state; choices stay locked if that check is unavailable. Closing and voting follow database commit order, and repeating Close does not rewrite an already closed poll.

Polls now explain whether a vote was already counted or the poll was closed. Loading a similar-poll template retries safely without publishing: only the question and options are copied, while an existing unconfirmed creation keeps its original request.


## Deadline API

**Optional deadlines:** enter a UTC date and time in the creation form, with a local-time preview. Leave it blank to create a poll without a deadline. API clients can also hide results until the poll closes. See [poll settings and upgrade notes](OPERATIONS.md#deadline-form-and-hidden-results--22-november).

### Poll settings and multiple-choice mode (23 November)

The creation form now offers **Hide results until closing** (opt-in) and **Multiple options** (opt-in). The defaults are unchanged: one answer per visitor and aggregate results visible for an open poll. Multi-choice ballots allow one to six distinct selected options, with one immutable ballot per browser session. The UI counts participants separately from per-option selections; percentages for multi-choice polls can sum above 100%. Anonymous browser sessions do not verify unique persons.

Pending creation intents use version 2 and pin the request UUID, deadline, visibility and choice mode. Legacy saved intents are read with defaults; a replay cannot silently change settings. The server preserves legacy single-choice creation hashes and votes, and stores multi-choice ballots separately. Hidden polls return no aggregate or ballot total to any visitor until closure. This does not hide any results already exposed before closing.

**Deployment:** Back up the SQLite WAL set and original session key together. Deploy backend and generated frontend from the same tested commit, then check real HTTP behavior. GitHub Pages only publishes static assets, not the Node.js backend. A rollback of only the server binary is not safe once new-mode polls have been written. See [OPERATIONS.md](OPERATIONS.md).

### Schedule a meeting — typed UTC slots

Choose **Schedule a meeting** in the creation form to propose 2–6 distinct UTC instants. A voting deadline **before the first meeting time** is required; all slots must be in the future and within 365 days. The form previews local times for your browser. Guests and the organizer can see the same slot instants while their displayed local times depend on their timezone.

Meeting polls have `mode:'meeting'`, numeric `slots` (UTC milliseconds), and a separate `poll_meeting_slots` table — never date strings hidden inside ordinary poll choices. Voting sends `{id,slot:index}`. Only one slot can be selected per browser session. The result includes `slots`, `choice` and `counts`; the earlier single/multiple modes and creation hashes are unchanged. The create form never silently copies another meeting's dates.

**Known limits:** these are fixed proposals, not calendar bookings, invitation delivery, capacity management or verified attendance. A participant with a new browser session may vote again. Google/GitHub Pages publishes only static assets; the separate Node backend needs a matching rollout. See [OPERATIONS.md](OPERATIONS.md).


### Save an editable poll draft

Use **Save draft** before publishing to keep your title, options, UTC meeting slots, deadline, poll mode and result visibility in **this browser's localStorage only**. Reloading does not publish anything; choose **Restore draft** to load it back into the form. The owner-only **Create similar** link takes precedence when opened and never silently replaces a saved draft. **Delete draft** clears only the local draft; it leaves the current form and any pending publication intact.

Drafts expire after 30 days and contain no request UUID, owner secret or vote data. Missing storage permission, exceeded quota, unsupported versions or corrupted drafts fail safely; delete a damaged draft deliberately rather than overwriting it. The separate sessionStorage pending creation receipt is immutable after an uncertain response and cannot be replaced by a draft. Nothing is synchronized across devices. On successful publication, remove any obsolete saved draft manually.
