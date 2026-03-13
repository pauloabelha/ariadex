# UI Panel

## Purpose
The UI layer turns ranked engine output into an interactive panel.

Implementation:
- `ui/panel_renderer.js`
- `ui/tweet_highlight.js`

## Inputs

```js
{
  nodes,
  scoreById,
  followingSet,
  networkLimit = 5,
  topLimit = 10
}
```

## Two-Tier Ranking Logic
`buildPanelSections(...)` uses:
1. one deterministic sort by ThinkerRank (`O(N log N)`)
2. one traversal to build both sections (`O(N)`)

Sections:
- `⭐ From Your Network`: followed authors only, top 5
- `🔥 Top Thinkers`: highest remaining tweets, top 10

De-duplication is enforced across sections with a `Set`.

## Deterministic Ordering
Tie-breaking is explicit:
1. score desc
2. input index asc
3. lexical tweet id

This prevents unstable card ordering between renders.

## Rendering Behavior
`renderConversationPanel(...)`:
- ensures a single panel attached to `document.body`
- clears/rebuilds panel body per render
- renders empty-state rows when sections are empty
- binds click handlers for scroll/highlight

## Interaction
On card click:
1. locate tweet element by status id
2. smooth scroll to tweet
3. apply temporary highlight class
