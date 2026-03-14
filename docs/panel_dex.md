# Ariadex Dex Panel

## Overview
The panel is now a tabbed "Dex" view over one conversation snapshot.

Tabs:
- `Thinkers`
- `Evidence`
- `People`
- `Context`

`Thinkers` remains the default tab for backward compatibility.

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
