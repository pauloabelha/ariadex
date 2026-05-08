# Reference Handling

AriadeX treats references as part of the evidence trail.

References are collected only from tweets on the resolved root path. Reply-chain references are not promoted into the main reference list yet, because the current artifact is organized around the path itself.

## Source Fields

AriadeX reads X API URL entities in this order:

1. `unwound_url`
2. `expanded_url`
3. `url`

It does not scrape free text, inspect media cards, or fetch destination pages.

## Canonicalization

The canonicalizer:

- trims whitespace
- rejects invalid URLs
- forces `https`
- removes fragments
- removes embedded credentials
- strips `www.`
- ignores `x.com`, `twitter.com`, and `t.co`
- strips most query parameters
- keeps `v` on YouTube watch URLs
- normalizes `youtu.be/<id>` to `youtube.com/watch?v=<id>`
- removes trailing slashes

The goal is stable identity, not perfect archival fidelity.

## Numbering

References are numbered in first-seen order across the root path:

```text
[1] first unique canonical URL
[2] second unique canonical URL
[3] third unique canonical URL
```

Repeated references reuse the same number.

Each path tweet stores its own local `referenceNumbers` array, so the path view can show inline markers beside the tweet that cited them.

## Reference Artifact

Each reference entry is shaped for UI and export use:

- canonical URL
- display URL or host
- reference number
- count of path tweets that cited it
- tweet ids that cited it when available

The JSON export preserves the same canonical list, making it suitable for downstream analysis or report generation.

## Practical Caveats

X URL entities are only as complete as the X API response. A link may be missing when:

- X did not expose it in `entities.urls`
- the tweet is inaccessible
- the link is only visible through a card
- the URL appears as plain text without an entity

When precision matters, use the reference tab as a strong starting point, not as a legal archive.
