# Article Digest And PDF Export

## Purpose
Ariadex now supports a second consumption mode in addition to the live panel:

- generate a structured article digest from one conversation snapshot
- render that digest to a downloadable PDF

The goal is not to replace panel exploration. The goal is to let users:

- understand a conversation faster
- save a durable artifact
- reopen a digest without re-paying the full collection/synthesis cost

## Product Flow
1. User clicks `◇ Explore`.
2. Ariadex builds or loads a cached snapshot.
3. In the `Digest` tab, the user clicks `Generate Article`.
4. The extension requests `POST /v1/conversation-article`.
5. The graph-cache server:
   - reuses the snapshot cache
   - derives structured article input from ranked human tweets + canonical non-X references
   - uses OpenAI when available, otherwise falls back to deterministic local article generation
   - renders a PDF
   - caches both article JSON and PDF payload
6. The panel renders the digest and exposes `Download PDF`.

## API Contract
Endpoint:

```text
POST /v1/conversation-article
```

Request body:

```json
{
  "clickedTweetId": "123",
  "rootHintTweetId": "123",
  "mode": "deep",
  "force": false,
  "incremental": true,
  "followingIds": ["42"],
  "viewerHandles": ["pauloabelha"]
}
```

Response body:

```json
{
  "article": {
    "title": "…",
    "dek": "…",
    "summary": "…",
    "sections": [
      { "heading": "…", "body": "…" }
    ],
    "references": [
      {
        "canonicalUrl": "https://example.com/doc",
        "displayUrl": "https://example.com/doc",
        "domain": "example.com",
        "citationCount": 3
      }
    ],
    "usedOpenAi": true,
    "model": "gpt-4o-mini"
  },
  "pdf": {
    "filename": "ariadex-123.pdf",
    "mimeType": "application/pdf",
    "base64": "<base64>",
    "byteLength": 12345
  },
  "snapshot": { "...": "same snapshot shape as /v1/conversation-snapshot" },
  "cache": {
    "hit": true,
    "key": "…",
    "snapshotKey": "…"
  }
}
```

The PDF is returned as base64 because the current extension bridge is JSON-only.

## Article Input Model
The article generator currently derives a compact input from the existing snapshot model:

```js
{
  canonicalRootId,
  rootTweet,
  metrics: {
    collectedTweetCount,
    rankedTweetCount,
    referenceCount
  },
  topTweets: [
    { id, author, text, score, reply_to, quote_of }
  ],
  references: [
    {
      canonicalUrl,
      displayUrl,
      domain,
      citationCount,
      weightedCitationScore,
      citedByTweetIds
    }
  ]
}
```

Important constraints:

- only human tweets are included
- synthetic repost nodes are excluded
- canonical references exclude X/Twitter URLs
- article generation is grounded in structured data, not raw tweet dumps

## OpenAI Behavior
If `OPENAI_API_KEY` is available, Ariadex uses the article generator model:

- `ARIADEX_OPENAI_ARTICLE_MODEL`
- fallback: `ARIADEX_OPENAI_MODEL`
- fallback: `gpt-4o-mini`

If OpenAI is unavailable or returns invalid output:

- Ariadex logs the failure
- Ariadex falls back to deterministic local digest generation
- PDF generation still succeeds

This keeps the feature usable in local dev and cheap environments.

## Caching
Article generation uses the snapshot cache as its base identity.

Cache layering:

- snapshot cache key: existing conversation snapshot key
- article cache key: `hash(snapshotCacheKey + article signature + pdf version)`

Cached article entries store:

```js
{
  article,
  pdf
}
```

This means:

- article/PDF generation does not refetch X data when snapshot cache is warm
- changes in article model/signature invalidate article cache cleanly
- snapshot and article artifacts can evolve independently

## UI Contract
The panel now includes:

- `Thinkers`
- `Evidence`
- `People`
- `Context`
- `Digest`

`Digest` states:

- empty: show `Generate Article`
- loading: show article generation progress
- ready: render title, dek, summary, sections, and `Download PDF`

## PDF Rendering Notes
The current PDF renderer is intentionally minimal:

- server-side
- deterministic
- text-only
- no browser dependency

This is a first pass, optimized for reliability and cheap generation rather than typography.

## Current Limitations
- article generation still summarizes the current root-centered snapshot model, not the future branch-centered discourse model
- PDF output is basic and text-heavy
- digest generation is on-demand, not precomputed during snapshot build
- article response does not yet expose branch objects or context-chain objects

## Next Step
When Ariadex moves to a `seed + branches + references + context_chain` snapshot model, the article generator should switch to that richer input without changing the panel contract.
