# Ariadex Layered Architecture

## Goal
Ariadex now uses a layered design so the conversation logic is reusable outside Chrome.

- `core/` contains the platform-independent Ariadex Conversation Engine.
- `data/` retrieves and normalizes tweet data.
- `ui/` renders ranked output.
- `extension/` wires X page events to the three layers.
- `server/` now assembles a path-anchored snapshot artifact for caching, ranking, and digest generation.
- persistent caches are intended to be first-class graph infrastructure, not just an optimization layer.

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
- preserve entity-backed external URLs for later evidence extraction
- support stable entity-level persistence so known tweets, users, and references can be checked before API calls

Modules:
- `data/dom_collector.js`: DOM discovery/extraction + schema normalization helpers
- `data/x_api_client.js`: X API retrieval client

Canonical root rules:
1. if clicked tweet quotes another tweet, the quoted tweet is root
2. else follow reply chain (`replied_to`) to origin
3. DOM ancestor hint can be supplied as `rootHintTweetId`

Normalized tweet contract now also preserves:
- `external_urls`: expanded/unwound external URLs derived from X tweet entities

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
- bounded root-mention prior for authors explicitly tagged by the root tweet

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
-> snapshot assembly builds a path-anchored view:
   - mandatory ancestor path from the explored tweet
   - recursive important-branch expansion
   - canonical reference extraction
-> core engine ranks the selected subgraph
-> content.js renders Dex tabs (Branches/References/People/Context/Log/Digest)
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

## Persistent Cache Model

The intended architecture is hash-first and persistent.

Known entities should be checked in constant time before any network request.

Persistent cache layers:

- tweet entity cache
- user entity cache
- canonical reference cache
- tweet-to-reference edge cache
- ancestor-path cache
- explored-artifact cache

Keying strategy:

- tweets:
  - by stable tweet id
- users:
  - by stable user id
- references:
  - by canonical URL hash
- explored artifacts:
  - by explored tweet id plus algorithm-version signature

Behavioral rule:

- if a known tweet, user, reference, or explored artifact is cached, load it directly
- if it is not cached, fetch it, normalize it, and persist it immediately

This is what makes repeat exploration effectively constant-time on the cache decision path.

Graph cache server observability:
- emits structured JSON logs for each HTTP request, X API request, pipeline phase, warning, and completion summary
- includes ranking diagnostics (`rankingCount`, `nonZeroScoreCount`, `emptyRankingReason`, top score preview) to debug empty panel outputs quickly
- supports ANSI-colored terminal output via `ARIADEX_LOG_COLOR=true`
- includes deterministic benchmark harness (`npm run benchmark:snapshot`) for cold/warm latency and endpoint-call tracking

## Path-Anchored Snapshot Algorithm

Given `clickedTweetId` and optional `rootHintTweetId`:

1. Load or reuse the cached conversation bag for the canonical root.
2. Build the `mandatoryPath` starting at the explored tweet.
3. Parent resolution rule for every hop:
   - prefer `quote_of`
   - otherwise use `reply_to`
   - also consult `referenced_tweets` when normalized shortcut fields are missing
4. Continue recursively on the parent tweet until no parent exists.
5. Force-include every tweet on the `mandatoryPath`.
6. Collect canonical references across the whole kept set:
   - ancestor-path tweets
   - expanded tweets
7. Expand direct children from the active frontier:
   - direct replies
   - direct quote tweets
8. Score children by:
   - likes
   - quotes
   - replies
   - author follower count
   - substantive text length
   - path-child bonus
   - quote/reply relation bonus
   - depth penalty
9. Keep only substantive children above threshold.
10. Recurse with hard caps:
   - `maxDepth`
   - `maxChildrenPerNode`
   - `maxTotalTweets`
   - `minSubstantiveChars`
   - `minImportanceScore`
10. Collect canonical references from:
   - URLs in tweet text
   - `external_urls` derived from X entities
11. Build the final artifact:
   - `mandatoryPath`
   - `expansions`
   - `selectedTweets`
   - `references`

This means Ariadex now follows:

`ExploredTweet -> quoted parent if present -> otherwise reply parent -> continue structurally until root`

This is generic. If the quoted parent is itself a reply, Ariadex keeps walking that reply chain.

## Cache Semantics

Snapshot cache key:
- canonical root id
- mode
- pipeline version
- following signature

Snapshot persistence:
- stored on disk in `.cache/graph_cache_store.json`
- survives server restarts
- known tweets are frozen once retrieved

Cached snapshot behavior:
- no full-root refresh on cache hits
- no background “scan the whole conversation again” behavior
- only missing path tweets may be hydrated:
  - `clickedTweetId`
  - `rootHintTweetId`
  - any missing parents on that ancestor chain

This is deliberate:
- tweets are immutable enough for this product
- repeated `Explore` on known tweets should be cheap
- only unseen path nodes justify additional X API calls

Path-anchored snapshot layer:
- builds `mandatoryPath` from the clicked tweet to the root
- expands only high-signal direct replies and quote tweets with strict depth/breadth caps
- extracts canonical external references from both tweet text and entity-backed URLs
- emits `snapshot.pathAnchored.artifact`, a JSON artifact intended as the stable LLM-facing conversation contract

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
  external_urls,
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
