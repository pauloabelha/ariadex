# Ariadex Graph Algorithm

This document explains the Ariadex graph algorithm in two layers:

1. plain language: what the system is trying to do and why
2. detailed: the concrete graph, ranking, and snapshot-building behavior

The current implementation is spread across:
- `server/path_anchored_snapshot.js`
- `core/conversation_graph.js`
- `core/conversation_adjacency.js`
- `core/thread_collapse.js`
- `core/conversation_rank.js`

There is also a research selector layer used for fixture-backed offline comparison:
- `research/selectors/registry.js`
- `research/selectors/path_anchored_v1.js`
- `research/selectors/expand_all_v0.js`
- `research/selectors/quota_per_parent_v0.js`
- `research/selectors/thread_context_v0.js`

## Plain Language

### What problem Ariadex is solving

When someone clicks `◇ Explore` on a tweet, Ariadex is trying to answer a reading question:

"What is the most important structure around this tweet?"

That is not the same as:
- "show every reply"
- "show the whole root conversation"
- "sort by likes"

Instead, Ariadex tries to build a small, useful map of the conversation.

It does that in three big steps:
- find the path that leads to the clicked tweet
- expand only the most important nearby branches
- rank the kept tweets by influence, not just popularity

### The core idea

Ariadex treats a conversation as a graph.

In this graph:
- tweets are nodes
- reply and quote relationships are edges

This matters because important ideas in a conversation are often not the loudest tweets. A tweet may matter because other strong tweets reply to it, quote it, or build on it.

So Ariadex asks:
- which tweets are structurally central?
- which tweets attract meaningful replies or quotes?
- which branches are substantive enough to keep?
- which tweets are influential because influential tweets point to them?

### Why Ariadex is path-first

If you click a tweet in the middle of a large thread, the full conversation can be huge and noisy.

Ariadex does not start by saying:
"download everything and show the top 10."

It starts by finding the reading path from the clicked tweet back to the root:
- if the tweet quotes another tweet, the quoted tweet is treated as its parent
- otherwise, if it replies to another tweet, that replied-to tweet is the parent
- then the same rule is repeated upward

That parent chain becomes the mandatory path.

The mandatory path is the minimum context needed to understand why the clicked tweet exists.

### Why Ariadex is selective

After the mandatory path is known, Ariadex expands outward, but only in a controlled way.

It looks at direct replies and direct quote tweets around the active frontier and asks:
- is this tweet substantive?
- does it have signs of reach?
- is the author significant?
- is this branch likely to change the reading of the conversation?

Only the better children are kept.

This is how Ariadex avoids turning into an unreadable "everything graph."

### What makes a tweet important

Importance is not one thing.

Ariadex combines several signals:
- graph structure: being replied to or quoted by strong tweets matters
- edge type: quotes are treated as slightly stronger than replies
- reach: tweets with more likes, reposts, replies, and quotes start with more weight
- author audience: tweets from larger accounts get some prior weight
- network affinity: followed authors can be boosted into `From Your Network`

So a tweet can rank well because:
- many strong tweets point to it
- one very important quote points to it
- it already has strong reach
- the author is influential
- or some combination of the above

### Why Ariadex uses references too

The graph is not only about tweets talking to tweets.

Many important branches cite outside evidence:
- articles
- papers
- videos
- documents

So Ariadex extracts canonical external references from the kept tweets and merges duplicate URLs into stable reference entities.

That lets the UI answer not only:
- "what did people say?"

but also:
- "what evidence did this branch rely on?"

### What the final result is

The result is a focused conversation artifact:
- the mandatory path from root to clicked tweet
- a bounded set of important reply and quote branches
- optional bounded local thread completion around selected anchors, depending on selector
- a typed graph over those tweets
- a ThinkerRank score for each kept tweet
- canonical references extracted from the kept set
- enough metadata for the Dex tabs: `Context`, `Branches`, `References`, `People`, `Log`, `Digest`

In short:

Ariadex is trying to turn a messy conversation into a readable map of influence, context, and evidence.

The deeper product direction is not "bag of tweets."

It is closer to a topic-discussion primitive:
- preserve the explanatory spine
- preserve meaningful branches
- preserve key participants and references
- complete enough local thread context that selected tweets read as coherent discourse units

## Detailed

### End-to-End Pipeline

At a high level, the algorithm is:

1. resolve the canonical root
2. collect or reuse conversation data
3. build a path-anchored snapshot around the clicked tweet
4. convert the kept tweets into a typed graph
5. build adjacency indexes
6. optionally collapse root-author continuation threads
7. run ThinkerRank
8. derive UI-facing sections and reference artifacts

