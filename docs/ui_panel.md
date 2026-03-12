# UI Panel

## Overview
Ariadex renders ranked conversation results in a deterministic floating panel after `◇ Explore` is clicked.

## Rendering Strategy
The panel is always attached to `document.body` and uses fixed positioning.

Why this is deterministic:
- independent of X sidebar structure changes
- not blocked by timeline layout shifts
- visible with high z-index above page content

## Panel Lifecycle
1. `createPanelContainer()` creates panel once and appends to `document.body`.
2. `ensurePanelExists()` reuses existing panel instead of duplicating.
3. `renderTopThreads(rankedTweets)` updates list content on each Explore click.

## Interaction Model
Each ranked item includes:
- rank index
- author
- text snippet
- score

Click behavior:
- locate tweet by `status/{id}`
- scroll into view
- apply temporary highlight

## Debug Logs
UI pipeline logs:
- `[Ariadex] Ranking computed`
- `[Ariadex] Rendering panel`
- `[Ariadex] Panel attached`

These confirm ranking, panel rendering, and attachment success at runtime.
