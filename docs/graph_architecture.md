# Graph Architecture

## Purpose
Defines the adjacency-list representation used by core ranking and traversal.

Primary implementation:
- `core/conversation_adjacency.js`

## Node Shape

```js
{
  id,
  author_id,
  author,
  text,
  metrics,
  incoming_edges,
  outgoing_edges,
  raw
}
```

## Edge Shape

```js
{
  source,
  target,
  type,   // reply | quote
  weight
}
```

## Index Shape

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

Defaults:
- `reply = 1.0`
- `quote = 1.3`

## Build Rules
`createConversationAdjacency(graph, options)`:
1. node dedupe by id
2. edge type filtering (`reply`, `quote` by default)
3. endpoint validation (`source` and `target` must exist)
4. self-loop rejection
5. duplicate edge suppression by `source|target|type`
6. weight normalization

## Complexity
For `N` nodes and `E` edges:
- build: `O(N + E)`
- validation: `O(N + E)`
- memory: `O(N + E)`

## Why this model
- `O(1)` node lookup
- efficient incoming/outgoing traversal
- direct support for iterative rank propagation
- deterministic output ordering via `nodeOrder`

## Integration Points
- graph build: `core/conversation_graph.js`
- rank propagation: `core/conversation_rank.js`
- panel sectioning input: `ui/panel_renderer.js`
