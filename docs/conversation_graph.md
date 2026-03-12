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
3. uses attached nodes to produce final graph
4. avoids duplicate nodes in output
5. handles empty and partial datasets safely

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
