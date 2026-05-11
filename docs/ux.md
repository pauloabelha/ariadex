# UX

AriadeX should feel like a compact investigation panel, not a second feed.

The user is already reading X. AriadeX should add context beside the timeline, preserve evidence, and make long-running work legible.

## Product Feel

- One click starts useful work.
- Progress is specific, not theatrical.
- Cache reuse feels instant.
- Slow network/model work explains itself.
- Failures are plain and recoverable.
- Generated prose never hides the source artifact.

## Entry Points

Tweet cards get two sibling actions:

- `Explore Path`: reconstruct quote/reply ancestry and local context.
- `Top Takes`: rank objective quote-discourse around the selected tweet.

The workflows share the same panel but produce different artifacts.

## Panel

The floating panel is:

- draggable from the header
- compact enough to sit beside the timeline
- stateful across rerenders
- organized by tabs

Header actions:

- `Export`
- `Generate Report`
- `Generate Gist`
- `Clear Cache`

## Tabs

Explore Path tabs:

- `Root Path`: root-to-clicked chain with structural labels and reference markers.
- `References`: canonical external links cited by path tweets.
- `People`: path authors and mentioned users.
- `Replies`: anchored reply pockets where path authors participate.

Top Takes tab:

- `Top Takes`: one ranked list of representative quote tweets.

Generated tabs:

- `Gist`: portable short-form generated text.
- `Report`: longer generated explanation.

## Top Takes Cards

Each card should make the reason for selection inspectable.

Show:

- quote tweet author
- quote tweet text
- domain pill, such as `Expert` or `Adjacent`
- role pill, such as `Skepticism`, `Evidence`, or `Operational`
- `Reference` pill when applicable
- score pills for relevant ranking fields
- concise explanation
- domain/expertise evidence when available
- tweet metadata

Do not split Top Takes into top-level Expert/Adjacent sections. The ranked list is the product; pills explain the ranking.

Top Takes must remain objective. Do not use viewer follow graph, likes, lists, bookmarks, or private relationship signals for ranking.

## Progress

Progress messages should name real stages.

Explore Path examples:

- resolving path
- collecting references
- collecting people
- collecting replies
- ready

Top Takes examples:

- using cached source tweet
- fetching quote tweets from X
- using cached quote tweets
- waiting for X rate limit reset
- collecting optional top replies
- continuing without reply context
- sending batch to OpenAI with estimated remaining time
- OpenAI batch finished
- selecting representative takes
- reconnecting and resuming from cache
- ready

The UI should never look frozen while AriadeX is intentionally waiting.

## Export

`Export` downloads the current artifact as JSON.

The export is the best handoff format for debugging, notebooks, and later analysis. It should preserve score fields, cache metadata, model metadata, timing metadata, and the raw evidence needed to inspect why the UI rendered what it rendered.

## Generated Text

Reports and gists are optional.

They should:

- use the current artifact
- be copyable/downloadable
- keep model/provider metadata visible
- never replace the evidence tabs

## UX Principles

- Keep the artifact visible.
- Keep Top Takes grounded in quote tweets.
- Keep Top Takes objective.
- Prefer explicit labels over clever prose.
- Make stale data easy to clear.
- Make resumed/cached work obvious.
