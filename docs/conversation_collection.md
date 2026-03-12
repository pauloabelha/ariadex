# Conversation Collection

## Overview
When the user clicks `◇ Explore`, Ariadex now builds a DOM-only conversation snapshot:

```js
{
  rootTweet: { ...tweetData },
  replies: [{ ...tweetData }, ...]
}
```

`rootTweet` is extracted from the clicked tweet container. `replies` are all other visible tweet containers discovered in the same local conversation scope.

## How Replies Are Detected
Ariadex uses existing tweet container selectors:

- `article[data-testid="tweet"]`
- `article[role="article"]`
- plus existing fallback selectors already used by injection

Collection flow:
1. Resolve clicked tweet via `closest(...)`.
2. Resolve a local scope (`section`, `main`, or nearest labeled container) to avoid scanning unrelated page areas.
3. Query visible tweet candidates in that scope.
4. Reuse `extractTweetData(tweetElement)` for every candidate.
5. Remove duplicates using URL-first identity, with fallback identity when URL is missing.

## Limitations of DOM-Only Crawling
- Only captures tweets currently rendered in the DOM.
- Misses collapsed, paginated, or not-yet-loaded replies.
- Cannot guarantee exact parent-child edges between replies.
- Subject to X DOM changes over time.

## Future Improvements
- Add hierarchical reply inference from indentation/DOM grouping heuristics.
- Track timeline mutation deltas to incrementally update conversation state.
- Add optional background/service-worker persistence for snapshot history.
- Introduce ranking over collected replies (engagement + graph heuristics).
