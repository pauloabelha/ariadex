# AriadeX v2 Algorithm

The AriadeX v2 algorithm now lives in `extension/algo.js`.

That file owns the pure logic for:

- tweet-id normalization
- cache adapter creation
- X API fetch client creation
- tweet payload normalization
- person handle/display-name/avatar normalization
- `quote > reply` parent selection
- recursive root-path walking
- external reference canonicalization
- per-path reference deduplication and numbering
- per-path people deduplication by canonical X handle
- reply-chain collection from `conversation_id`
- artifact assembly for on-demand report generation

## Why this split exists

`extension/background.js` is now just the Chrome runtime shell:

- receive messages and ports from the content script
- call the algorithm module
- stream progress back to the panel
- expose cache clearing

This keeps the important logic easy to test under Node without Chrome runtime setup.

## Resolver flow

Given a clicked tweet id:

1. normalize the tweet id
2. emit `start`
3. fetch the tweet from cache or network
4. normalize it into the small v2 shape
5. choose the parent with `quote > reply`
6. append the current tweet to the raw path
7. emit `path_walk`
8. repeat until no parent or a cycle is found
9. emit `canonicalizing_refs`
10. reverse into root-to-explored order
11. canonicalize and dedupe references across that path
12. dedupe path authors and mentions into canonical `people`
13. collect the canonical author set across the resolved path
14. for each tweet on that path, fetch the matching X API conversation
15. start from each direct reply to that path tweet
16. walk the full descendant subtree below that direct reply
17. treat that direct-reply subtree as one candidate reply chain
18. keep only candidate chains where any resolved-path author appears
19. trim each kept chain at the last tweet by any resolved-path author
20. annotate each kept chain with its anchor tweet metadata
21. emit `done`

In other words:

- the root path is a single structural chain
- the reply side is a set of anchored subtrees hanging off tweets in that chain
- each kept subtree becomes one `replyChain`

## Report generation flow

The report is not part of root-path resolution itself.

After the artifact exists:

1. the content script sends the current artifact to the background worker
2. the background worker loads `reportBackendBaseUrl` from generated config
3. the worker emits report-progress events back to the panel
4. the worker posts the artifact to the local AriadeX report backend
5. the backend loads the saved prompt and calls OpenAI
6. the returned text is stored in panel state and rendered in the `Report` tab with copy/download actions

This keeps the resolver deterministic while making the narrative layer optional.

## Output artifact

The algorithm returns:

- `path`
  ordered root-to-explored tweets

- `references`
  canonical deduped references cited anywhere on that path

- `people`
  canonical deduped people found anywhere on that path
  collected from:
  - tweet authors on the path
  - explicit `user_mentions` on path tweets

- `replyChains`
  aggregated anchored reply subtrees rooted in direct replies to tweets along the resolved path
  where each chain represents:
  - one anchor path tweet
  - one direct reply to that anchor
  - all descendants reachable below that direct reply
  filtered to branches containing at least one resolved-path author
  trimmed at the last tweet by a resolved-path author
  and annotated with:
  - `anchorTweetId`
    which root/ancestor/explored path node the chain replies to
  - `anchorAuthor`
    the canonical handle of that anchor tweet's author

Each path tweet also carries:

- `outboundRelation`
  how that tweet points to its parent

- `referenceNumbers`
  the numbered references cited by that tweet

- `peopleHandles`
  canonical X handles collected from that tweet

## Example shape

If the path is:

`Root -> Ancestor 1 -> Explored`

and `Ancestor 1` has three direct replies:

- reply `A`
- reply `B`
- reply `C`

then the algorithm evaluates three separate candidate reply chains under `Ancestor 1`:

- subtree rooted at `A`
- subtree rooted at `B`
- subtree rooted at `C`

If only the subtree under `B` contains a tweet by any author from the resolved path,
only that subtree is kept. If the last such participating tweet in subtree `B` is halfway
down the subtree, everything after that point is trimmed away.
