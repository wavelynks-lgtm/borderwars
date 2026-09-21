# Online play and deployment

The website stays on the existing Vercel project. A separate Node server runs each match at 10 ticks per second and accepts authenticated orders. PostgreSQL stores accounts, sessions and match results. Nothing requires a paid library or subscription, but free hosting has usage limits.

## Run locally

Use Node 22.14 or later. Run `npm ci`, `npm run server`, and `npm run dev` in separate terminals. Open **Play Online** in two independent browsers, create accounts, create/join a room, mark both players Ready, then start as host. The default allowed browser origins use ports 4174 and 5175; set `ALLOWED_ORIGINS` to your exact local origin if Vite chooses another port. SQLite persists local accounts and results in `.local/multiplayer.sqlite`; this directory must not be published or committed.

Players begin at zero troops/workers. All online players receive a random starting territory; the countdown starts after every browser finishes loading. Matches have up to eight human players plus six nations and four tribes. Public matches lasting at least five minutes contribute to the wins leaderboard; private matches and interrupted matches do not. Match history includes completed unranked games. Accounts use case-insensitive unique names, salted scrypt password hashes and revocable 30-day sessions; passwords and tokens are never stored as plaintext on the server. The browser stores its bearer session token locally. There is currently no email recovery: keep your password.

## Deploy on free tiers

1. Keep the Vercel frontend project. Put this source in a private Git repository for the server deployment; exclude `.local`, `.env`, `node_modules`, and `.vercel`.
2. Create a free PostgreSQL project on Supabase or Neon. Obtain a TLS-enabled connection string. On Supabase use the session pooler for a persistent Node server. Keep this string only in the server's environment settings.
3. Create a free Render Node web service from the repository, using `render.yaml` or build `npm ci`, start `npm run server`, health path `/health`, Node 22.14+. Set `DATABASE_URL` and `ALLOWED_ORIGINS` to the exact Vercel origin (no trailing slash). Set `NODE_ENV=production`. The server creates its tables automatically and refuses to start in production without PostgreSQL.
4. In Vercel set the public build variable `VITE_MULTIPLAYER_URL` to the Render HTTPS URL, then deploy the frontend. Never put `DATABASE_URL` in a `VITE_` variable. Add each intentional custom frontend domain to the server's comma-separated origin allowlist.
5. Open `/health`, create two accounts from separate browsers, join a room, finish a match, then check the leaderboard and history. Run `npm test`, `npm run typecheck:server`, and `npm run build` before deploying future changes.

Random matches use the bundled, version-hashed Earth raster. Custom hosts can submit a validated World Forge recipe (never executable code or arbitrary map bytes); a server worker generates the map and all players download identical hashed bytes, including palette metadata. Custom worlds are capped at 2048px. The online map is 2048×1024 to fit a small free instance; the 5792×2896 single-player map is unchanged. Regenerate the online asset from a running development site with `npm run map:online` after geography changes. Its compressed asset is about 0.7 MB. Higher resolution and more concurrent rooms require explicit memory/load testing before increasing capacity.

## Match authority and reconnects

The server owns troop/gold balances, command validation, timing, unit ownership, diplomacy, missile queues and victory. Browsers replay accepted orders and ticks for rendering, with checksums to detect divergence. Pause, speed changes and developer cheats cannot change an online server. Client identities come from the authenticated connection; players cannot submit results or choose another player ID. Completed results are inserted transactionally with a unique match ID, so retries cannot award duplicate wins.

A dropped connection retries automatically and retrieves missed ticks. Reloading and opening Play Online reconstructs the active match from the same map and accepted command history. The same account can have only one active connection. A player retains their seat and territory when disconnected; the match continues. Choosing **Surrender & leave** explicitly forfeits that seat and allows returning to the lobby. Reconnecting after a long absence can require catching up. A divergence stops local play and asks for a reload instead of continuing with incorrect state.

Free-tier limits: default one concurrent room per server, at most eight human players, 30-minute matches, two-minute world-loading timeout, and empty rooms removed after two minutes. There is no distributed matchmaking or horizontal server scaling in this version. Active matches live in server memory: server restarts or deployments cancel unfinished games without ranking them. Completed results persist in PostgreSQL. Hosts should deploy between matches. Account recovery, spectator-only joining and chat moderation are not implemented; communication uses preset emojis. Wins rankings are server-derived but do not prevent collusion between multiple accounts.

