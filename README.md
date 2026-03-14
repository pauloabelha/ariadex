# Ariadex

Ariadex explores conversations on X by turning connected tweets into a typed graph and ranking influential posts with ThinkerRank.

## What Ariadex does
- injects `◇ Explore` into X tweet action bars
- resolves canonical root tweets
- retrieves replies/quotes/reposts via official X API
- builds a conversation graph
- runs ThinkerRank
- renders a two-tier panel:
  - `⭐ From Your Network`
  - `🔥 Top Thinkers`

## Architecture
Ariadex is split into explicit layers:

```text
UI
↓
Data Retrieval
↓
Ariadex Conversation Engine (core)
↓
Graph + ThinkerRank
```

Repository structure:

```text
ariadex/
  core/
  data/
  ui/
  extension/
  tests/
  docs/
```

See `docs/architecture.md` for full contracts and flows.

## X API credentials (`.env`)
Ariadex reads your keys from `~/ariadex/.env` through the sync script.

1. Set `X_BEARER_TOKEN` (or `X_API_BEARER_TOKEN`) in `.env`.
2. Optional: set `X_FOLLOWING_IDS=123,456,...`.
3. Generate runtime config:

```bash
node scripts/sync_env_to_generated_config.js
```

This writes `extension/dev_env.generated.json` (git-ignored). `extension/dev_env_loader.js` loads endpoint/environment settings into runtime/localStorage.

Security default:
- `allowClientDirectApi=false` (default)
- extension uses `graphApiUrl` only
- X/OpenAI keys stay server-side

## Run extension
1. Open `chrome://extensions`
2. Enable Developer mode
3. Load unpacked extension from `ariadex/extension`
4. Open `https://x.com`
5. Click `◇ Explore` on a tweet

## Run tests

```bash
node --test tests/*.js
```

## Persistent graph cache (recommended)
To avoid repeated X API costs, run the local graph cache server and point the extension to it.

1. One-command local dev (recommended):

```bash
npm run dev:cache
```

This command:
- reads `.env`
- writes `extension/dev_env.generated.json` with `graphApiUrl=http://127.0.0.1:8787` (or your configured port)
- starts the persistent graph cache server

2. Manual start (alternative):

```bash
X_BEARER_TOKEN=... npm run start:graph-cache
```

3. Optional cache settings:
- `ARIADEX_GRAPH_CACHE_FILE` (default in `dev:cache`: `.cache/graph_cache_store.json`)
- `ARIADEX_GRAPH_CACHE_MAX_ENTRIES` (default: `5000`)
- `ARIADEX_GRAPH_CACHE_PORT` (default: `8787`)
- `ARIADEX_LOG_LEVEL` (default: `info`, options: `debug|info|warn|error|silent`)

4. Set extension runtime config `graphApiUrl` to `http://127.0.0.1:8787` (via `dev_env.generated.json` or localStorage).

With this enabled, snapshots are cached on disk and reused across server restarts.

### Environment-based endpoint config (dev/prod)
Use environment-aware endpoint mapping so extension always targets a pre-specified server.

Supported `.env` keys:
- `ARIADEX_ENV=dev|prod`
- `ARIADEX_GRAPH_API_URL_DEV=http://127.0.0.1:8787`
- `ARIADEX_GRAPH_API_URL_PROD=https://YOUR_PROD_GRAPH_API_HOST`
- optional override: `ARIADEX_GRAPH_API_URL=...` (highest priority)
- optional unsafe override (not recommended): `ARIADEX_ALLOW_CLIENT_DIRECT_API=true`

Generated runtime config now includes:
- `environment`
- `graphApiByEnv`
- `graphApiUrl` (resolved for active environment)

Switch environment and regenerate extension config:

```bash
npm run env:dev
npm run env:prod
```

Or set explicit URLs during switch:

```bash
node scripts/set_runtime_env.js --env=prod --graphApiUrlProd=https://YOUR_PROD_GRAPH_API_HOST
```

After changing environment:
1. Reload extension in `chrome://extensions`
2. Refresh x.com tab

### Verify extension is using cache server
1. Run `npm run dev:cache`.
2. Reload extension in `chrome://extensions`.
3. Refresh x.com.
4. In page DevTools console, check:

```js
window.AriadexXApiSettings?.graphApiUrl
```

Expected:

```js
"http://127.0.0.1:8787"
```

### Server logging
Cache server logs are structured JSON lines with request IDs and durations.

Typical events:
- `server_started`
- `http_request_started`
- `snapshot_cache_hit` / `snapshot_cache_populated`
- `http_request_completed`
- `http_request_failed`

For verbose diagnostics:

```bash
ARIADEX_LOG_LEVEL=debug npm run dev:cache
```

## Use core engine standalone (Node/server)

```js
const { runConversationEngine } = require("./core/conversation_engine.js");

const result = runConversationEngine({
  tweets: normalizedTweets,
  rankOptions: { followingSet: new Set(["12345"]) }
});

console.log(result.ranking.slice(0, 10));
```

## Key docs
- `docs/architecture.md`
- `docs/graph_architecture.md`
- `docs/conversation_collection.md`
- `docs/conversation_rank.md`
- `docs/ui_panel.md`
- `docs/testing.md`
