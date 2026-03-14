# Ariadex Layered Architecture

## Goal
Ariadex now uses a layered design so the conversation logic is reusable outside Chrome.

- `core/` contains the platform-independent Ariadex Conversation Engine.
- `data/` retrieves and normalizes tweet data.
- `ui/` renders ranked output.
- `extension/` wires X page events to the three layers.

This refactor is structural only. Behavior is preserved.

## Repository Layout

```text
ariadex/
  core/
    conversation_graph.js
    conversation_adjacency.js
    conversation_rank.js
    thread_collapse.js
    reply_inference.js
    root_resolution.js
    conversation_engine.js
  data/
    dom_collector.js
    x_api_client.js
  ui/
    panel_renderer.js
    tweet_highlight.js
  extension/
    manifest.json
    content.js
    styles.css
    ...compatibility wrappers used by extension runtime/tests
  tests/
  docs/
```

## Layer Responsibilities

### Core Engine (`core/`)
Responsibilities:
- graph construction
- typed edge generation
- adjacency index construction
- thread collapsing
- ThinkerRank propagation

Constraints:
- no `window`, `document`, DOM APIs, or extension APIs
- pure-data inputs/outputs

Primary entry point:
- `runConversationEngine({ tweets, rankOptions, collapseThreads })`

Input:

```js
[{ id, author_id, text, referenced_tweets?, metrics?, reply_to?, quote_of?, repost_of?, ... }]
```

Output:

```js
{
  rootId,
  root,
  nodes,
  edges,
  ranking,
  rankingMeta
}
```

### Data Layer (`data/`)
Responsibilities:
- collect tweets from source-specific systems
- normalize to a unified tweet schema
- resolve canonical root before retrieval

Modules:
- `data/dom_collector.js`: DOM discovery/extraction + schema normalization helpers
- `data/x_api_client.js`: X API retrieval client

Canonical root rules:
1. if clicked tweet quotes another tweet, the quoted tweet is root
2. else follow reply chain (`replied_to`) to origin
3. DOM ancestor hint can be supplied as `rootHintTweetId`

### UI Layer (`ui/`)
Responsibilities:
- sectioning ranked tweets into panel views
- rendering panel/cards
- scroll + highlight behavior

Modules:
- `ui/panel_renderer.js`
- `ui/tweet_highlight.js`

No graph or ranking algorithms are implemented in UI.

### Extension Layer (`extension/`)
Responsibilities:
- inject `◇ Explore`
- collect runtime config (token/following)
- call Graph API via extension background bridge
- call core engine
- call UI renderer

`extension/content.js` is intentionally thin orchestration.

## Graph Model

Conversation edges are built as typed links:
- `reply`
- `quote`
- `repost` (retrieval/display compatibility)

ThinkerRank propagation uses adjacency lists over weighted edge types:
- reply weight: `1.0`
- quote weight: `1.3`

ThinkerRank scoring combines:
- recursive graph influence (PageRank-style propagation)
- author prior (`followingSet` boost)
- reach prior and transfer boost from engagement metrics (`likes`, `reposts`, `replies`, `quotes`)
- follower-count prior from `author_profile.public_metrics.followers_count`

Adjacency index:

```js
{
  nodes: Map<tweetId, Node>,
  incomingEdges: Map<tweetId, Edge[]>,
  outgoingEdges: Map<tweetId, Edge[]>,
  outgoingWeightSums: Map<tweetId, number>,
  edges: Edge[],
  nodeOrder: tweetId[]
}
```

Complexity:
- graph/adacency build: `O(N + E)`
- ThinkerRank iterations: `O(kE)` (implemented as `O(k(N + E))` loop)
- panel sectioning: `O(N log N)`

## Runtime Flows

### Chrome Extension Flow

```text
Click tweet
-> content.js builds snapshot request
-> background.js fetches graph API (localhost/prod endpoint)
-> graph API job endpoint streams progress events
-> graph API resolves root + retrieves connected tweets in two passes:
   pass A: core topicsphere (replies, quotes, quote-reply expansion)
   pass B: bounded followed-author discovery (`from:<handle>` queries with strict request caps)
   note: per-root replies and quote fetches run concurrently, then are merged in deterministic order
-> optional OpenAI contribution classifier filters low-value tweets
-> cache hit path can run incremental diff refresh (new replies/quotes) before final rank
-> core engine ranks remaining graph
-> content.js renders network/global panel sections
```

Why this bridge exists:
- page-context fetch from `https://x.com` to `http://127.0.0.1:*` is blocked by CSP/Private Network Access
- extension service worker fetch is not subject to page CSP, so dev localhost and prod API both work

### Standalone/Server Flow

```text
Receive normalized tweets
-> runConversationEngine()
-> consume { nodes, edges, ranking, rankingMeta }
```

No DOM is required for the standalone/server flow.

Graph cache server observability:
- emits structured JSON logs for each HTTP request, X API request, pipeline phase, warning, and completion summary
- includes ranking diagnostics (`rankingCount`, `nonZeroScoreCount`, `emptyRankingReason`, top score preview) to debug empty panel outputs quickly
- supports ANSI-colored terminal output via `ARIADEX_LOG_COLOR=true`
- includes deterministic benchmark harness (`npm run benchmark:snapshot`) for cold/warm latency and endpoint-call tracking

Graph cache update modes:
- full build: cache miss / force refresh
- incremental merge: cache hit + `incremental=true` fetches newest replies/quotes and merges diffs into cached dataset
- cache key includes canonical root + mode + pipeline/classifier signatures + following signature (followed-author discovery is viewer-dependent)

Following set note:
- followed-account ranking/discovery depends on `followingSet` provided by extension config/runtime hints.
- server attempts viewer-handle-based following resolution when `followingSet` is empty.
- if credentials/scopes block `/users/:id/following`, Ariadex keeps running and logs a warning; `X_FOLLOWING_IDS` remains the reliable fallback.

## Integration Contracts

Data layer emits normalized tweets used by core:

```js
{
  id,
  author_id,
  author,
  text,
  referenced_tweets,
  metrics,
  reply_to,
  quote_of,
  repost_of
}
```

UI expects:

```js
{
  nodes,
  scoreById,
  followingSet
}
```

`nodes[*].author_profile.profile_image_url` is consumed by panel cards when available.

## Determinism Guarantees
- ranking sorts with deterministic tie-breakers
- panel sections are built from one canonical sorted list
- duplicate tweets are removed across panel sections
- adjacency index deduplicates duplicate edges by `(source,target,type)`

For algorithm details, see `docs/conversation_rank.md`.

## Compatibility Notes
Some `extension/*` modules mirror `core/data/ui` behavior to keep manifest loading and legacy tests stable. New feature work should target `core/`, `data/`, and `ui/` first.
