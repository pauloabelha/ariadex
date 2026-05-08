# AriadeX Architecture

AriadeX has one responsibility: turn a clicked tweet into a structured, readable artifact.

The codebase is split into four layers:

```text
X page
  |
content script
  |
background service worker
  |
algorithm module + X API
  |
local report backend
```

## Components

`extension/content.js`

- injects the `Explore Path` button into X tweet cards
- reads generated runtime settings
- opens and renders the floating panel
- sends resolve, report, gist, export, and cache-clear requests
- keeps panel state across rerenders

`extension/background.js`

- owns Chrome runtime message and port wiring
- loads generated config through `dev_env_loader.js`
- calls `algo.js` for artifact construction
- calls `report_generation.js` for report and gist requests
- streams progress back to the panel

`extension/algo.js`

- creates X API clients
- normalizes tweets, users, references, and handles
- resolves the root path
- builds reference and people artifacts
- collects anchored reply chains
- keeps the algorithm testable outside Chrome

`server/report_backend.js`

- exposes local HTTP endpoints
- loads prompts from `prompts/`
- keeps OpenAI credentials server-side
- sends the artifact to OpenAI chat completions
- returns generated report or gist metadata

## Runtime Flow

1. The content script detects tweet cards on X.
2. The user clicks `Explore Path`.
3. The content script opens a long-lived port to the service worker.
4. The service worker loads generated config and creates an X API client.
5. The algorithm resolves the root path and emits progress events.
6. The algorithm enriches the path with references, people, and reply chains.
7. The service worker returns the artifact.
8. The panel renders tabs for each artifact section.
9. Optional report and gist requests go through the local backend.

## Data Boundaries

Secrets have clear ownership:

- X bearer token lives in `.env`, generated config, browser local storage, or `chrome.storage.local`.
- OpenAI API key lives in `.env` or process environment for the local backend.
- The content script never calls OpenAI directly.
- Generated config is ignored and should not be committed.

The extension talks to:

- X API at `https://api.x.com/2` unless overridden
- local report backend at `http://127.0.0.1:8787` unless overridden

The backend talks to:

- OpenAI-compatible chat completions endpoint

## Artifact Contract

The resolved artifact is the main internal contract:

```js
{
  clickedTweetId,
  path,
  references,
  people,
  replyChains
}
```

`path` is ordered from root to explored tweet.

Each path tweet may contain:

- `id`
- `authorId`
- `authorUsername`
- `authorName`
- `text`
- `createdAt`
- `conversationId`
- `outboundRelation`
- `referenceNumbers`
- `peopleHandles`

`references` contains canonical external links cited by path tweets.

`people` contains canonical handles collected from authors and mentions.

`replyChains` contains anchored reply subtrees that begin as direct replies to a path tweet and contain at least one path author.

## Parent Rule

Parent selection is deterministic:

1. A quote target wins.
2. A reply target is used when there is no quote target.
3. No parent means the current tweet is the root.

This rule makes quote-of-reply chains stable: AriadeX follows the quoted tweet first, then continues through that quoted tweet's own ancestry.

## Cache Rule

The algorithm caches:

- tweet payloads by tweet id
- conversation memberships by `conversation_id`

Cache reads happen before network calls. Cache writes happen immediately after successful fetches. The panel exposes `Clear Cache` when the user wants a fresh X API view.

## Report Backend

The backend exposes:

- `POST /v1/report`
- `POST /v1/gist`

Both endpoints accept:

```json
{
  "artifact": {}
}
```

Both endpoints return:

```json
{
  "ok": true,
  "report": {
    "text": "...",
    "model": "gpt-4o-mini",
    "apiBaseUrl": "https://api.openai.com/v1",
    "provider": "openai"
  }
}
```

The only difference is prompt selection:

- `/v1/report` uses `prompts/generate_report.md`
- `/v1/gist` uses `prompts/generate_gist.md`

## Testing Strategy

Tests run with Node's built-in test runner:

```bash
npm test
```

The suite avoids browser automation by testing pure helpers and Chrome-shell adapters with small mock objects. That keeps the highest-risk behavior covered without making local iteration heavy.
