# Thread Collapsing

## Why Collapse Root Author Tweets
In long conversations, the root author frequently posts multiple follow-up tweets. Ranking these independently can over-amplify a single discourse unit.

Ariadex collapses those root-author tweets into one synthetic node to rank ideas instead of counting each continuation tweet as a separate item.

## Node Types
- `tweet` node: regular tweet extracted from DOM
- `author_thread` node: synthetic aggregate for root-author continuation tweets

Example aggregate node:

```js
{
  id: "author_thread:@garrytan",
  type: "author_thread",
  author: "@garrytan",
  tweets: [/* root-author tweets */]
}
```

## Collapse Process
1. detect root author from `graph.root.author`
2. collect all graph nodes authored by root author
3. if only one exists, keep graph unchanged
4. if multiple exist:
   - remove those nodes
   - insert one `author_thread` node
   - remap incoming/outgoing edges to `author_thread`

## Ranking Impact
After collapsing, ConversationRank treats the root author's discourse as one unit. This improves diversity in top results and surfaces stronger external responses.
