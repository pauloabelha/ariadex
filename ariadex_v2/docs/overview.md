# AriadeX v2 Overview

`ariadex_v2` is a clean-room prototype focused on one narrow product slice:

- click `Explore Path` on a tweet
- resolve the structural path from that tweet to root
- collect references cited along that path
- collect authors and mentioned users along that path
- collect reply chains for every tweet on that root-to-explored path from the X API conversation graph
- define each reply chain as one direct-reply subtree anchored under one path tweet
- treat every author on that path as a valid participating responder
- keep only anchored subtrees where one of those path authors participates
- trim each kept subtree at the last participating path-author tweet
- render the path, references, people, and replies in a floating panel
- send the artifact to a local AriadeX report backend for narrative report generation

This version intentionally does not try to do ranking, branch selection, or full conversation mapping yet.

## Code layout

- `extension/algo.js`
  X-API-backed root-path, reference, people, and reply-chain logic

- `extension/background.js`
  Chrome service-worker shell around the algorithm plus report-backend calls

- `extension/content.js`
  button injection, bearer-token lookup, and panel rendering

- `server/report_backend.js`
  local HTTP backend that reads the prompt and calls OpenAI

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
  aggregated anchored reply subtrees from conversations touched by tweets along the resolved path
  where each chain starts from one direct reply to one path tweet
  kept only when one of the path authors appears somewhere in that subtree
  and trimmed at the last path-author tweet inside that subtree
  with `anchorTweetId` and `anchorAuthor` identifying which path node the chain replies to

- `report`
  generated on demand by the local report backend rather than during root-path resolution
  returned as narrative text plus provider and endpoint metadata
  and surfaced in the panel with staged progress plus copy/download actions

## Mental model

Think of the output as two linked views of one explored tweet:

- `path`
  the structural spine from root to explored tweet using the deterministic `quote > reply` parent rule

- `replyChains`
  local audience or participant response pockets hanging off nodes on that spine

So the root path answers:
"How did this explored tweet structurally get here?"

The reply chains answer:
"What reply subtrees formed underneath tweets on that path, and where did a path author join those subtrees?"

The generated report answers:
"How can this whole artifact be restated as one coherent explanation someone can read or listen to?"

The extension does not call OpenAI or any other frontier provider directly.
It only calls the local AriadeX report backend, which keeps the OpenAI key on
the server side.

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
