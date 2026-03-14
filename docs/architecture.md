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
- call data layer
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
-> DOM root hint
-> canonical root via X API
-> retrieve connected tweets (replies, quotes, repost users)
-> run core conversation engine
-> render network/global panel sections
```

### Standalone/Server Flow

```text
Receive normalized tweets
-> runConversationEngine()
-> consume { nodes, edges, ranking, rankingMeta }
```

No DOM is required for the standalone/server flow.

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

## Determinism Guarantees
- ranking sorts with deterministic tie-breakers
- panel sections are built from one canonical sorted list
- duplicate tweets are removed across panel sections
- adjacency index deduplicates duplicate edges by `(source,target,type)`

For algorithm details, see `docs/conversation_rank.md`.

## Compatibility Notes
Some `extension/*` modules mirror `core/data/ui` behavior to keep manifest loading and legacy tests stable. New feature work should target `core/`, `data/`, and `ui/` first.
