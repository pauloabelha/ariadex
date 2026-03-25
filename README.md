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
- renders a Dex panel with tabs:
  - `Context`
  - `Branches` (`⭐ From Your Network`, `🔥 Top Thinkers`)
  - `References`
  - `People`
  - `Log`
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
Install dependencies first:

```bash
npm install
```

1. Open `chrome://extensions`
2. Enable Developer mode
3. Load unpacked extension from `ariadex/extension`
4. Open `https://x.com`
5. Click `◇ Explore` on a tweet

## Run tests

Install dependencies first if this is a fresh checkout:

```bash
npm install
```

Then run the full suite:

```bash
npm test
```

Useful subsets:

```bash
npm run test:core
npm run test:dom
```

CI now enforces:
- `npm run test:core`
- `npm run test:dom`
- `npm test`
- `npm run benchmark:snapshot` smoke run

GitHub Actions runs those checks on pull requests and on pushes to `main` across Node `18`, `20`, and `22`.

## Optional Python tooling environment
Ariadex does not require Python for runtime or JS tests, but a local virtual environment is a good place for one-off research scripts, notebook work, data cleanup, and evaluation helpers.

Recommended setup:
- put the virtual environment at `ariadex/.venv/`
- keep it local-only and git-ignored
- keep Python tooling separate from Node runtime concerns

Create it:

```bash
cd /home/pauloabelha/ariadex
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip setuptools wheel
```

When to add Python dependencies:
- if a script is truly repo-supported, add a dedicated manifest such as `requirements-dev.txt` or move to a `pyproject.toml`
- if it is just your local research tooling, install into `.venv` without changing tracked dependency files yet

Current policy:
- `requirements.txt` is intentionally informational and not a source of truth for Ariadex runtime
- Node dependencies remain managed by `package.json` and `package-lock.json`

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

## Expensive full-graph capture
For offline research fixtures, you can run an intentionally expensive capture against the live X API:

```bash
npm run capture:full-graph -- --tweet 2035047540588945579
```

Behavior:
- reads `X_BEARER_TOKEN` / `X_API_BEARER_TOKEN` from `.env`
- writes final fixtures under `research/fixtures/full_graphs/`
- persists tweet/user entity cache under `.cache/capture_full_graph/entity_store.json`
- writes resumable progress checkpoints under `.cache/capture_full_graph/checkpoints/`
- reuses an existing final fixture by default unless `--force` is passed

Useful flags:
- `--output <path>`
- `--checkpoint-dir <dir>`
- `--entity-cache-file <path>`
- `--no-resume`
- `--force`

## Selector Experiments
Ariadex now has a selector registry for comparing multiple subgraph-selection algorithms against the same fixture and explored tweet.

Current selector ids:
- `path_anchored_v1`
- `expand_all_v0`
- `quota_per_parent_v0`
- `thread_context_v0`

Run one selector on a saved fixture:

```bash
npm run selector:run -- --fixture research/fixtures/full_graphs/2035047540588945579__root-2034285590921740363.json --tweet 2035047540588945579 --algo path_anchored_v1
```

Generate a side-by-side comparison report:

```bash
npm run selector:compare -- --fixture research/fixtures/full_graphs/2035047540588945579__root-2034285590921740363.json --tweet 2035047540588945579 --algo-a path_anchored_v1 --algo-b quota_per_parent_v0
```

That produces:
- a JSON comparison artifact under `research/runs/selector_comparisons/`
- a standalone HTML report under `research/runs/selector_comparisons/`

Live selection path:
- graph-cache server now accepts selector ids internally and defaults to `path_anchored_v1`
- override with `ARIADEX_SELECTOR_ID=<selector_id>` to test a different live selector in the server path

### Live local selector lab
To choose an algorithm interactively for a fixtured explored tweet, start the local selector lab:

```bash
npm run selector:lab
```

Then open:

```text
http://127.0.0.1:8791
```

The lab:
- reads the local fixture catalog database from `research/db/fixture_catalog.json`
- auto-syncs that catalog from `research/fixtures/full_graphs/`
- lets you pick a fixtured explored tweet
- lets you pick a selector algorithm and JSON params
- runs the selector locally against the saved fixture and renders the result live
- shows mandatory-path roles and relations, selected tweets, references, tweet references, and people summaries
- surfaces likes, follower counts, and selector scores directly on tweet cards

`thread_context_v0` is the current lowest-slop discussion-oriented selector:
- start with the existing path-anchored selection
- then complete a bounded amount of same-author reply-thread context around the kept anchors
- preserve structural explainability while reducing “isolated tweet fragment” output

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