### Step 1: Canonical Root Resolution

The parent rule is intentionally deterministic.

For a tweet `t`:
- if `t.quote_of` exists, parent is `t.quote_of`
- else if `t.reply_to` exists, parent is `t.reply_to`
- else if `referenced_tweets` contains a quoted target, that quoted target is preferred
- else if `referenced_tweets` contains a replied-to target, that replied-to target is used
- else `t` has no parent

Quote precedence is important. In Ariadex, a quote tweet is treated as structurally hanging off the quoted tweet before ordinary reply ancestry is considered.

The canonical root is the first ancestor that has no parent under that rule.

### Step 2: Conversation Collection

The retrieval layer assembles a conversation bag using the official X API, typically in two passes:
- core topicsphere pass
  - replies
  - quotes
  - quote-replies
- bounded followed-author discovery pass

The important property is not "collect every possible tweet forever."

The important property is:
- gather enough structurally related tweets to support path anchoring
- do so with concurrency where safe
- merge deterministically
- reuse caches whenever possible

### Step 3: Path-Anchored Snapshot Construction

The path-anchored snapshot is the main selection algorithm implemented server-side.

Its job is to choose a useful subgraph from a larger conversation bag.

#### 3.1 Build the mandatory path

Given:
- `clickedTweetId`
- optional `rootHintTweetId`
- `tweetById`

The algorithm walks from the clicked tweet upward using the parent rule until no parent exists.

The resulting ordered chain is:

```text
root -> ... -> parent -> clicked
```

This becomes `mandatoryPath`.

Every tweet on this path is force-included.

#### 3.2 Build child indexes

From the collected tweet bag, Ariadex builds:
- `repliesByParentId`
- `quotesByParentId`

These indexes allow cheap expansion from any kept node.

Only human tweets are considered expandable. Synthetic nodes such as repost markers or collapsed author-thread nodes are excluded from this phase.

#### 3.3 Low-signal filtering

Before expansion candidates are kept, Ariadex filters out obviously low-signal tweets.

Examples of low-signal behavior:
- empty or near-empty text
- bot-like thread-unroll requests
- trivial acknowledgment tweets
- extremely short mention-only replies

This is a heuristic filter, not a semantic proof.

Its purpose is to keep the frontier from being dominated by noise.

#### 3.4 Child importance scoring

Each direct child candidate is scored with a local importance heuristic.

Current factors include:
- `likes`
- `quote_count`
- `replies`
- author follower count
- substantive text length
- relation bonus
  - quotes get a larger bonus than replies
- path-child bonus
  - children attached to the mandatory path get extra weight
- depth penalty
  - deeper expansion gets penalized

This score is not the final ThinkerRank score.

It is a frontier-selection score used to decide which local branches deserve inclusion.

#### 3.5 Recursive bounded expansion

Expansion proceeds recursively with hard limits such as:
- `maxDepth`
- `maxChildrenPerNode`
- `maxTotalTweets`
- `minSubstantiveChars`
- `minImportanceScore`

At each step:
- take the current frontier node
- inspect direct replies and direct quotes
- score candidates
- keep only the best substantive children above threshold
- recurse into those kept children until limits are reached

This makes the snapshot:
- path-anchored
- selective
- deterministic
- bounded in size

The research selector layer builds on this base contract and lets Ariadex compare alternative selection policies on the same saved fixture and explored tweet. The current most discussion-oriented variant is `thread_context_v0`, which:
- starts from the same path-anchored selection
- then adds a bounded amount of same-author reply-thread continuation around selected anchors
- aims to reduce fragmentary outputs without turning the selector into an unbounded full-thread fetch

#### 3.6 Reference extraction

Across the kept set, Ariadex extracts canonical external references.

For each kept tweet:
- inspect text URLs
- inspect entity-backed URLs when available
- discard internal X links as evidence references
- canonicalize remaining URLs
  - remove fragments
  - remove common trackers
  - normalize host casing and equivalent forms

The result is a deduplicated reference set that the UI can render in `References` and the digest system can use as article evidence.

### Step 4: Graph Construction

The kept tweets are converted into a typed graph by `buildConversationGraph(...)`.

Graph output shape:

```js
{
  rootId,
  nodes,
  edges,
  root,
  children
}
```

Construction stages:

1. deduplicate tweets by id
2. index tweets by id
3. attach reply relationships
4. materialize typed edges
5. select root and safe branch structure

Supported edge types:
- `reply`
- `quote`
- `repost`

For ranking, repost edges are usually excluded from propagation.

If a parent is missing from the dataset, the child can still remain in the graph as a safe partial-root candidate. This keeps ranking and rendering usable under incomplete collection.

