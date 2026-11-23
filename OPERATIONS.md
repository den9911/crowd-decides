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

## Unconfirmed Close and durable creation requests (17 November)

This section updates the earlier note that duplicate-create protection is absent: it is now available for clients supplying `requestId`. Legacy clients without it still create a new poll on every valid POST.

Close uses a 10-second client timeout. A lost or failed response does not mean the write failed: the UI removes the stale Close button and attempts one GET to reconcile state. If GET also fails, a persistent EN/RU status asks the user to Refresh. It never retries the POST automatically. A successful GET restores only the controls justified by current server ownership/state. Cookie loss still grants no recovery rights. Aborted incoming HTTP requests produce no new error log or partial close; existing request/header limits remain in force.

`POST /api/polls` optionally accepts a lowercase UUID v4 `requestId`. A request validates and normalizes the title/options first. Within one SQLite transaction, an existing ID with the same creator and normalized payload returns the original `{id}` (HTTP 200); a new ID creates the poll (201). A different payload gets 409 `POLL_REQUEST_CONFLICT`. Another session gets 403 `OWNER_SESSION_REQUIRED`, without the poll ID. Request IDs are identifiers, not ownership credentials. An existing globally unique ID cannot create a second poll after cookie loss. Do not share request IDs; an attacker who learns an unused ID could reserve it first (denial of service, not ownership transfer).

The additive migration creates nullable `polls.request_id` / `request_hash` and a partial unique index on non-null request IDs; existing rows and votes remain intact. The hash covers normalized title and option order, not mutable close state. The receipt lives in the poll row, so no separate retry queue/table or unbounded per-attempt log is created. No TTL, automatic poll deletion, distributed database support, cluster writer mode or power-loss guarantee is added. Back up the matching SQLite files and session key before updating. Do not run an older server against pending new-client requests: older code ignores request IDs. If a future feature deletes a poll, it must separately decide whether to preserve its creation receipt.

The web form saves one bounded intent (UUID, original title and options) in sessionStorage before sending. After an uncertain response it locks the payload; an explicit repeat or reload reuses that intent. No automatic create POST runs on page load. Known validation errors allow correction. An unreadable or oversized saved intent fails closed; inspect recent polls in the original browser before explicitly clearing that saved request. A failed sessionStorage write prevents sending. Successful replies remove the pending intent and navigate to the poll. SessionStorage is per tab: losing the tab/storage or deliberately creating a fresh intent does not have cross-intent deduplication. Do not clear storage or switch browser profiles to retry an uncertain creation.

Tests cover real TCP interruption before the close body finishes and after close commit, forced process death/restart, rejected database writes, 32 aborted requests with connection counts (and file descriptors on Linux), concurrent same-intent replay, conflicting payloads, foreign sessions, rollback and legacy schema migration. Windows/macOS portability runs those HTTP/process tests as well as the earlier key tests. Local browser tests used real HTTP/SQLite with transport interception to lose responses; they are not part of the dependency-free CI browser suite. The remaining W0788 acceptance items still require their own interruption/resource/recovery review.

## Creation recovery and vote/close order (19 November)

W0788 acceptance is now complete in the documented one-process/SQLite scope. Real TCP/process tests cover a creation committed without a response, hard process termination, restart with the original signing key and replay returning HTTP 200 with one poll row. Another test aborts 32 incomplete request bodies, checks zero poll rows before a valid request, bounded live connections (and Linux file descriptors), then creates once and replays once. A refused INSERT leaves no creation receipt before or after restart. This does not add receipts for legacy clients without requestId or guarantees for lost tab storage, multiple processes, arbitrary filesystems or power loss.

The pending form explicitly offers **Retry the same request**, with an accessible description linked to its persistent status. Known validation failure unlocks editing and clears the obsolete pending-status description. No automatic creation POST runs after reload. Error messages remain fixed EN/RU copy and never print the request ID, signing key or user payload in the recovery status.

The existing synchronous vote transaction already prevented a committed vote after Close in the supported single-writer process; the race check also passed on the prior version. This release makes Close's read/check/update a transaction as well. A vote committed before Close stays counted; a vote handled after committed Close returns 409 and inserts nothing. HTTP arrival time and the physical click time do not define the winning order. A repeated owner Close returns the current result without issuing another UPDATE. It still acquires the transaction's write reservation and performs reads, so this is not a claim of zero database work. Session ownership is checked even when the poll is already closed.

