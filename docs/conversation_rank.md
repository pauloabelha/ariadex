# ConversationRank

## Goal
ConversationRank estimates intellectual influence inside a conversation by propagating score through the typed conversation graph.

## Input
`rankConversationGraph(graph, options?)` expects:

- `graph.nodes`: tweet nodes with `id`
- `graph.edges`: typed directed edges
  - `reply`
  - `quote`
  - `repost`

Edge direction is `source -> target` where source references target.

## Algorithm
Ariadex uses a weighted PageRank-style iteration:

1. initialize all nodes with uniform score
2. for each iteration:
   - distribute source score across outgoing edges by type-weighted proportions
   - apply damping factor
   - redistribute dangling mass uniformly
3. stop on tolerance or max iterations

Default edge weights:

- `reply`: `1.0`
- `quote`: `1.25`
- `repost`: `0.75`

This biases influence toward tweets that are quoted and substantively replied to.

## Output

```js
{
  scores: [{ id, score, tweet }],
  scoreById: { [id]: number },
  topTweetIds: [id1, id2, ...],
  iterations: number,
  converged: boolean
}
```

## Notes
- ranking is computed fully client-side from visible DOM-derived graph
- no network calls are used
- this is a first-pass influence model; future versions can blend semantic quality signals
