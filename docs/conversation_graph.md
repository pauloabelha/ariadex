# Conversation Graph

## Overview
Ariadex builds a conversation graph from the flat tweet list collected from the currently visible DOM.

Input dataset example:

```js
[
  {
    id: "123",
    author: "@user",
    text: "tweet",
    url: "https://x.com/user/status/123",
    replies: 14,
    reposts: 3,
    likes: 20,
    reply_to: null
  },
  {
    id: "124",
    reply_to: "123",
    ...
  }
]
```

Output graph shape:

```js
{
  rootId: "123",
  nodes: [{ ...tweet }, { ...tweet }],
  edges: [
    { source: "124", target: "123", type: "reply" },
    { source: "200", target: "123", type: "quote" },
    { source: "201", target: "123", type: "repost" }
  ],
  root: { ...tweet },
  children: [
    {
      tweet: { ... },
      children: [ ... ]
    }
  ]
}
```

## Indexing
`indexTweetsById(tweets)` creates an ID lookup map:

- key: tweet id
- value: tweet object

This enables O(1)-style parent lookup during graph construction.

## Parent-Child Resolution
`attachReplies(tweets)` performs:

1. deduplicate tweets (id-first identity)
2. create graph nodes (`{ tweet, children: [] }`)
3. attach each node to `reply_to` parent when parent exists
4. classify missing/unknown parent nodes as root candidates

This keeps construction resilient when DOM extraction is incomplete.

## Graph Construction
`buildConversationGraph(tweets)`:

1. validates/normalizes input list
2. finds explicit root candidate (`reply_to == null`) when present
3. builds typed edges for `reply`, `quote`, and `repost` relationships
4. keeps tree projection (`root`, `children`) for traversal/debugging
5. avoids duplicate nodes/edges in output
6. handles empty and partial datasets safely

## Typed Relationships
The graph uses relationship-aware edges:

- `reply`: sourced from `reply_to`
- `quote`: sourced from `quote_of`
- `repost`: sourced from `repost_of`

Tweets can have multiple edge types in the same dataset (for example, a quote in one branch and reply chains in another).

## Reply Relationship Inference
X usually does not expose an explicit `reply_to` field in the visible DOM. Ariadex therefore infers reply edges before graph building.

`inferReplyStructure(tweetElements, tweetData)` uses three heuristics:

1. DOM indentation depth:
   - reads indentation once per tweet (`getBoundingClientRect().left`, fallback to `margin-left + padding-left`)
   - computes depth buckets
   - assigns parent as the nearest previous tweet with smaller depth
2. Reply context text:
   - parses strings like `Replying to @username`
   - matches handle to earlier tweets and uses matching tweet as parent when possible
3. Fallback:
   - if depth is ambiguous, uses nearest previous tweet with smaller indentation
   - if no reliable parent exists, leaves `reply_to: null`

This inference is deterministic, local to current DOM state, and designed to stay performant by avoiding repeated layout reads.

## DOM-Only Limitations
- only visible tweets are included
- unloaded/collapsed replies are absent
- parent references may be missing for some replies
- graph may contain disconnected root-level branches when parent tweets are not present in DOM

## Why This Supports Ranking
The graph adds structure needed for ranking strategies, for example:

- depth-aware relevance (direct vs deep replies)
- branch-level engagement aggregation
- subtree quality scoring

This step is structure-only; ranking is intentionally out of scope for now.