### Step 5: Adjacency Indexing

For efficient traversal and ranking, Ariadex builds adjacency lists:

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

Build rules:
- dedupe nodes by id
- keep only supported edge types
- reject edges whose endpoints do not exist
- reject self-loops
- suppress duplicate edges by `source|target|type`

Default propagation weights:
- `reply = 1.0`
- `quote = 1.3`

This representation gives:
- `O(1)` node lookup by id
- cheap incoming/outgoing traversal
- stable deterministic iteration order

### Step 6: Thread Collapse

Before ranking, Ariadex may collapse certain root-author continuation sequences into synthetic nodes.

The intent is:
- avoid overcounting a root author's own continuation thread as many separate ideas
- preserve the main discourse structure
- rank ideas and reactions more than author self-extensions

This step is optional but normally enabled in `runConversationEngine(...)`.

### Step 7: ThinkerRank

ThinkerRank is a PageRank-style recursive influence algorithm over the typed conversation graph.

#### 7.1 Intuition

A tweet should score highly if:
- strong tweets reply to it
- strong tweets quote it
- the supporting tweets themselves have reach
- the author has some prior significance

So influence is partly inherited.

#### 7.2 Reach signal

For tweet `i`, raw reach is:

```text
reach_raw(i) =
  1.0 * likes
+ 2.0 * reposts
+ 2.3 * replies
+ 2.7 * quotes
```

Then:

```text
reach_signal(i) = log(1 + reach_raw(i)) / max_log_reach
```

So `reach_signal(i)` is normalized into `[0, 1]`.

#### 7.3 Follower signal

For author audience prior:

```text
follower_signal(i) = log(1 + followers_count(i)) / max_log_followers
```

This is also normalized into `[0, 1]`.

#### 7.4 Base prior

Before recursive propagation, Ariadex assigns each tweet a base prior.

Author prior:

```text
author_base(i) =
  followedAuthorWeight  if author is in followingSet
  defaultAuthorWeight   otherwise
```

Then:

```text
base_unnorm(i) =
  author_base(i)
  * (1 + reachWeight * reach_signal(i))
  * (1 + followerWeight * follower_signal(i))
```

Finally, priors are normalized so:

```text
Σ base(i) = 1
```

#### 7.5 Edge-adjusted recursive propagation

For an edge `j -> i`, Ariadex computes an adjusted propagation weight:

```text
w'(j -> i) = w(j -> i) * (1 + edgeReachBoost * reach_signal(j))
```

Where:
- `w = 1.0` for replies
- `w = 1.3` for quotes

Then each iteration updates tweet score as:

```text
TR(i) = (1 - α) * base(i)
      + α * ( Σ_j TR(j) * w'(j -> i) / out_weight_sum'(j) + dangling_mass / N )
```

Defaults are approximately:
- `α = 0.85`
- `minIterations = 10`
- `maxIterations = 20`
- `tolerance = 1e-6`

This is standard recursive ranking with Ariadex-specific priors and edge boosts.

#### 7.6 Deterministic ordering

When scores are equal or nearly equal, Ariadex uses stable tie-breaks:

1. higher final `score`
2. higher `baseScore`
3. lower original input index
4. lexical tweet id

This ensures reproducible results for the same input graph and options.

### Step 8: UI Projection

After ranking, the UI layer derives higher-level views from the ranked graph.

Important projections include:
- `Branches`
  - `From Your Network`
  - `Top Thinkers`
- `References`
- `People`
- `Context`
- `Log`
- `Digest`

These are not separate algorithms so much as structured views over:
- the selected tweet set
- the typed graph
- the ThinkerRank scores
- the canonical references
- the snapshot diagnostics

## Complexity Summary

Let:
- `N` = number of kept tweets
- `E` = number of typed edges
- `k` = number of ThinkerRank iterations

Then the main costs are:

- path-anchored snapshot selection:
  - bounded by expansion caps; practical cost is controlled by `maxDepth`, `maxChildrenPerNode`, and `maxTotalTweets`
- graph construction:
  - `O(N + E)`
- adjacency build:
  - `O(N + E)`
- ThinkerRank:
  - `O(k(N + E))`
- final ranking sort:
  - `O(N log N)`

Because the snapshot step is intentionally bounded, Ariadex is designed to stay readable and computationally manageable even when the underlying root conversation is much larger.

## Mental Model

If you want one sentence to remember the whole algorithm, it is this:

> Ariadex finds the path to the clicked tweet, expands only the most meaningful nearby branches, then ranks the kept tweets by recursive conversational influence.
