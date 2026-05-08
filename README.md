# AriadeX

AriadeX is a Chrome extension for making sense of a tweet by reconstructing the path that brought it into view.

Click `Explore Path` on X and AriadeX builds a compact artifact around that tweet:

- the structural root-to-tweet path
- the references cited along that path
- the people who authored or were mentioned on that path
- the reply subtrees where path authors re-enter the conversation
- an optional generated report and portable gist through a local backend

The product is intentionally narrow. It does not try to rank the whole conversation, summarize every branch, or replace the X interface. It gives you a clean thread through one messy public exchange.

## What It Does

AriadeX starts from the clicked tweet and walks backward through explicit X API relationships:

1. Prefer the quoted tweet as the parent.
2. Otherwise use the replied-to tweet as the parent.
3. Stop when no parent exists or a cycle is detected.

After the root path is resolved, AriadeX enriches it:

- References are canonicalized, deduped, and numbered.
- People are deduped by canonical X handle.
- Replies are collected from X API conversation search and grouped into anchored subtrees.
- Reports and gists are generated only when requested, using the current artifact.

## Repository Layout

```text
ariadex/
  extension/
    algo.js                  root-path, references, people, reply-chain logic
    background.js            Chrome service worker and progress streams
    content.js               button injection and panel UI
    report_generation.js     report/gist backend client
    dev_env_loader.js        generated config loader
    styles.css               panel styling
    manifest.json            Chrome extension manifest
  server/
    report_backend.js        local OpenAI-backed report and gist API
  scripts/
    sync_env_to_generated_config.js
    start_report_backend.js
  prompts/
    generate_report.md
    generate_gist.md
  tests/
    *.test.js
  docs/
    overview.md
    algorithm.md
    references.md
    ux.md
```

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

Generate the extension runtime config:

```bash
npm run sync:env
```

Start the local report backend:

```bash
npm run report:backend
```

Load the extension:

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click `Load unpacked`.
4. Select `/home/pauloabelha/ariadex/extension`.
5. Open a tweet thread on `https://x.com`.
6. Click `Explore Path`.

## Using AriadeX

The floating panel opens with the resolved artifact.

- `Root Path` shows the root, ancestors, and explored tweet.
- `References` lists the canonical external URLs found on the path.
- `People` lists authors and mentioned users found on the path.
- `Replies` shows anchored reply chains where a path author participates.
- `Gist` appears after `Generate Gist`.
- `Report` appears after `Generate Report`.

The panel can export the current artifact as JSON. Reports and gists can be copied or downloaded as Markdown.

## Configuration

The extension reads `extension/dev_env.generated.json`, which is generated from `.env` by `npm run sync:env`.

Supported `.env` values:

- `X_BEARER_TOKEN` or `X_API_BEARER_TOKEN`
- `ARIADEX_X_API_BASE_URL` or `X_API_BASE_URL`
- `REPORT_BACKEND_BASE_URL`
- `OPENAI_API_KEY` or `ARIADEX_OPENAI_API_KEY`
- `OPENAI_MODEL`, `REPORT_MODEL_NAME`, `ARIADEX_OPENAI_ARTICLE_MODEL`, or `ARIADEX_OPENAI_MODEL`
- `OPENAI_BASE_URL` or `ARIADEX_OPENAI_BASE_URL`

Defaults:

- X API base URL: `https://api.x.com/2`
- Report backend: `http://127.0.0.1:8787`
- OpenAI API base URL: `https://api.openai.com/v1`
- OpenAI model: `gpt-4o-mini`

Do not commit `extension/dev_env.generated.json`. It may contain secrets.

## Commands

```bash
npm test
npm run sync:env
npm run report:backend
```

## Development Notes

The core algorithm is written so it can run under Node tests without a Chrome runtime. The Chrome-specific work stays in `background.js` and `content.js`.

Run the full suite:

```bash
npm test
```

Current coverage focuses on:

- parent selection and root-path resolution
- cache behavior
- reference canonicalization
- people aggregation
- reply-chain construction and trimming
- panel rendering helpers
- report backend request shape
- environment config sync

## Documentation

- [Architecture](README_ARCHITECTURE.md)
- [Overview](docs/overview.md)
- [Algorithm](docs/algorithm.md)
- [Reference Handling](docs/references.md)
- [UX Notes](docs/ux.md)
- [Promotion Goal](goal)

## Project Status

AriadeX is a focused local prototype. The current version is the single root version of the repository. Older root experiments were removed from the active tree and remain available through git history.
