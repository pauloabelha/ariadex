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

This writes `extension/dev_env.generated.json` (git-ignored). `extension/dev_env_loader.js` loads it into runtime/localStorage for the content script.

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
