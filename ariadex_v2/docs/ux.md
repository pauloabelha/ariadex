# UX Notes

The floating panel has two tabs:

- `Root Path`
- `References`

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

