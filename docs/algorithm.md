# AriadeX Algorithm

The algorithm lives in `extension/algo.js`. It is the heart of AriadeX and is designed to be testable without Chrome.

## Inputs

The resolver needs:

- clicked tweet id
- X API bearer token
- optional X API base URL
- cache adapter
- progress callback

The content script obtains the clicked tweet id from the page and sends it to the background service worker. The service worker loads runtime config and calls the algorithm.

## Tweet Fetching

The X API client uses:

- `GET /2/tweets/{id}` for single tweet lookup
- `GET /2/tweets` for batch lookup
- `GET /2/tweets/search/recent?query=conversation_id:<id>` for reply collection

Requested tweet fields include:

- `author_id`
- `conversation_id`
- `created_at`
- `entities`
- `in_reply_to_user_id`
- `referenced_tweets`
- `text`

Requested user fields include:

- `id`
- `username`
- `name`
- `profile_image_url`

## Root Path Resolution

For each tweet:

1. Normalize the tweet id.
2. Fetch from cache or network.
3. Normalize the tweet payload into the AriadeX shape.
4. Choose the parent:
   - quoted tweet first
   - replied-to tweet second
   - stop otherwise
5. Append the tweet to the raw path.
6. Continue until the root is reached.
7. Stop early if a cycle is detected.
8. Reverse the raw path so it reads root-to-explored.

The parent rule is deliberately simple. Quote edges carry stronger context than reply edges, so they win when both are present.

## Reference Pass

After path resolution, the algorithm reads external URLs from every path tweet.

For each URL:

1. Select the best X API URL field.
2. Canonicalize the URL.
3. Ignore internal X, Twitter, and `t.co` links.
4. Deduplicate across the full path.
5. Assign a stable 1-based reference number.
6. Store local reference numbers on each path tweet.

This lets the path tab show compact markers such as `[1] [3]` while the references tab holds the canonical URL list.

## People Pass

The people pass collects:

- each path tweet author
- each explicit `entities.user_mentions` entry

People are deduped by canonical handle. For each handle, AriadeX keeps the best available display name, avatar URL, profile URL, source types, and path-tweet count.

## Reply Chain Pass

Reply chains are collected after the root path is known.

For each path tweet:

1. Read its `conversation_id`.
2. Fetch the conversation search results.
3. Build reply edges from referenced tweet metadata.
4. Find direct replies to the path tweet.
5. Treat each direct reply as the root of one candidate subtree.
6. Walk descendants under that candidate root.
7. Keep the subtree only if at least one path author appears inside it.
8. Trim the subtree at the last tweet by any path author.
9. Store anchor metadata:
   - `anchorTweetId`
   - `anchorAuthor`

This produces reply pockets that are local to the explored path instead of a huge unranked conversation dump.

## Progress Events

The algorithm emits progress so the panel can explain what is happening:

- start
- path walking
- reference canonicalization
- people aggregation
- reply collection
- done

Report and gist generation emit their own backend progress events from the background service worker.

## Failure Behavior

AriadeX prefers explicit failure over silent invention.

- Missing bearer token stops X API resolution.
- Network errors surface in the panel.
- Missing OpenAI key stops report or gist generation.
- Empty model output is treated as an error.
- Cache can be cleared from the panel when API state looks stale.

## Example

Suppose the path is:

```text
Root -> Ancestor 1 -> Explored
```

If `Ancestor 1` has three direct replies, AriadeX evaluates three candidate reply chains. A candidate is kept only when one of the path authors appears somewhere in that subtree. If the path author appears halfway down the subtree, the chain is trimmed there.

The result stays compact, grounded, and explainable.
