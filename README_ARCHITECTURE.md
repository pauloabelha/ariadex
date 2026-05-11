# Architecture

AriadeX is a browser-first local tool. The extension owns the product experience; the local backend exists only for report/gist generation.

```text
X page
  -> content script
  -> background service worker
  -> algorithm module
  -> X API / OpenAI / local report backend
```

## Design Rules

- Keep the product runtime in JavaScript.
- Keep source evidence visible and exportable.
- Keep generated prose downstream of structured artifacts.
- Cache every expensive or rate-limited stage.
- Surface long-running work through progress messages.
- Keep Top Takes objective; do not use viewer follow status as a ranking signal.

## Runtime Components

`extension/content.js`

- Injects `Explore Path` and `Top Takes` actions into X tweet cards.
- Reads page/runtime settings.
- Opens and renders the floating panel.
- Formats progress and error messages.
- Sends resolve, report, gist, export, and cache-clear requests.
- Falls back to a normal runtime message when a long Top Takes progress port disconnects.

`extension/background.js`

- Owns Chrome runtime message and port handlers.
- Loads generated config through `dev_env_loader.js`.
- Creates X clients and storage adapters.
- Calls `algo.js` for Explore Path and Top Takes artifacts.
- Calls `report_generation.js` for report/gist requests.
- Calls OpenAI for Top Takes classification from the service worker.

`extension/algo.js`

- Normalizes X API tweet/user payloads.
- Resolves root paths.
- Builds references, people, and reply-chain artifacts.
- Collects, filters, scores, and selects Top Takes quote tweets.
- Implements cache-aware and rate-limit-aware helpers.
- Stays testable without Chrome.

`server/report_backend.js`

- Exposes `POST /v1/report` and `POST /v1/gist`.
- Loads prompts from `prompts/`.
- Calls OpenAI-compatible chat completions.
- Keeps report/gist generation outside the content script.

`scripts/run_top_takes.js`

- Runs Top Takes locally through the same background/controller path.
- Reads `.env`.
- Stores local runner cache and output under `data/`.

## Workflow Boundaries

Explore Path:

1. Content script extracts the clicked tweet id.
2. Background creates an X client and storage adapter.
3. Algorithm follows quote/reply parent edges back to the root.
4. Algorithm enriches the path with references, people, and reply chains.
5. Panel renders tabs over the artifact.

Top Takes:

1. Content script extracts the source tweet id.
2. Background creates X/OpenAI clients and storage adapters.
3. Algorithm collects quote tweets and optional direct-reply context.
4. OpenAI classifies candidate quote tweets.
5. Algorithm computes inspectable score fields and selects a ranked list.
6. Panel renders the Top Takes artifact.

Report/Gist:

1. User requests generated prose from the panel.
2. Extension sends the current artifact to the local backend.
3. Backend calls OpenAI with the report or gist prompt.
4. Panel renders the generated text as an optional artifact layer.

## Data And Secret Boundaries

- X bearer token lives in `.env`, generated config, browser local storage, or `chrome.storage.local`.
- OpenAI settings can live in `.env`, generated config, or extension storage depending on workflow.
- The content script does not directly call OpenAI.
- `extension/dev_env.generated.json` and `.env` are local-only and must not be committed.

Network targets:

- X API: `https://api.x.com/2` unless overridden.
- OpenAI-compatible API: `https://api.openai.com/v1` unless overridden.
- Local report backend: `http://127.0.0.1:8787` unless overridden.

## Artifact Contracts

Explore Path artifact:

```js
{
  clickedTweetId,
  path,
  references,
  people,
  replyChains
}
```

Top Takes artifact:

```js
{
  sourceTweet,
  sourceDomain,
  sourceDomainConfidence,
  takes,
  representativeTakes,
  people,
  stats,
  modelMetadata,
  openAiTiming,
  cacheKey
}
```

See [docs/top_takes.md](docs/top_takes.md) for the canonical collect/rank contract.

## Storage

Extension storage is used for:

- tweet payload cache
- conversation membership cache
- quote tweet collection cache
- Top Takes analysis cache
- Top Takes artifact cache
- local settings and generated config hydration

The panel exposes `Clear Cache` for stale X API state.

## Testing

Tests use Node's built-in test runner:

```bash
npm test
```

Browser behavior is covered through small Chrome-like mocks. Pure algorithm behavior stays in `extension/algo.js` so it can be tested without launching Chrome.
