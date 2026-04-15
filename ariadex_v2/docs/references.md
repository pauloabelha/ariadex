# Reference Handling

References are collected only from tweets on the resolved root path.

## Source field

v2 currently reads:

- `entities.urls[].expanded_url`

It does not yet inspect richer cards, media attachments, or free-text URL scraping beyond what the syndication payload exposes as URL entities.

## Canonicalization rules

The current canonicalizer does the following:

- trims whitespace
- rejects invalid URLs
- forces `https`
- removes fragments
- removes embedded credentials
- strips `www.`
- ignores internal `x.com`, `twitter.com`, and `t.co` links
- strips most query params
- keeps `v` for YouTube watch URLs
- normalizes `youtu.be/<id>` to `youtube.com/watch?v=<id>`
- removes trailing slashes

## Numbering

References are numbered in first-seen order across the resolved root path:

- first unique canonical reference is `[1]`
- next new canonical reference is `[2]`
- repeated references reuse the existing number

Each tweet stores the numbers it cites so the path tab can show markers like:

- `[1]`
- `[1] [3]`

The current export feature writes the full current artifact as JSON, so the same
canonical reference list is preserved outside the panel together with:

- `path`
- `references`
- `people`
