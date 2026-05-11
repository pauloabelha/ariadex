# AriadeX

AriadeX is a local Chrome extension for turning one tweet into inspectable context.

It has two main workflows:

- `Explore Path`: reconstructs the structural path that brought a tweet into view.
- `Top Takes`: ranks objective quote-discourse around a source tweet.

AriadeX is not a replacement X client, a whole-conversation crawler, or a personalized feed. It keeps evidence visible, makes generated prose optional, and favors cached/resumable work over fragile one-shot flows.

## Quick Start

Install dependencies:

```bash
cd /home/pauloabelha/ariadex
npm install
```

Create `.env`:

```bash
X_BEARER_TOKEN=your_x_api_bearer_token
OPENAI_API_KEY=your_openai_api_key
REPORT_BACKEND_BASE_URL=http://127.0.0.1:8787
```

Generate browser runtime config:

```bash
npm run sync:env
```

Start the optional report/gist backend:

```bash
npm run report:backend
```

Load the extension:

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click `Load unpacked`.
4. Select `/home/pauloabelha/ariadex/extension`.
5. Open `https://x.com`.
6. Click `Explore Path` or `Top Takes` on a tweet card.

## Commands

```bash
npm test
npm run sync:env
npm run report:backend
node scripts/run_top_takes.js https://x.com/handle/status/123
```

## Configuration

The extension reads `extension/dev_env.generated.json`, generated from `.env`.

Supported values:

- `X_BEARER_TOKEN` or `X_API_BEARER_TOKEN`
- `ARIADEX_X_API_BASE_URL` or `X_API_BASE_URL`
- `REPORT_BACKEND_BASE_URL`
- `OPENAI_API_KEY` or `ARIADEX_OPENAI_API_KEY`
- `OPENAI_MODEL`, `REPORT_MODEL_NAME`, `ARIADEX_OPENAI_ARTICLE_MODEL`, or `ARIADEX_OPENAI_MODEL`
- `OPENAI_BASE_URL` or `ARIADEX_OPENAI_BASE_URL`

Top Takes runner knobs:

- `TOP_TAKES_MAX_QUOTE_TWEETS`
- `TOP_TAKES_MAX_QUOTE_PAGES`
- `TOP_TAKES_MAX_RATE_LIMIT_RETRIES`
- `TOP_TAKES_RATE_LIMIT_RETRY_DELAY_MS`
- `TOP_TAKES_RATE_LIMIT_MAX_WAIT_MS`

Defaults:

- X API base URL: `https://api.x.com/2`
- report backend: `http://127.0.0.1:8787`
- OpenAI API base URL: `https://api.openai.com/v1`
- OpenAI model: `gpt-4o-mini`

Do not commit `.env` or `extension/dev_env.generated.json`.

## Repository

```text
ariadex/
  extension/        Chrome extension runtime
  server/           local report/gist backend
  scripts/          local developer runners
  prompts/          report and gist prompts
  tests/            Node test suite
  docs/             product and implementation docs
```

Key files:

- `extension/content.js`: button injection, panel UI, progress messages, reconnect behavior.
- `extension/background.js`: Chrome runtime orchestration, config loading, X/OpenAI calls.
- `extension/algo.js`: pure algorithms for path resolution, Top Takes, scoring, caching helpers.
- `server/report_backend.js`: local backend for report and gist generation.
- `scripts/run_top_takes.js`: local Top Takes runner using the same background/controller path.

## Documentation

Read in this order:

1. [Overview](docs/overview.md)
2. [Top Takes](docs/top_takes.md)
3. [Architecture](README_ARCHITECTURE.md)
4. [Algorithm](docs/algorithm.md)
5. [UX](docs/ux.md)
6. [References](docs/references.md)
7. [Goal](goal)

The canonical Top Takes collect/rank spec is [docs/top_takes.md](docs/top_takes.md).

## Testing

Run:

```bash
npm test
```

The test suite uses Node's built-in test runner and mock Chrome adapters. It covers root-path resolution, references, people, reply chains, Top Takes collection/ranking/cache behavior, rate-limit retry, OpenAI timing estimates, reconnect behavior, and panel rendering helpers.

## Status

AriadeX is a focused local prototype. It is designed for developer use from this repository, not packaged distribution.
