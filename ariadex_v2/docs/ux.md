# UX Notes

The floating panel has three tabs:

- `Root Path`
- `References`
- `People`

The panel header also exposes:

- `Export`
- `Clear Cache`

The header itself is draggable, so the panel can be repositioned around the viewport.

## Root Path tab

Each tweet card shows:

- structural label such as `Root`, `Ancestor 2`, `Explored`
- relation to its parent such as `replied to Root` or `quoted Ancestor 3`
- author handle
- tweet text
- inline reference markers like `[1] [2]`
- tweet id

Clicking a tweet card navigates to that tweet on X.

## References tab

Each reference card shows:

- internal reference number
- canonical URL
- host/domain
- count of path tweets that cited it

Clicking a reference opens the canonical URL in a new tab.

## People tab

Each people card shows:

- profile picture when available
- handle
- display name
- profile URL
- source types such as `author` or `mention`
- count of path tweets where that handle appeared

Clicking a people card opens that X profile in a new tab.

## Export

`Export` downloads a JSON snapshot containing:

- `clickedTweetId`
- `exportedAt`
- `artifact`
