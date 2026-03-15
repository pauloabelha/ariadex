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
  - `Thinkers` (`⭐ From Your Network`, `🔥 Top Thinkers`)
  - `Evidence`
  - `People`
  - `Context`
  - `Digest` (generate article + download PDF)

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
Panel details: `docs/panel_dex.md`.
Digest details: `docs/article_digest.md`.

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
- server now attempts viewer-handle-based following resolution when `followingSet` is empty.
- if X API credentials do not permit `/users/:id/following`, resolution fails safely and you should provide `X_FOLLOWING_IDS`.
- optional limits: `ARIADEX_VIEWER_FOLLOWING_MAX_PAGES`, `ARIADEX_VIEWER_FOLLOWING_MAX_IDS`, `ARIADEX_VIEWER_HANDLE_LOOKUP_MAX`.

Security default:
- `allowClientDirectApi=false` (default)
- extension uses `graphApiUrl` only
- X/OpenAI keys stay server-side
- Graph API calls are proxied by `extension/background.js` (service worker), not page JS fetch

## OpenAI article digest (server-side)
Ariadex can generate a structured article digest from the cached conversation snapshot and render it to a downloadable PDF.

Behavior:
- runs on graph-cache server only
- uses ranked human tweets + canonical non-X references as synthesis input
- falls back to a deterministic local digest if OpenAI is unavailable or fails
- caches both article JSON and PDF artifacts separately from the base snapshot

Environment flags:
- `OPENAI_API_KEY` (required to enable model-backed article generation)
- `ARIADEX_OPENAI_ARTICLE_MODEL` (default: `ARIADEX_OPENAI_MODEL`, else `gpt-4o-mini`)
- `ARIADEX_OPENAI_ARTICLE_TIMEOUT_MS` (default: `30000`)

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

## Benchmark (snapshot pipeline)
Run deterministic cold-vs-warm benchmark without hitting live X API:

```bash
npm run benchmark:snapshot
```

Optional parameters:

```bash
node scripts/benchmark_snapshot_pipeline.js --replyCount=200 --quoteCount=40 --quoteReplyCount=3 --latencyMs=25
```

Output includes:
- cold/warm duration
- per-endpoint request counts (`tweet_lookup`, `search_recent_conversation`, `quote_tweets`, etc.)
- total request reduction and duration ratio

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
Cache keys include pipeline version, mode, canonical root, and following-set signature.

Cache layers now work like this:
- entity cache: tweet and user hydrations are memoized by id, so repeated `/2/tweets/:id`, `/2/tweets`, and `/2/users` lookups avoid redundant X fetches
- snapshot cache: collected conversation datasets are reused per canonical root/mode/following signature
- article cache: generated article JSON and PDF are cached separately on top of the snapshot

Article generation reuses the cached snapshot by default and does not trigger an incremental refresh unless explicitly requested.

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
- The same bridge is used for `/v1/conversation-article`.

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

OpenAI status is logged at startup (`openAiEnabled`) for article generation, and snapshot completion logs include ranking diagnostics for the full collected graph.
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

Article API:
- `POST /v1/conversation-article` builds or loads an article digest + PDF for one snapshot
- `Digest` tab lets the user generate the article on demand and download the cached PDF

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
