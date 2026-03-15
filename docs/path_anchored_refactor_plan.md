# Path-Anchored Snapshot Refactor Plan

## Goal

Replace Ariadex's current "collect a broad root-centered graph, then globally rank it" flow with a path-anchored traversal that:

- starts from the exact explored tweet
- preserves the full ancestor chain up to the root as mandatory context
- expands only important branches
- extracts canonical external references as first-class evidence
- persists reusable graph primitives so known tweets do not trigger repeated paid collection

This document is the target architecture. The current refactor introduces the path-anchored selector at snapshot assembly time. The remaining steps below describe the fully persistent end state.

Current state as of `v2`:
- path-anchored selection is live
- ancestor path follows quoted parent first, then reply parent
- selected references are canonicalized from tweet text and entity-backed URLs
- snapshot/article caches persist to disk
- cached snapshots do not re-scan the whole root; they hydrate only missing path tweets

## Product Semantics

### Mandatory Context

Given an `exploredTweetId`:

1. load the explored tweet
2. follow `quote_of` first, then `reply_to`, until no parent exists
3. store the ordered `mandatoryPath`

Definitions:

- `exploredTweet`: the clicked tweet
- `rootTweet`: the terminal ancestor
- `mandatoryPath`: ordered tweets from `rootTweet` to `exploredTweet`

Every tweet in `mandatoryPath` is always included in the final snapshot and digest.

Important nuance:
- this rule applies recursively, not only on the first hop
- if `ExploredTweet` quotes `A`, and `A` replies to `B`, the path is `B -> A -> ExploredTweet`

### Branch Expansion

For each tweet in the active frontier:

- inspect direct replies
- inspect direct quote tweets
- compute `importanceScore`
- keep only substantive tweets above threshold
- sort by score
- recurse on the top kept children

Hard limits:

- `maxDepth`
- `maxChildrenPerNode`
- `maxTotalTweets`
- `minSubstantiveChars`
- `minImportanceScore`

### Evidence Extraction

For every kept tweet:

- extract all URLs from:
  - text
  - X entity-expanded external URLs
- canonicalize them
- drop X/Twitter internal links
- classify as `document`, `video`, or `web`
- persist `tweet -> reference` citation edges

The final digest should be built from:

- `mandatoryPath`
- selected branch tweets
- canonical references cited by those tweets

## Naming

Recommended internal names:

- `mandatoryPath`
- `pathRootTweetId`
- `replyCandidates`
- `importantReplies`
- `expansionFrontier`
- `importanceScore`
- `canonicalReference`
- `referenceCitation`
- `pathAnchoredSnapshot`

Recommended module boundaries:

- `data/path_anchored_collector.js`
- `server/path_anchored_snapshot.js`
- `server/reference_store.js`
- `server/reference_canonicalizer.js`

## Target Persistent Architecture

### 1. Entity Cache

Persist stable normalized entities keyed by id:

- `entity:tweet:<tweetId>`
- `entity:user:<userId>`

Stored payload:

```js
{
  id,
  author_id,
  author,
  author_profile,
  text,
  conversation_id,
  created_at,
  reply_to,
  quote_of,
  repost_of,
  likes,
  replies,
  reposts,
  quote_count,
  url
}
```

This cache already exists in part and should remain the primitive layer for tweet/user reuse.

### 2. Conversation Bag Cache

Persist direct API collection results per conversation root:

- `conversation_bag:<conversationId>`

Stored payload:

```js
{
  conversationId,
  tweetIds,
  fetchedAtMs,
  pageCount,
  partial,
  warningCount
}
```

Rules:

- one bag per `conversation_id`
- direct replies to non-root tweets are resolved from the bag, not by separate requests
- known tweets are frozen after collection
- bag refresh is not part of normal cache hits
- only missing path tweets are hydrated later when the explored path introduces unseen ids

### 3. Quote Bag Cache

Persist quote-tweet fetches per tweet:

- `quote_bag:<tweetId>`

Stored payload:

```js
{
  tweetId,
  quoteTweetIds,
  fetchedAtMs,
  pageCount,
  partial
}
```

This allows quote branches to be reused across traversals.

### 4. Ancestor Path Cache

Persist resolved parent chains:

- `mandatory_path:<exploredTweetId>`

Stored payload:

