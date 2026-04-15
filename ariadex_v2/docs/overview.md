# AriadeX v2 Overview

`ariadex_v2` is a clean-room prototype focused on one narrow product slice:

- click `Explore Path` on a tweet
- resolve the structural path from that tweet to root
- collect references cited along that path
- collect authors and mentioned users along that path
- render the path, references, and people in a floating panel

This version intentionally does not try to do ranking, branch selection, or full conversation mapping yet.

## Code layout

- `extension/algo.js`
  pure root-path, reference, and people logic

- `extension/background.js`
  Chrome service-worker shell around the algorithm

- `extension/content.js`
  button injection and panel rendering

## Current artifact

The background worker returns a small artifact:

- `path`
  ordered root-to-clicked tweet chain

- `references`
  deduped canonical references found on that path

- `people`
  deduped canonical X users found on that path
  from path authors plus explicit mentions

Each path tweet may also include:

- `referenceNumbers`
  the reference ids cited by that tweet

- `peopleHandles`
  the canonical X handles collected from that tweet

## Structural parent rule

Parent selection is deterministic:

1. quoted tweet
2. replied-to tweet
3. stop

That means a quote-of-a-reply first follows the quote target, then continues through that target's own ancestry.
