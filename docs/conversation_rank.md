# ConversationRank (ThinkerRank)

## Overview
ThinkerRank is implemented in `core/conversation_rank.js` and mirrored for extension runtime in `extension/conversation_rank.js`.

Upstream note:
- when server-side OpenAI contribution filtering is enabled, ThinkerRank runs on the filtered tweet set (non-contributing tweets removed, canonical root retained).

It is a recursive PageRank-style algorithm over the conversation graph, with three added signals:
1. author prior (`followingSet` boost)
2. tweet reach (likes/reposts/replies/quotes)
3. author follower count (audience size prior)

The intent is:
- recursive influence: being cited by high thinkers raises your score
- reach awareness: high-engagement tweets get stronger priors and pass stronger influence

## Inputs
Graph comes from `core/conversation_graph.js` / `core/thread_collapse.js`.

Propagation edge types:
- `reply`: weight `1.0`
- `quote`: weight `1.3`

`repost` edges are excluded from ThinkerRank propagation.

## Reach Signal
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

So `reach_signal(i) ∈ [0, 1]`.

## Base Prior
Author prior:

```text
author_base(i) = followedAuthorWeight (default 2.0) if author followed else defaultAuthorWeight (default 1.0)
```

Reach + follower adjusted prior before normalization:

```text
base_unnorm(i) =
  author_base(i)
  * (1 + reachWeight * reach_signal(i))
  * (1 + followerWeight * follower_signal(i))
```

Defaults:
- `reachWeight = 0.6`
- `followerWeight = 0.4`

Follower signal:

```text
follower_signal(i) = log(1 + followers_count(i)) / max_log_followers
```

So `follower_signal(i) ∈ [0, 1]`.

`base(i)` is then normalized so `Σ base(i) = 1`.

## Recursive Update
For each edge `j -> i`, adjusted edge weight is:

```text
w'(j->i) = w(j->i) * (1 + edgeReachBoost * reach_signal(j))
```

Default:
- `edgeReachBoost = 0.45`

For tweet `i`:

```text
TR(i) = (1 - α) * base(i)
      + α * ( Σ_j TR(j) * w'(j->i) / out_weight_sum'(j) + dangling_mass / N )
```

Defaults:
- `α = 0.85`
- `minIterations = 10`
- `maxIterations = 20`
- `tolerance = 1e-6`

## Determinism
Sort/tie-break order:
1. higher `score`
2. higher `baseScore`
3. lower original input index
4. lexical tweet id

Given identical input graph/options, output ordering is deterministic.

## Output
```js
{
  scores: [{ id, score, baseScore, reachSignal, followerSignal, inputIndex, tweet }],
  scoreById: Map,
  scoreByIdObject,
  topTweetIds,
  iterations,
  converged,
  scoreSpread,
  graphIndex
}
```

## Complexity
With `N` nodes, `E` edges, `k` iterations:
- adjacency/index prep: `O(N + E)`
- iterative propagation: `O(k(N + E))`
- final ordering: `O(N log N)`
