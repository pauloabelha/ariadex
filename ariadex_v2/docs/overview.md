# AriadeX v2 Overview

`ariadex_v2` is a clean-room prototype focused on one narrow product slice:

- click `Explore Path` on a tweet
- resolve the structural path from that tweet to root
- collect references cited along that path
- collect authors and mentioned users along that path
- collect reply chains for every tweet on that root-to-explored path from the X API conversation graph
- treat every author on that path as a valid participating responder
- keep only branches where one of those path authors participates
- trim each kept branch at the last participating path-author tweet
- render the path, references, people, and replies in a floating panel

This version intentionally does not try to do ranking, branch selection, or full conversation mapping yet.

## Code layout

- `extension/algo.js`
  X-API-backed root-path, reference, people, and reply-chain logic

- `extension/background.js`
  Chrome service-worker shell around the algorithm

- `extension/content.js`
  button injection, bearer-token lookup, and panel rendering

## Current artifact

The background worker returns a small artifact:

- `path`
  ordered root-to-clicked tweet chain

- `references`
  deduped canonical references found on that path

- `people`
  deduped canonical X users found on that path
  from path authors plus explicit mentions

- `replyChains`
  aggregated reply chains from conversations anchored at tweets along the resolved path
  kept only when one of the path authors appears somewhere in the branch
  and trimmed at that path author's last tweet in the branch
  with `anchorTweetId` and `anchorAuthor` identifying which path node the chain replies to

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
