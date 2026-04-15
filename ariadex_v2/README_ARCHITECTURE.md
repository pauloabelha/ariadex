# AriadeX v2 Architecture

## Goal

This prototype implements only one product slice:

- start from a clicked tweet id
- recursively resolve its structural parent chain
- collect canonical references cited along that path
- collect canonical people found along that path
- render the root path, references, and people

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

`extension/algo.js` uses X's public syndication payload:

- `https://cdn.syndication.twimg.com/tweet-result`

Only the fields needed for this slice are used:

- `id_str`
- `user.screen_name`
- `user.name`
- `user.profile_image_url_https`
- `text`
- `entities.urls[].expanded_url`
- `entities.user_mentions[].screen_name`
- `entities.user_mentions[].name`
- `entities.user_mentions[].profile_image_url_https`
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

## Reference Rule

References are collected only from tweets on the resolved root path.

For each path tweet:

1. read external URLs from `entities.urls`
2. canonicalize them
3. ignore internal X/Twitter/t.co links
4. dedupe repeated references across the whole path
5. assign stable 1-based reference numbers in first-seen order

Each path tweet keeps the list of reference numbers it cites, and the UI renders:

- inline markers like `[1] [2]` on the tweet card
- a `References` tab listing the canonical URLs

## People Rule

People are collected only from tweets on the resolved root path.

For each path tweet:

1. collect the tweet author
2. collect explicit `entities.user_mentions`
3. canonicalize each user by X handle
4. merge duplicates across the whole path
5. keep the best available display name and avatar URL seen for that handle

The UI renders a `People` tab listing:

- handle
- display name
- avatar when available
- profile URL
- source types and path-tweet count

## Files

- `extension/background.js`
  background service worker
  owns Chrome message wiring, progress streaming, and cache clearing

- `extension/content.js`
  content script
  injects button, requests root path, renders panel, and exports JSON

- `extension/algo.js`
  pure algorithm module
  owns fetch client creation, cache adapters, root-path recursion, and reference canonicalization

- `extension/styles.css`
  minimal panel and button styling

## Testing Focus

The test suite should lock down:

- quote-precedence parent selection
- root-path recursion order
- cycle protection
- cache hit before network
- label formatting like `Ancestor 5 (replied to Ancestor 4)`
- reference canonicalization and deduplication
- per-tweet reference numbering
- people aggregation across authors and mentions
- person display names and avatars when present
- panel tabs and export behavior
