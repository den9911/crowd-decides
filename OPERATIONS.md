# Minute Club

Ten small web projects with Russian interfaces, a shared lightweight visual language, and no runtime dependencies. Seven use Node.js 24 + SQLite for real community data; three run entirely in the browser. No remote fonts, trackers, CDN assets, build framework, or paid API.

| Repository | Route | Features | Runtime |
| --- | --- | --- | --- |
| caption-club | /caption/ | Daily original illustration, captions, voting, yesterday's winner, share links, PNG cards | Node + SQLite |
| majority-vote | /majority/ | 12 unusual questions, majority prediction, real answer counts, direct question links | Node + SQLite |
| meme-arena | /arena/ | Seed memes, unique pair battles, win counts, moderated image submissions | Node + SQLite |
| memory-sketch | /memory/ | 30-second canvas drawing, undo, eraser, four references, PNG export, friend challenges | Static |
| excuse-bureau | /papers/ | Three document templates, live canvas preview, local drafts, PNG export | Static |
| crowd-decides | /decide/ | Shareable polls with 2–6 options, results, browser-local recent polls | Node + SQLite |
| pixel-rooms | /house/ | Shared room gallery, 16×16 editor, 16 colors, keyboard controls, undo, conflict detection | Node + SQLite |
| daily-minute | /minute/ | Shared daily odd-word puzzle, server-validated attempts, elapsed time, local history | Node + SQLite |
| odd-finds | /finds/ | Moderated photo collection, categories, voting, sorting, pagination, direct item links | Node + SQLite |
| motion-playground | /mischief/ | Escaping button, draggable spring cards, playful progress, 3D flip, calm mode | Static |

## Run the combined development project

Requires Node.js 24 or newer. No installation step:

```sh
npm start
```

Open http://localhost:3000. The tenth experiment is at `/mischief/`. To enable image submissions, first set `ADMIN_TOKEN` to a long random value; uploads remain private until approved at `/admin/`.

```sh
ADMIN_TOKEN='replace-with-a-long-random-value' npm start
npm test
npm run check
```

## Create standalone packages

```sh
node ops/export.mjs /absolute/path/to/output
```

Each folder is an independent project. Server packages expose only their own API group and route. Static packages contain a `public/` directory that any static web server can serve at a domain root; they do not call an API.

## Deploy on your server

Node packages require one process each. They bind to loopback by default; put Caddy or another HTTPS reverse proxy in front. Each project must use its own port, `DATA_DIR`, and origin. Set environment variables through your service manager or `node --env-file=.env server/index.mjs`; `.env` is not loaded automatically. Examples are in `ops/`.

```sh
PORT=3001 PUBLIC_ORIGIN=https://caption.example.com DATA_DIR=/srv/caption-data npm start
```

Alternatively build the included Dockerfile, bind port 3000 to loopback, and mount a persistent volume at `/app/data`. Do not expose a development server to the internet.

Static packages can be served with Caddy's `file_server` or any static host. Their absolute asset paths assume a domain root, not a GitHub Pages project subdirectory. No hosting or domain changes are performed by this repository.

## Disk budget and media

The combined project limits accepted images to 80 GB total. Standalone Meme Arena and Odd Finds default to **40 GB each**, leaving 20 GB of your 100 GB allocation for databases, WAL, and operational headroom. Set `UPLOAD_BUDGET_BYTES` to change the per-project limit. This limits image payload bytes, not total filesystem use; monitor actual disk space. Keep backups on a different disk or reserve more headroom for them.

Only JPEG, PNG, and non-animated WebP are accepted. The browser re-encodes to at most 1200 pixels and 500,000 bytes, stripping original metadata. The server independently checks signature, size, and dimensions (max 2048×2048), then stores the bytes in SQLite. GIF/APNG/animated WebP are deliberately excluded from v1. Failed submissions never become public. Without `ADMIN_TOKEN`, uploads are disabled.

No public object-store keys, paid services, or original large uploads are needed. There is no image-generation AI dependency: starter illustrations are original lightweight vectors.

## Operations and moderation

- `/healthz`: process health endpoint.
- `/admin/`: pending images and reported posts. The key stays in tab memory; it is never put in a URL or localStorage.
- Approve to publish, or delete to remove a post, image, and attached reports. SQLite reuses freed pages; file size will not immediately shrink. Run SQLite `VACUUM` only during a planned offline maintenance window with enough free disk space.
- Back up with `node ops/backup.mjs /other-disk/backup.sqlite`. It uses SQLite's online backup API, including committed WAL content. Also protect a copy of `data/session-key` if preserving browser room access after a restore matters. Test restores periodically.
- Use one Node process per database. Do not cluster multiple writers or put a live SQLite database on a network filesystem.
- Rate limits are per TCP peer, with write and publication limits. Behind the supplied reverse proxy, all traffic shares the proxy's bucket. For a larger audience, enforce visitor-specific limits at the proxy and adjust the application limiter deliberately; arbitrary forwarded headers are not trusted.
- Pending queues return the latest 100 items per request. Review them regularly before accepting a large volume of submissions.
- Reports are a manual moderation workflow, not automatic content detection. Configure a real contact channel and any jurisdiction-specific notices before a public launch.