Render free services can sleep when idle and restart; the first connection may take time. Render's free PostgreSQL expires after 30 days, so use an external free database rather than that offering. Supabase free projects may pause after inactivity. Vercel currently offers WebSockets in beta, but connections have a maximum duration and multi-instance rooms need external coordination; this implementation uses a persistent Node service to avoid that coupling. Free tiers are suitable for a small launch/test community, not a promise of unlimited always-on capacity.

Official references: [Vercel WebSockets](https://vercel.com/docs/functions/websockets), [Render free services](https://render.com/docs/free), [Supabase pricing](https://supabase.com/pricing), [Supabase inactivity pausing](https://supabase.com/docs/guides/platform/free-project-pausing), [Neon free plan](https://neon.com/blog/how-to-make-the-most-of-neons-free-plan).
# Connected Neon database

The workspace is linked to Neon project `rough-mouse-89260389`, branch `production`. `neon.ts` declares Postgres only. The CLI stores credentials in ignored `.env.local`; never copy database credentials into a `VITE_` variable.

`npm run server` loads `.env.local` if present; hosting environment variables take precedence. Neon URLs use the official WebSocket pool, preserving SQL transactions while avoiding networks that block port 5432. Other Postgres hosts retain the existing `pg` driver.

Run `npm run db:init` to initialize the existing application schema and verify connectivity. Registration, login, session lookup, cosmetic persistence and transaction checks passed against Neon on 2026-09-21; the temporary verification account was removed. Existing local SQLite accounts are not migrated automatically.

Neon configuration deployment does not deploy the match server or the Vercel frontend. The public match server still needs `DATABASE_URL` and its allowed frontend origin configured; Vercel needs `VITE_MULTIPLAYER_URL` pointing at that server.

## Matchmaking and custom lobbies

The menu polls `/api/matchmaking` every five seconds for actual connected random-queue players and public custom lobbies. Private lobbies are not listed or counted. Random Match and Quick Play join an available random lobby or create one with a server-selected rules preset. Two players trigger a 60-second countdown; falling below two resets it. Custom Match opens its own browser with saved-world selection, AI counts, match length, gold income and nukes. Custom hosts start a five-second countdown after everyone is ready. Any player unreadying or leaving cancels that countdown. Host ownership transfers to the next player when a waiting host leaves. Game ticks still wait for all clients to finish loading.

`MAX_ROOMS` controls concurrent rooms (default 4; the small Render template retains 1 until capacity is measured). Random matches qualify for rankings after five minutes; custom rules and private matches never do. Test with `node --env-file=.env.local --import ./scripts/register-tests.mjs scripts/multiplayer/matchmaking-check.mjs`; it checks two independent browsers, real live counts, countdown reset, custom-map transfer and deterministic play, then deletes its temporary accounts.

## Managed Neon sign-in

Neon Auth is enabled on production. The official SDK uses `/api/auth` on the website, proxied to Neon by `vercel.json`, so sessions use the site's own cookie context. The Vite development and preview proxy uses `NEON_AUTH_BASE_URL`. The main menu restores the session and displays the commander name. Authentication remains available when the multiplayer host is offline or not configured. Backend outages do not delete saved sessions.

Vercel: `VITE_NEON_AUTH_URL=/api/auth` (also the default), and `VITE_MULTIPLAYER_URL` must be the actual public HTTPS match-server address. Rebuild after changing Vite variables. Do not put database passwords or connection strings in `VITE_` variables.

Match-server environment: `DATABASE_URL`, `NEON_AUTH_BASE_URL`, `NEON_AUTH_JWKS_URL`, and `ALLOWED_ORIGINS=https://borderwars.vercel.app`. Neon-issued JWTs are verified for signature, issuer, audience, expiry and authenticated role before mapping their subject to an application account. Existing legacy account tokens remain supported; there is no automatic name/email merge or transfer of legacy purchases/history to new Neon identities.

Verification: real anonymous Neon session endpoint returned HTTP 200; signed-in restoration and sign-out were browser-tested against controlled SDK responses. Real email delivery and end-to-end sign-in with a person's mailbox require user verification. JWT rejection tests cover bad issuer/audience, expiration, banned/anonymous users and identity separation.