A vote request locks every choice while pending. If its response is lost, the browser attempts a bounded GET to reconcile the stored choice, totals and closed state. If that read also fails, the choices remain locked and a persistent status asks for Refresh; no vote POST repeats automatically. Refresh may show a counted answer, an already closed poll, or still available options if no answer was stored. Same-session duplicate votes still return the existing 409 contract and cannot change the prior choice. A new browser session is still a new entertainment voter, not verified identity.

Linux Verify and Windows/macOS portability run creation interruption, rollback/restart and close/vote order checks. Twelve pairs of competing HTTP requests exercise both submission orders and assert that successful vote replies match the final stored count, then verify later votes are refused. This finite test is not proof of fairness, a scheduler timing guarantee or a long-running memory profile. Deliberate multi-process writers remain unsupported. W0789's remaining interruption/resource/recovery/release acceptance tasks stay open.

## Vote recovery and isolated template loading (20 November)

W0789 acceptance is complete within the supported single-process/SQLite model. Real child-process tests lose a vote response after its commit, kill the server, restart with the same signing key and verify the saved choice and one vote. Repeating that vote cannot change it; owner Close retains it and later votes are rejected. Another test interrupts 32 incomplete vote bodies, checks connections and Linux file descriptors, confirms no partial choice, then completes a valid vote and Close. A SQLite INSERT refusal leaves no vote before or after restart. These are finite process/transport tests, not a power-loss or long-term memory guarantee.

HTTP 409 vote errors now include fixed reason codes: `POLL_ALREADY_VOTED` or `POLL_CLOSED`. Both server and browser allowlist these codes; the existing status and error text contract remains. The UI rereads state and explains the saved answer or closure in EN/RU. If reading also fails, a confirmed closure is reported as such while its final result still needs Refresh. An unknown transport result stays explicitly unconfirmed. No vote POST retries automatically; lost cookie recovery and cross-process writers remain unsupported. The fixed status messages do not expose session IDs, signing keys, request IDs or user payloads.

The owner-only template endpoint selects only its source owner, title and options for authorization and projection. It returns exactly `{title, options}` and no original ID, owner, votes, close flag, creation request ID or hash. It no longer invokes the result-aggregation path or reads votes. The old endpoint already used an output allowlist; this change isolates that boundary rather than fixing a claimed data leak. The input poll ID remains limited to 50 characters; normal saved titles/options keep their existing limits. Repeated GET requests never publish or reserve a new creation request.

Template loading now uses the existing ten-second client timeout. A failure displays a persistent status and an explicit Retry loading the template button, which only retries GET. Opening the draft does not POST. A fresh submission sends the form's editable fields and a new creation request ID; caller-supplied owner, closed state, original poll ID, counts and receipt hash are ignored by the create path. If this tab already has a valid unconfirmed creation, its original payload and request ID take priority: the UI says the loaded template is not applied. This preserves the existing safe-repeat contract instead of silently discarding a potentially committed creation.

Portability CI includes the new vote-process and template-boundary tests on Windows/macOS, alongside full Linux Verify. Template tests record executed SQL without payloads, assert no votes/receipt query, compare source rows and votes before/after repeated GETs, and check a new poll starts open with zero votes and its own creation request. A first local full run hit a 20-second timeout in an older key-crash test; it passed separately. Test-only session-process shutdown now explicitly closes remaining HTTP connections after server.close. The subsequent full run passes; this is teardown hardening, not a confirmed production root-cause fix or a promise that all timing flakiness is eliminated.

W0790 is only 5/10 complete. Separate interruption, resource, recovery, observation and release acceptance for the template workflow remains open. Local browser tests use real HTTP/SQLite with intercepted failed responses; browser E2E is not claimed as part of the dependency-free CI job.


## Template recovery acceptance — 21 November

W0790 acceptance is complete in the supported one-process SQLite scope. A test child holds the owner-only GET response before delivery, the TCP client disconnects and the process is killed. After restart the closed source still has its original vote; the template contains only title/options. A failed child INSERT leaves no receipt; the same UUID later creates exactly one open child with zero votes and replays to the same ID. Thirty-two canceled template GETs leave bounded connections (and Linux descriptors); a subsequent valid GET works and no child has been published. Fault hooks are test-only, not environment switches in production.

