# Ariadex

Ariadex explores conversations on X by turning connected tweets into a typed graph and ranking influential posts with ThinkerRank.

## What Ariadex does
- injects `◇ Explore` into X tweet action bars
- resolves canonical root tweets
- retrieves conversation data via official X API in two passes:
  - core topicsphere (replies/quotes/quote-replies)
  - bounded followed-author discovery
  - per-root replies/quotes are fetched concurrently, then merged deterministically
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

Note:
- `From Your Network` relies on `followingSet` (`X_FOLLOWING_IDS` or runtime hints).
- App-only bearer-token mode cannot pull your full following graph directly from X API.

Security default:
- `allowClientDirectApi=false` (default)
- extension uses `graphApiUrl` only
- X/OpenAI keys stay server-side
- Graph API calls are proxied by `extension/background.js` (service worker), not page JS fetch

## OpenAI contribution filter (server-side)
Ariadex now supports an OpenAI-based classifier to remove low-value tweets (shitpost/vaguepost/comedy-only/unrelated) before ranking.

Behavior:
- runs on graph-cache server only (never in content script)
- classifies tweet contribution in batches
- keeps canonical root tweet even if classifier is uncertain
- stores classification inside cached dataset to avoid repeat cost on cache hits

Environment flags:
- `OPENAI_API_KEY` (required to enable)
- `ARIADEX_ENABLE_OPENAI_CONTRIBUTION_FILTER=true|false` (default `true`)
- `ARIADEX_OPENAI_MODEL` (default `gpt-4o-mini`)
- `ARIADEX_CONTRIBUTION_SCORE_THRESHOLD` (default `0.65`)
- `ARIADEX_ENABLE_HEURISTIC_CONTRIBUTION_FILTER=true|false` (default `true`)
- `ARIADEX_OPENAI_DEDUPE_BY_TEXT=true|false` (default `true`)
- `ARIADEX_OPENAI_MAX_CONCURRENT_BATCHES` (default `2`)
- `ARIADEX_OPENAI_INCLUDE_REASON=true|false` (default `false`; lower cost when false)
- `ARIADEX_OPENAI_MAX_TWEETS_PER_SNAPSHOT` (default `120`)
- `ARIADEX_OPENAI_BATCH_SIZE` (default `30`)
- `ARIADEX_OPENAI_TIMEOUT_MS` (default `20000`)

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
Cache keys include contribution-filter settings (model/threshold/heuristics), so stricter filter config automatically rebuilds stale snapshots.

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

Important:
- Direct `fetch("http://127.0.0.1:8787/...")` from the x.com page console may fail due CSP/PNA.
- Ariadex uses extension background fetch (`chrome.runtime.sendMessage` -> `background.js`) for `/v1/conversation-snapshot`, which is the supported path.

### Server logging
Cache server logs are structured JSON lines with request IDs and durations.

Typical events:
- `server_started`
- `http_request_started`
- `x_api_request_started` / `x_api_request_completed` / `x_api_request_failed`
- `openai_classification_batch_completed` / `openai_classification_batch_failed`
- `snapshot_phase` (collection/rate-limit/root expansion phases)
- `snapshot_warning` (API/rate-limit/data warnings)
- `snapshot_cache_hit` / `snapshot_cache_populated`
- `http_request_completed`
- `http_request_failed`

Ranking diagnostics are logged on snapshot completion:
- `rankingCount`
- `nonZeroScoreCount`
- `topRankingPreview`
- `emptyRankingReason`

OpenAI status is logged at startup (`openAiEnabled`), and filter activity is logged per snapshot (`snapshot_contribution_filter_applied`).

Filter diagnostics now include:
- `threshold`
- `heuristicRejectedCount`
- `dedupedCount`
- `maxConcurrentBatches`
- `candidateCount`, `classifiedCount`
- `totalPromptTokens`, `totalCompletionTokens`, `totalTokens`

For verbose diagnostics:

```bash
ARIADEX_LOG_LEVEL=debug npm run dev:cache
```

For ANSI-colored log lines in terminal:

```bash
ARIADEX_LOG_COLOR=true ARIADEX_LOG_LEVEL=debug npm run dev:cache
```

Color mapping:
- `x_api_*` events: blue
- `openai_*` events: magenta
- `snapshot_*` events: green
- `http_request_*` events: cyan

Async progress API (used by extension panel):
- `POST /v1/conversation-snapshot/jobs` starts a snapshot job
- `GET /v1/conversation-snapshot/jobs/:jobId` returns running/completed/failed status + progress events
- panel now shows server-driven progress messages while loading, with sections hidden until final ranked data arrives

Incremental update mode:
- requests include `incremental=true` by default
- on cache hit, server fetches recent replies/quotes roots, computes diff (`newTweetCount`), merges new tweets into cached dataset, and re-ranks
- if no diff is found, cached snapshot is returned directly
- set `incremental=false` in API payload to skip diff refresh

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
