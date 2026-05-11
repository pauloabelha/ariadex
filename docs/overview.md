# Overview

AriadeX helps a reader inspect one tweet without falling into the whole feed.

It has two evidence-first workflows:

- `Explore Path`: how this tweet connects backward through quote/reply structure.
- `Top Takes`: which quote tweets around a source tweet most improve understanding.

The product is narrow on purpose. It is not a full graph crawler, a personalized feed, or an opaque AI summary.

## Mental Model

Explore Path treats the clicked tweet as the end of a path.

```text
root tweet -> ancestor tweet -> clicked tweet
```

Top Takes treats the clicked tweet as the source of quote-discourse.

```text
source tweet -> quote tweets -> ranked representative takes
```

These workflows share UI, storage, config, and X API infrastructure, but produce separate artifacts.

## Explore Path

Explore Path follows explicit X relationships backward:

1. quoted tweet
2. replied-to tweet
3. stop at root

It then enriches the path with:

- canonical external references
- authors and mentioned people
- reply pockets where path authors participate

Use this when you want to know how a tweet arrived in context.

## Top Takes

Top Takes ranks quote tweets only.

Replies to quote tweets may be used as context, but they are not ranked. Viewer follow status is not used. The ranking is objective: the score is based on apparent author/domain relevance, enough substance to contain reasoning, and external references.

Use this when you want a compact view of the best public quote-discourse around a source tweet.

The canonical Top Takes spec is [top_takes.md](top_takes.md).

## Generated Text

Reports and gists are optional layers over existing artifacts.

They should help reuse or communicate the artifact, not replace it. The artifact remains the source of truth.

## What AriadeX Is Good At

- Reconstructing one quote/reply path.
- Preserving visible evidence.
- Canonicalizing references.
- Surfacing relevant people.
- Finding compact reply pockets.
- Ranking objective quote-discourse.
- Exporting artifacts for debugging, notebooks, and reports.

## What AriadeX Is Not

- A replacement X client.
- A whole-conversation archive.
- A personalized recommendation system.
- A social graph database.
- A legal or archival capture tool.
- A claim-verification engine.

## Limitations

- X API visibility can differ from the web UI.
- Recent search can omit old, deleted, hidden, or inaccessible replies.
- Reference extraction depends on X API URL entities.
- Top Takes depends on quote-tweet endpoint visibility.
- Top Takes may skip direct-reply context when X rate-limits conversation fetches.
- The local report backend supports OpenAI-compatible chat completions only.