The browser already provided actionable fixed EN/RU template failure and owner-session messages. Local browser checks exercise network failure/retry, forbidden and missing templates, repeated keyboard GET retries, malformed pending JSON and an existing unconfirmed creation. The pending payload/UUID remains authoritative, an invalid saved intent blocks publication, and no copy GET publishes. These are finite checks, not a heap profile or an automatic ownership recovery feature. Request failures now emit only the fixed `REQUEST_FAILED DATABASE` or `REQUEST_FAILED INTERNAL` diagnostic, without exception text/stack, paths, SQL or payload. The expiry-write failure test verifies that private trigger text is absent. Each entry is bounded; stdout retention/rotation must be configured by the service operator. No persistent per-request log or retry queue was added.

## Optional poll deadline — 21 November

The initial API rules below still apply. The form and visibility policy were added in the [22 November update](#deadline-form-and-hidden-results--22-november).

`POST /api/polls` accepts optional `expiresAt`: null/omitted means no deadline; otherwise a positive integer UTC Unix timestamp in milliseconds within JavaScript Date's range, strictly after server time and at most 365×24 hours ahead. Strings (including ISO dates), booleans, fractions and out-of-range values get HTTP 400 without inserting a poll or receipt. Example using the current browser session:

```js
const request = {
  title: 'When do we meet?', options: ['Friday', 'Saturday'],
  requestId: crypto.randomUUID(), expiresAt: Date.now() + 60 * 60 * 1000
};
// Retain this exact intent and the original session until its result is known.
const response = await fetch('/api/polls', {
  method: 'POST', headers: {'Content-Type': 'application/json'},
  body: JSON.stringify(request)
});
```

A new poll returns 201 `{id}`. An exact same-owner requestId replay returns 200 with the original ID, even after expiry, because receipt lookup precedes the future-time check. A changed deadline is changed payload: 409 `POLL_REQUEST_CONFLICT`. A foreign session remains 403 `OWNER_SESSION_REQUIRED`. Omitted/null deadlines retain the pre-upgrade request hash format, so existing receipts do not conflict after upgrade. Legacy clients without requestId retain no creation deduplication. Deadlines cannot be edited after creation; there is no update endpoint. Template copies export only title/options, never the source deadline.

`GET /api/poll` and successful vote/Close responses add `expiresAt` (number/null) and `serverNow` (UTC milliseconds). A poll is closed when its stored closed flag is set or serverNow ≥ expiresAt. A vote samples server time **inside its acquired SQLite write transaction**: strictly before expiry it can be stored; at/after it returns 409 `POLL_CLOSED` with no vote. This is the logical decision boundary, not physical click time, HTTP arrival time or an exact wall-clock COMMIT deadline. Manual owner Close remains final.

GET computes expiry without writing. A vote observing expiry commits closed=1 before returning the refusal; throwing inside that transaction would roll the close back. Explicit owner Close also persists the flag for an expired poll. Once stored, closure survives restart and moving the clock backward. **Before a mutating observation persists it, moving server wall time backward can make a previously expired read appear open again.** There is no monotonic-time or scheduler guarantee. Maintain an accurate host clock. A failed expiry UPDATE rolls back, returns generic 500 and does not claim a persisted closure. The caller must reread after an unknown response; vote POST is never automatically repeated.

Migration adds nullable `polls.expires_at` with an integer/range CHECK. Existing rows get null; votes, owner, closed flags and creation receipts are preserved. No timers, workers, extra receipt table, cleanup job or per-poll in-memory resource is added; one column is the bounded per-poll cost. `options.pollNow` is an internal deterministic test seam, not a deployment setting. Tests cover the exact boundary, replay after expiry/restart, changed input, failed expiry writes, manual closure, actual legacy-schema upgrade and storage constraints.

Before upgrading, stop the old process and back up the matching SQLite data and session-key. Do not run an older binary against the upgraded database: it ignores expiry, accepts votes after the deadline and hashes timed requests differently. A rollback requires stopping service and restoring a matched pre-upgrade database/key backup, with an explicit decision about writes made since that backup; simply swapping JavaScript files is unsafe. Backend deployment is separate from static GitHub Pages publishing. No power-loss, multi-process writer, lost-cookie or long-running resource guarantee is added.

Test-harness correction (21 November): an unresolved Promise did not itself keep the fault-injection child alive before its intentional kill. The checkpoint now explicitly references its IPC channel; stop asserts the child is still running before waiting for its exit. This addresses a lost-exit-event race in the crash fixture, without increasing timeouts or changing production key behavior.

## Deadline form and hidden results — 22 November

The creation form accepts an optional UTC calendar minute and shows the corresponding local time with its UTC offset. Entering UTC makes the instant explicit even when the local clock repeats an hour. A missing deadline stays null. The poll view displays a localized date and offset and includes the original instant in its time element. The page learns about expiry on load, Refresh, or a server response; it does not run a countdown or change the server's deadline.

Before posting, the form saves version 1 of the creation intent in sessionStorage: requestId, title, options and the exact UTC milliseconds (or null). Reopening the same tab preserves the original request, including an already-expired deadline. Retry is explicit, with the same browser session and UUID. A definite HTTP 400 unlocks the fields and keeps the visible draft. Unreadable storage, an invalid or unsupported saved version, or loss of the browser session cannot safely recover the intent automatically. A valid old intent without a deadline retains its original semantics. An owner template still contains only title and options.

`POST /api/polls` also accepts optional `hideResultsUntilClose`, a boolean, default false. The setting is immutable. GET and successful vote/Close return `resultsVisible`. While an opted-in poll is open, `resultsVisible:false` and `counts:null` apply to everyone, including the owner; only the caller's own choice is returned. No total or aggregate query is produced on that path. The response is no-store. At manual close or when the server clock reaches the deadline, the same result endpoint exposes the stored aggregates. It has the clock limitations described above: a read-only expiry is not a persisted close, and previously returned numbers cannot be revoked after wall-clock rollback. The UI handles hidden and revealed results; setting visibility in the creation form is a later task.

SQLite adds `hide_results_until_close` with default 0 and a 0/1 constraint. Both old request hash formats are preserved when visibility is default. The opt-in hash adds the true flag after the expiry slot, even with a null expiry; changing either field on a retry remains a conflict. Stop the old server and back up SQLite plus the matching session key before upgrading. Rolling back the application alone is unsafe: older code may show hidden results or ignore deadlines. Restore a matched pre-upgrade backup with an explicit decision about newer writes. GitHub Pages publication remains a static site update, not a backend deployment.


## Hidden-result selector and multiple-choice ballots — 23 November

The creation form now sends an optional immutable `hideResultsUntilClose:true` flag and optional `mode:'multiple'`. Both are opt-in. Default single-choice creation omits the new fields and retains the old fingerprint for historical receipts, including timed polls. The UI always shows an explicit text explanation of the visibility policy; the server never relies on CSS hiding. New version-2 pending intents pin UUID, deadline, hidden flag and mode before the HTTP request. Version-1 and legacy pending records migrate to the exact old default. Invalid future intent versions fail closed and require checking the original browser before making a new poll.

On first startup, the additive migration creates `polls.vote_mode TEXT NOT NULL DEFAULT 'single'` with a check constraint, plus `poll_multi_ballots(poll_id,voter,choices,created)` with a primary key on (poll_id,voter). No existing `votes` records are changed. Multi-choice ballot creation and the duplicate-vote check happen in one SQLite transaction. `choices` is a canonical ascending JSON array of one to six distinct in-range numeric option IDs. Wrong-mode payloads fail with HTTP 400; a second ballot gets HTTP 409. Mode and visibility are immutable after publication, and changing either on a replay with the same UUID gives 409 `POLL_REQUEST_CONFLICT`.

`GET /api/poll`, successful vote, and close return `mode:'multiple'` only for multi-choice polls; single-choice API shapes remain unchanged. Multi-choice returns an array `choice` for the current visitor (or null), and `ballotCount` for the number of participants when aggregates are visible. Per-option `counts` count selections, not participants. Their percentages can legitimately add up to over 100%; avoid reusing the single-choice pie-chart assumption. While a hidden poll is open, `counts:null` and `ballotCount:null` apply to owner/voter/guest, even after an individual vote. The individual voter may still see their own choices. At manual Close or deadline, real counts and ballot total become visible. Rate limits and browser-session voting protections have not become person-level identity verification.

**Deploy/restore:** stop the writer; take a consistent backup of the SQLite database, WAL state and matching session-key. Apply this server and generated frontend as a unit; verify POST/GET, both modes, hidden pre-close and visible post-close on a temporary test poll. Before deploying new frontend, ensure the backend supports `mode` and `hideResultsUntilClose`. Older servers can silently ignore new parameters or misinterpret votes and must not be used for new-mode polls. To revert, restore an intact matching pre-upgrade backup, explicitly acknowledging the loss or separate reconciliation of newer writes. A GitHub Pages success alone is **not** evidence of a deployed backend or domain validation. Tests run via CI but do not replace a real browser check at 320 px/zoom/system themes on the intended host.