```js
{
  exploredTweetId,
  rootTweetId,
  pathTweetIds,
  resolvedAtMs
}
```

Invalidation is cheap because parent links are stable for tweet ids.

### 5. Reference Cache

Persist canonical references and tweet citation edges:

- `reference:<sha256(canonicalUrl)>`
- `reference_edges:<tweetId>`

Stored payload:

```js
{
  canonicalUrl,
  displayUrl,
  domain,
  kind,
  normalizedAtMs
}
```

and:

```js
{
  tweetId,
  references: [
    { canonicalUrl, kind }
  ]
}
```

### 6. Traversal Result Cache

Persist the derived path-anchored snapshot:

- `path_snapshot:<hash(config + exploredTweetId + scoringVersion)>`

Stored payload:

```js
{
  exploredTweetId,
  rootTweetId,
  mandatoryPathIds,
  selectedTweetIds,
  expansionLevels,
  references,
  configVersion,
  scoringVersion,
  builtAtMs
}
```

This is the cache hit that should prevent paying again for known traversals.

## Efficiency Strategy

### Candidate Sourcing First

Adopt the same separation used in large recommendation systems:

1. `candidate sourcing`
2. `ranking`
3. `snapshot assembly`

In Ariadex terms:

1. source only tweets directly attached to the mandatory path or selected frontier
2. rank only those candidates
3. render only the selected subgraph

This is much cheaper than collecting a large deep graph and trying to rank it down later.

Current operational rule:
- broad collection happens once per root cache miss
- repeated explores over known roots should be satisfied from disk cache plus optional narrow path hydration only

### Reuse Existing Bags

When expanding a node:

- if its `conversation_id` bag exists, reuse it
- if its quote bag exists, reuse it
- only fetch missing bags
- hydrate tweet ids via `entity:tweet:*`

### Incremental Refresh

On revisit:

- refresh only the conversation bags touched by the prior snapshot
- refresh only quote bags for selected frontier nodes
- do not invalidate ancestor-path caches unless parent resolution failed previously

## Safe Scoring

Use damped features to avoid celebrity noise dominating the traversal:

```text
importanceScore =
  0.9 * log1p(likes)
+ 1.35 * log1p(quotes)
+ 0.4 * log1p(replies)
+ 0.28 * log1p(author_followers)
+ substanceScore
+ relationBonus
+ pathBonus
- depthPenalty
```

Safety constraints:

- reject trivial/low-signal tweets
- reject link-only replies unless engagement is very high
- reject `#unroll` / pure reaction replies
- cap per-parent children
- cap total selected tweets

## Reference Canonicalization Rules

Canonicalization should:

- remove tracking parameters
- normalize host casing and `www.`
- keep stable document/video identity
- dedupe repeated citations

Reference classes:

- `document`: pdf, DOI, arXiv, docs pages
- `video`: YouTube, Vimeo, video-hosting pages
- `web`: everything else external

Future enhancement:

- ingest X media attachments and classify native videos as reference nodes too

## Migration Plan

### Phase 1: Selection Refactor

Implemented now:

- path-anchored selection at snapshot assembly time
- mandatory path preservation
- recursive expansion over important replies/quotes
- canonical external reference extraction
- article generation grounded in selected tweets

### Phase 2: Persistent Bag Layer

Next:

- add `conversation_bag` and `quote_bag` caches
- hydrate snapshots from bag caches before making API calls
- refresh bags incrementally

### Phase 3: Traversal Cache

Next:

- persist `mandatory_path`
- persist final `path_snapshot`
- key by traversal/scoring versions for clean invalidation

### Phase 4: Native Evidence Layer

Next:

- ingest media attachments
- classify native X video/image/document evidence
- rank references by citing tweet importance

## Implementation Checklist

- move collection intelligence out of article generation
- keep `entity:tweet` and `entity:user` as primitive persistent caches
- add `conversation_bag` and `quote_bag`
- version traversal config separately from article config
- expose `snapshot.pathAnchored` in API responses
- base digest/article generation on `snapshot.pathAnchored.selectedTweetIds`
- include `snapshot.pathAnchored.references` in article inputs

## Non-Goals

- replacing the whole recommendation/ranking stack with ML
- full media attachment ingestion in the first refactor
- collecting every reachable quote-reply branch

The correct first principle is: preserve the path, expand only meaningful branches, and persist each reusable layer independently.
