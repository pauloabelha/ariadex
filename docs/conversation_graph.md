# Conversation Graph

## Overview
Graph construction lives in `core/conversation_graph.js` and is source-agnostic.

Input: normalized tweet list.
Output: typed conversation graph used by collapsing/ranking/UI.

```js
{
  rootId,
  nodes,
  edges,
  root,
  children
}
```

## Construction Steps
`buildConversationGraph(tweets)`:
1. deduplicates tweets
2. indexes tweets by id (`indexTweetsById`)
3. attaches reply relationships (`attachReplies`)
4. builds typed edges (`buildTypedEdges`)
5. selects root and disconnected branches safely

## Edge Types
`buildTypedEdges` emits:
- `reply` from `reply_to`
- `quote` from `quote_of`
- `repost` from `repost_of`

Later ranking can choose allowed edge subsets.

## Missing Parent Behavior
If `reply_to` points to a tweet not in the dataset, the node is treated as a root candidate. This keeps the graph usable under partial API coverage.

## Complexity
For `N` tweets and `E` inferred edges:
- dedupe + index + attach: `O(N)`
- edge materialization: `O(E)`
- total: `O(N + E)`
