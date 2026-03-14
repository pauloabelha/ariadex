# Conversation Collection

## Overview
Collection lives in the `data/` layer.

- `data/dom_collector.js` handles tweet extraction from X DOM and optional local root hints.
- `data/x_api_client.js` resolves canonical roots and retrieves connected tweets from the X API.

Both modules normalize output so `core/` receives a consistent tweet schema.

## Unified Tweet Schema

```js
{
  id,
  author_id,
  author,
  author_profile,
  text,
  referenced_tweets,
  metrics,
  reply_to,
  quote_of,
  repost_of,
  replies,
  reposts,
  likes,
  quote_count
}
```

`author_profile` includes API user metadata used by ranking/UI:
- `username`, `name`, `description`
- `verified`, `verified_type`
- `public_metrics` (including `followers_count`)
- `profile_image_url` (used for panel avatars)

## Canonical Root Resolution
Canonicalization happens before graph retrieval:
1. if clicked tweet quotes another tweet, quoted tweet is root
2. otherwise follow `replied_to` links upward until origin
3. DOM ancestor hint can seed the starting id

Implemented in `resolveCanonicalRootTweetId(...)` inside `data/x_api_client.js`.

## X API Endpoints
Ariadex uses:
- `GET /2/tweets/{id}` for root/reply-chain lookup
- `GET /2/tweets/search/recent?query=conversation_id:<root>` for replies
- `GET /2/tweets/{id}/quote_tweets` for quote branches
- `GET /2/tweets/{id}/retweeted_by` for repost users
- `GET /2/tweets` for missing referenced tweets
- `GET /2/users` for missing author metadata

Reposts are represented as deterministic synthetic events:
- `id = repost:<rootTweetId>:<userId>`
- `type = repost_event`

## Pagination and Limits
`data/x_api_client.js` enforces configurable safety limits:
- `maxPagesPerCollection`
- `maxResultsPerPage`
- `maxConversationRoots`
- `maxConnectedTweets`
- request timeout

This keeps collection bounded and predictable under rate limits.

## Data -> Core Boundary
`buildConversationDataset(...)` returns:

```js
{
  canonicalRootId,
  tweets,
  users,
  rootTweet,
  warnings
}
```

`core/conversation_engine.js` consumes `tweets` directly.
