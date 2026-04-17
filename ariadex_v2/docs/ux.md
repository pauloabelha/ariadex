# UX Notes

The floating panel has four tabs:

- `Root Path`
- `References`
- `People`
- `Replies`

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

## Replies tab

Each reply card shows:

- the number of tweets collected into that reply chain
- which path branch the chain belongs to, such as `Root`, `Ancestor 2`, or `Explored`
- which anchor author that chain replies to
- one card per tweet in the collected chain
- the tweet ids included in that trimmed chain

These chains are aggregated from the X API conversation graphs for tweets across
the full root-to-explored path. A branch is shown only if one of the path
authors participates somewhere in it, and the branch is trimmed at the last
tweet by any of those path authors.

Clicking a tweet card navigates to that specific tweet on X.

## Export

`Export` downloads a JSON snapshot containing:

- `clickedTweetId`
- `exportedAt`
- `artifact`
