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
   - derives a path-anchored conversation artifact JSON from mandatory path tweets, selected branches, and canonical non-X references
   - asks the model only for minimal narrative metadata (`title`, `dek`, `summary`)
   - builds the final digest sections deterministically from the artifact
  - uses a configured OpenAI-compatible LLM endpoint when available, otherwise falls back to deterministic local article generation
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
    "usedLlm": true,
    "llmProvider": "openai",
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

`incremental` no longer means “refresh the whole conversation root”.
It now means:
- on cache miss: build a full root bag
- on cache hit: hydrate only missing path tweets, if any

## Conversation Artifact

The snapshot now carries a path-anchored JSON artifact intended to be the canonical LLM-facing input:

```js
{
  version: "path-anchored/v1",
  exploredTweetId,
  canonicalRootId,
  rootTweet: { id, author, text, replyTo, quoteOf, likes, replies, quotes, followers, importanceScore, url },
  mandatoryPath: [
    { id, author, text, replyTo, quoteOf, likes, replies, quotes, followers, importanceScore, url }
  ],
  expansions: [
    {
      depth,
      tweets: [
        { id, author, text, relationType, parentId, importanceScore, ... }
      ]
    }
  ],
  selectedTweets: [
    { id, author, text, replyTo, quoteOf, likes, replies, quotes, followers, importanceScore, url }
  ],
  references: [
    {
      canonicalUrl,
      displayUrl,
      domain,
      kind,
      citationCount,
      weightedCitationScore,
      citedByTweetIds
    }
  ],
  diagnostics: {
    totalCollectedTweetCount,
    selectedTweetCount,
    mandatoryPathLength,
    expansionDepthCount,
    referenceCount
  }
}
```

This artifact is designed to be:

- deterministic
- JSON-only
- cacheable
- safe to reuse as the direct input to an LLM digest step

Artifact semantics:
- `mandatoryPath` is the required ancestor chain from root to explored tweet
- `expansions` are recursive important branches selected from replies/quotes to path/frontier tweets
- `references` are canonical non-X references cited anywhere in selected tweets, including entity-backed external URLs from ancestor tweets

## Article Input Model
The article generator now sends a reduced model input centered on the artifact:

```js
{
  artifact,
  canonicalRootId,
  metrics: {
    collectedTweetCount,
    rankedTweetCount,
    referenceCount
  },
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

- the model is not responsible for quote layout or branch ordering
- quote rendering comes from the artifact, not model output
- canonical references exclude X/Twitter URLs
- article generation is grounded in structured data and the path-anchored artifact, not raw tweet dumps

## LLM Behavior
If an LLM endpoint is configured, Ariadex uses the article generator model.

The model is asked to return strict JSON in this minimal schema:

```json
{
  "title": "...",
  "dek": "...",
  "summary": "..."
}
```

The final digest section order is built locally from the artifact:

- `Original tweet`
- `Why this appeared`
- `Ancestor path`
- `Important replies and branches`
- `Evidence`
- `Digest summary`

The renderer treats:
- source tweet text as source material
- model text as connective narrative only

This is why the model schema is intentionally minimal.

Model selection:

- `ARIADEX_LOCAL_ARTICLE_MODEL` when `ARIADEX_LOCAL=true`
- fallback: `ARIADEX_LOCAL_MODEL` when `ARIADEX_LOCAL=true`
- `ARIADEX_LLM_ARTICLE_MODEL`
- fallback: `ARIADEX_OPENAI_ARTICLE_MODEL`
- fallback: `ARIADEX_LLM_MODEL`
- `ARIADEX_OPENAI_ARTICLE_MODEL`
- fallback: `ARIADEX_OPENAI_MODEL`
- fallback: `gpt-4o-mini`

Endpoint selection:

- `ARIADEX_LOCAL_BASE_URL` when `ARIADEX_LOCAL=true`
- fallback local default from [`ariadex.config.json`](/home/pauloabelha/ariadex/ariadex.config.json)
- `ARIADEX_LLM_BASE_URL`
- fallback: `ARIADEX_OPENAI_BASE_URL`
- fallback: `https://api.openai.com/v1`

Auth selection:

- `ARIADEX_LOCAL_API_KEY` when `ARIADEX_LOCAL=true`
- `ARIADEX_LLM_API_KEY`
- fallback: `OPENAI_API_KEY`
- localhost endpoints may omit an API key

If the configured LLM is unavailable or returns invalid output:

- Ariadex logs the failure
- Ariadex falls back to deterministic local digest generation
- PDF generation still succeeds

This keeps the feature usable in local dev and cheap environments.

Local Gemma note:
- in a live smoke test against local `llama-server`, the contribution filter produced usable JSON classifications
- the article step still fell back cleanly because the model output did not satisfy Ariadex's strict `{"title","dek","summary"}` JSON contract on that run
- the repo's tested local default endpoint is `http://127.0.0.1:8091/v1`

## Caching
Article generation uses the snapshot cache as its base identity.

Cache layering:

- snapshot cache key: existing conversation snapshot key
- article cache key: `hash(snapshotCacheKey + article signature + clickedTweetId + rootHintTweetId + pdf version)`

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

Snapshot cache persistence:
- file-backed disk cache in `.cache/graph_cache_store.json`
- survives server restarts
- known tweets are reused rather than re-collected

Snapshot cache refresh semantics:
- Ariadex does not re-scan the full conversation root on cache hits
- Ariadex only fetches missing path tweets not already present in the cached dataset

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
- the model still returns freeform summary text rather than a fully typed rhetorical analysis schema
- PDF output is basic and text-heavy
- native media/video evidence is still less complete than a fully media-aware evidence graph
- digest generation is on-demand, not precomputed during snapshot build
- article response does not yet expose branch objects or context-chain objects

## Next Step
Promote the path-anchored artifact to the single source of truth for both digest generation and downstream export, so the article generator becomes a thin renderer over the artifact rather than rebuilding structure internally.
