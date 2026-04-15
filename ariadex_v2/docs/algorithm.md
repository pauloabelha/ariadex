# AriadeX v2 Algorithm

The AriadeX v2 algorithm now lives in `extension/algo.js`.

That file owns the pure logic for:

- tweet-id normalization
- cache adapter creation
- syndication fetch client creation
- tweet payload normalization
- `quote > reply` parent selection
- recursive root-path walking
- external reference canonicalization
- per-path reference deduplication and numbering

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
12. emit `done`

## Output artifact

The algorithm returns:

- `path`
  ordered root-to-explored tweets

- `references`
  canonical deduped references cited anywhere on that path

Each path tweet also carries:

- `outboundRelation`
  how that tweet points to its parent

- `referenceNumbers`
  the numbered references cited by that tweet
