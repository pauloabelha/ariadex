# AriadeX v2 Architecture

## Goal

This prototype implements only one product slice:

- start from a clicked tweet id
- recursively resolve its structural parent chain
- collect canonical references cited along that path
- collect canonical people found along that path
- collect reply chains across every tweet on the resolved root-to-explored path
- treat all authors on that path as valid participating responders
- keep only branches where one of those path authors participates
- trim each kept branch at the last tweet by any of those path authors
- render the root path, references, people, and replies

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

`extension/algo.js` now talks to the X API directly:

- `GET /2/tweets/{id}`
- `GET /2/tweets`
- `GET /2/tweets/search/recent?query=conversation_id:<id>`

The resolver requests only the fields needed for v2:

- `author_id`
- `conversation_id`
- `created_at`
- `entities`
- `referenced_tweets`
- `text`
- `users.id`
- `users.username`
- `users.name`
- `users.profile_image_url`

The content script reads the bearer token from browser local storage and sends it to the background worker for each resolution request.

## Cache Rule

Every tweet payload is cached by tweet id in `chrome.storage.local`.
Conversation fetches are also cached by `conversation_id` as lists of tweet ids.

Recursive lookup is:

1. normalize tweet id
2. check cache
3. fetch only on cache miss
4. persist immediately
5. continue to parent

So once a tweet id is seen, later path walks reuse it.
Once a conversation id is seen, later reply fetches can reuse that membership too.

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

## Reply Rule

Replies are collected from the X API conversation graph.

For the resolved root-to-explored path:

1. resolve the whole structural path normally
2. collect the canonical author set across every tweet on that path
3. for each path tweet, read its `conversation_id`
4. search `conversation_id:<id>` through the X API
5. fetch any missing referenced tweets that are needed to close visible reply edges
6. start from tweets that directly reply to that path tweet
7. walk descendant reply branches below those direct replies
8. keep only branches where any path author appears somewhere in the branch
9. trim each kept branch at the last tweet by any path author
10. store the branch together with its anchor tweet metadata in `replyChains`

This keeps the feature grounded in explicit reply edges instead of DOM heuristics.
It also means cached or API-visible tweets can differ from what the X UI is currently surfacing.

## Files

- `extension/background.js`
  background service worker
  owns Chrome message wiring, progress streaming, and cache clearing

- `extension/content.js`
  content script
  injects button, reads the bearer token, requests the artifact, renders panel, and exports JSON

- `extension/algo.js`
  pure algorithm module
  owns X API fetch client creation, cache adapters, root-path recursion, reference canonicalization, and reply-chain collection

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
- reply-chain collection from the X API conversation graph
- aggregation across every tweet on the resolved path
- filtering to branches where any path author participates
- trimming each kept branch at the last participating path-author tweet
- panel tabs and export behavior
