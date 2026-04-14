# AriadeX v2 Architecture

## Goal

This prototype implements only one product slice:

- start from a clicked tweet id
- recursively resolve its structural parent chain
- render only that root path

## Parent Rule

The parent rule is deterministic:

1. if the tweet quotes another tweet, parent is the quoted tweet
2. else if the tweet replies to another tweet, parent is the replied-to tweet
3. else the tweet is the root

This means a quote-of-a-reply walks:

- clicked quote tweet
- quoted tweet
- then that quoted tweet's own reply ancestry

## Data Source

`extension/background.js` uses X's public syndication payload:

- `https://cdn.syndication.twimg.com/tweet-result`

Only the fields needed for this slice are used:

- `id_str`
- `user.screen_name`
- `text`
- `quoted_tweet.id_str`
- `in_reply_to_status_id_str`

## Cache Rule

Every tweet payload is cached by tweet id in `chrome.storage.local`.

Recursive lookup is:

1. normalize tweet id
2. check cache
3. fetch only on cache miss
4. persist immediately
5. continue to parent

So once a tweet id is seen, later path walks reuse it.

## Files

- `extension/background.js`
  background service worker
  owns fetch + cache + recursive root-path resolution

- `extension/content.js`
  content script
  injects button, requests root path, renders panel

- `extension/styles.css`
  minimal panel and button styling

## Testing Focus

The test suite should lock down:

- quote-precedence parent selection
- root-path recursion order
- cycle protection
- cache hit before network
- label formatting like `Ancestor 5 (replied to Ancestor 4)`