## Identity and limitations

A random HMAC-signed HttpOnly SameSite cookie identifies a browser. Secure cookies are enabled when `PUBLIC_ORIGIN` is HTTPS. This prevents tampering with an existing session ID but does not make a browser a verified person: clearing cookies can create another identity. The polls are for entertainment, not elections. There is no login, account recovery, or cross-device room ownership in v1.

Submitted text is escaped before DOM insertion. The server uses parameterized SQL, bounded JSON, same-origin checks, restrictive CSP, and MIME sniffing restrictions. Anonymous public content still requires ongoing moderation. Daily tasks use Europe/Moscow by default; configure `APP_TIMEZONE` before launch, not mid-contest.

The daily word puzzle rotates seven word pairs; the caption contest rotates five original scenes. Expand those content pools in `server/content.mjs` as the audience grows. Drawing comparisons are visual; no automatic recognition or score is claimed. Poll results and meme ranks are real visitor counts, with no invented engagement data.

## Validation

`npm test` exercises actual HTTP requests and temporary SQLite databases: publication, repeated votes, pair validation, poll option validation, room ownership and version conflicts, daily answers, pending media privacy, moderation, reports, quotas, origins, rollback, and restart persistence. `npm run check` validates JavaScript syntax, local asset references, and an 18 KB gzip ceiling for common assets.

The shared server test can be run with Node's coverage support:

```sh
node --test --experimental-test-coverage tests/server.test.mjs
```

UI interactions must also be checked in a real browser. Automated server coverage does not measure browser canvas behavior, mobile layout, or abuse resistance under a production workload.


## Session ownership — 14 November

The original signing key is preserved on restart. Empty, malformed or oversized key files now stop startup before SQLite opens. A missing key beside an existing database is not regenerated: restore the matching database/session-key backup. Creating a new key does not recover a lost browser cookie, and no endpoint grants ownership to a stranger. Explicit managed options.secret must remain identical on every start; automatic key rotation is not implemented.

Fresh initialization writes and syncs a private temporary key, then publishes it with a same-filesystem hard link without replacing an existing key. Concurrent initializers read the same complete key. Normal temporary files are cleaned. The data filesystem must support hard links; unsupported storage fails rather than silently changing identity. This is not a hardware power-loss or arbitrary-filesystem guarantee. Disk keys are exactly 64 lowercase hex bytes; managed secrets are bounded to 32–128 bytes. No secret values are logged. Backups contain sensitive signing material and must remain private.

При отсутствии или повреждении session-key восстановите исходный ключ из согласованной резервной копии. Удаление ключа не сбрасывает пароль и не возвращает потерянную cookie. Публичная информация об опросе не содержит owner secret. Сервер не восстанавливает права на основании ID опроса.

## Session startup diagnosis and interrupted initialization

`node server/index.mjs --check --port 0` now validates the persisted signing key before opening SQLite. The result reports only `sessionKey: fresh` or `persisted`; it does not print, generate or repair a key. Invalid, missing-with-database or inaccessible keys stop startup with the fixed bilingual `SESSION_KEY_UNAVAILABLE` message. Restore the **original** key with its matching database and check directory permissions; do not generate a replacement to bypass the error. This policy also applies to normal startup. A format-valid but incorrect key is not detectable by these checks; preserve matched backups.

The key is fully written and synced before no-overwrite publication on the same filesystem. A hard process kill can leave one private `.session-key-<UUID>.tmp` file per interrupted initialization. It is never loaded as a key. After stopping **all** processes using the data directory, an operator can remove only those staging files; never remove `session-key` or the database. Automatic orphan deletion is intentionally absent because another initializer may still own a staging file. Repeated abrupt kills can therefore accumulate staging files. Normal write failures close handles and remove their own temporary file. These are process-crash tests, not power-loss or filesystem durability guarantees; hard-link support is still required.

## Lost browser sessions

Only the signed `minute_session` cookie for the original creator can close or copy a poll. LocalStorage's recent-polls list and a shared URL are convenience links, not credentials. The app cannot tell whether a visitor is a new participant or a creator who cleared cookies, and does not claim to detect either case. It gives the same explanation to all non-owners. Open the poll in the original browser **and profile**; private browsing ends its session when closed. There is no automatic ownership recovery or transfer endpoint.

Both owner-only endpoints return HTTP 403 plus the fixed `OWNER_SESSION_REQUIRED` code. They disclose no creator identifier or key. The UI refreshes ownership after a rejected stale Close action and removes management controls; a forbidden copy link shows the poll and access explanation without creating a draft or publishing anything. Repeating the rejected request does not change the poll. Closing an already closed poll remains safe for its real owner. Read access and voting in open polls are unaffected. This change does not implement deliberate signing-key rotation, account recovery, vote identity verification, or duplicate-create protection after a lost response.

Regression commands: `npm test`, `npm run build`, `npm run check`. The session portability CI runs ownership, real child-process crash/write-failure, CLI diagnosis and lost-session authorization tests on Windows and macOS in addition to the full Linux suite. Fault injection patches filesystem operations only in a test child process; the production server has no test environment switch or failpoint.
