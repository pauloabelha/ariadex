# UI Rendering

## Layer Boundary
UI code does not build graphs or compute rank.

- Receives precomputed `nodes` and `scoreById`.
- Produces panel DOM and click interactions only.

## Modules
- `ui/panel_renderer.js`
- `ui/tweet_highlight.js`

## Rendering Flow
1. Build panel sections from ranked nodes.
2. Render `From Your Network` and `Top Thinkers` sections.
3. Attach click handlers to jump to tweet anchors.

## Performance
For `N` nodes:
- section sort: `O(N log N)`
- section split: `O(N)`
- card rendering: bounded by limits (default max 15 cards)

No `O(N²)` operations are used in sectioning/rendering.

## Resilience
- missing tweet anchors fail safely
- empty sections show placeholder text
- panel attachment is idempotent
