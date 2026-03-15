# Ariadex Dex Panel

## Overview
The panel is now a tabbed "Dex" view over one conversation snapshot.

Tabs:
- `Thinkers`
- `Evidence`
- `People`
- `Context`
- `Digest`

`Thinkers` remains the default tab for backward compatibility.

## Digest Tab
`Digest` is an on-demand article view backed by the graph-cache server.

Behavior:
- user clicks `Generate Article`
- extension requests `POST /v1/conversation-article`
- server reuses the cached snapshot, synthesizes article JSON, renders a PDF, and caches both
- panel renders the article sections and exposes `Download PDF`

The current digest is intentionally derived from the existing snapshot model:
- ranked human tweets
- root tweet context
- canonical non-X references

This keeps the feature useful now without blocking on the future branch-first discourse refactor.

## View Model
`buildDexViewModel(...)` returns:

```js
{
  sections: {
    fromNetwork,
    topThinkers,
    rankedEntries
  },
  evidence: EvidenceEntry[],
  people: {
    followed: PersonEntry[],
    others: PersonEntry[]
  },
  context: {
    nodeCount,
    rankedCount,
    replies,
    quotes,
    cousins
  }
}
```

## Evidence Canonicalization
Evidence entries are built from URLs found in tweet text.

Canonicalization rules:
- remove `#fragment`
- remove trackers (`utm_*`, `fbclid`, `gclid`, `ref`, `s`, etc.)
- normalize host to lowercase
- normalize X/Twitter status URLs to `https://x.com/<user>/status/<id>`

Each canonical URL becomes one evidence node with:
- citation count
- weighted citation score (sum of citing tweet ThinkerRank)
- citing tweet IDs (deduped, deterministic order)

## Cross-Linking
Thinker cards show short evidence chips (domain/url hints) for top cited artifacts in that tweet.

Evidence cards link out to the canonical URL.

## Stability Guarantees
- deterministic sorting and tie-breaks
- no duplicates across Thinkers sections
- feature parity with existing Thinkers output preserved
