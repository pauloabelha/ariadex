# UI Rendering

## Overview
Ariadex renders ranked conversation threads directly in-page after `◇ Explore` is clicked.

## Panel Injection Strategy
Ariadex uses deterministic floating placement:

1. attach panel directly to `document.body`
2. use fixed positioning (`top/right`) and high z-index

This guarantees visibility even when X sidebar selectors or layout change.

## Rendering Flow
1. Ensure panel exists (`ensurePanelExists`).
2. Render top ranked items (`renderTopThreads`) with:
   - rank position
   - author
   - text snippet
   - score
3. Keep panel container and update list contents on each Explore click.

## Interaction Model
Each row is clickable:

- finds tweet by `status/{id}` link (`findTweetElementById`)
- calls `scrollIntoView`
- applies temporary highlight class for visual focus

## Debug Logging
On Explore click, Ariadex logs:

- `[Ariadex] Ranking computed`
- `[Ariadex] Rendering panel`
- `[Ariadex] Panel attached`

These logs help diagnose rendering and placement issues quickly.
