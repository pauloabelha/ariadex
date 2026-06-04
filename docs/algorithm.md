# Algorithm

The core implementation lives in `extension/algo.js`. It is written as plain JavaScript so the same logic can run in the Chrome extension and in Node tests.

This document is an implementation map. Product-level Top Takes rules live in [top_takes.md](top_takes.md).

## Shared Inputs

Most algorithm entry points receive:

- tweet id or artifact input
- cache/storage adapter
- X API client
- optional progress callback
- workflow options

The content script extracts tweet ids from the page. The background service worker loads config, creates adapters, and calls into `algo.js`.

## X API Client

`createTweetClient(...)` wraps X API requests.

Endpoints used:

- `GET /2/tweets/{id}` for single tweet lookup
- `GET /2/tweets` for batch tweet lookup
- `GET /2/tweets/search/recent` for conversation/reply collection
- `GET /2/tweets/search/all` when available for conversation/reply collection
- `GET /2/tweets/{id}/quote_tweets` for Top Takes quote collection

Requested tweet fields include author, conversation, creation time, entities, reply/quote references, public metrics, and text.

Requested user fields include id, username, name, profile image, description, public metrics, and verification metadata.

Rate-limited X requests emit progress and retry when possible.

## Explore Path

Primary entry point: `resolveRootPath(...)`.

For each path step:

1. Normalize tweet id.
2. Read tweet cache.
3. Fetch from X only on cache miss.
4. Normalize payload.
5. Select parent:
   - quoted tweet first
   - replied-to tweet second
   - stop otherwise
6. Stop on root or cycle.
7. Reverse the raw path to root-to-clicked order.

The quote-first parent rule keeps quote-of-reply chains deterministic.

## Enrichment Passes

After the raw path is known:

- `buildReferenceArtifact(...)` canonicalizes external URLs from path tweets.
- `buildPeopleArtifact(...)` dedupes authors and mentioned users.
- `collectReplyChainsForAnchorTweets(...)` collects local reply pockets where path authors appear.

Reference rules are documented in [references.md](references.md).

## Top Takes

Primary entry point: `resolveTopTakes(...)`.

Implementation stages:

1. Read final artifact cache.
2. Fetch or cache-hit the source tweet.
3. Fetch or cache-hit quote tweets.
4. Normalize and dedupe candidates.
5. Attach optional top direct replies as context.
6. Read OpenAI analysis cache.
7. Classify uncached batches with OpenAI.
8. Record OpenAI batch timing.
9. Add deterministic discourse-quality scores for reasoning density, grounding, and perspective uniqueness.
10. Score and select representative quote tweets with a small role/domain coverage bonus.
11. Write analysis and artifact caches.

Important helpers:

- `readQuoteTweetsForSource(...)`
- `dedupeQuoteTweets(...)`
- `attachTopCommentsToQuoteTweets(...)`
- `selectThreadContinuationsForTweet(...)`
- `selectQuotesForConversationContext(...)`
- `buildTopTakesCandidateBatch(...)`
- `normalizeTopTakesClassification(...)`
- `groupTopTakes(...)`
- `summarizeOpenAiBatchTimings(...)`
- `estimateOpenAiRemainingMs(...)`

See [top_takes.md](top_takes.md) for candidate rules, ranking formula, objective-ranking constraints, caching, and progress behavior.

## Progress Events

Progress events are workflow-specific and should map to visible user stages.

Explore Path emits:

- start
- path walking
- reference canonicalization
- people aggregation
- reply collection
- done

Top Takes emits:

- source/quote cache hit and miss events
- X rate-limit waits
- discourse normalization
- optional reply-context collection
- OpenAI batch start/finish/timing estimates
- grouping and selection
- ready

The content script owns user-facing text for these events.

## Failure Behavior

AriadeX prefers explicit failure over silent invention.

- Missing X token stops X API workflows.
- Missing OpenAI key stops model-backed workflows.
- X `429` rate limits retry with visible waits.
- Top Takes can continue without reply context when that optional stage remains rate-limited.
- Top Takes can fall back from a disconnected progress port to a normal runtime message.
- Empty or invalid OpenAI output is treated as an error.

## Test Strategy

Algorithm code should stay testable without Chrome. Chrome-specific behavior belongs in thin content/background adapters and is tested with small mocks.
