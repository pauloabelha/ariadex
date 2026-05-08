# UX Notes

The floating panel has four primary artifact tabs:

- `Root Path`
- `References`
- `People`
- `Replies`

After report generation succeeds, a fifth tab appears:

- `Report`

The panel header also exposes:

- `Export`
- `Generate Report`
- `Clear Cache`

The header itself is draggable, so the panel can be repositioned around the viewport.

## Root Path tab

Each tweet card shows:

- structural label such as `Root`, `Ancestor 2`, `Explored`
- relation to its parent such as `replied to Root` or `quoted Ancestor 3`
- author handle
- tweet text
- inline reference markers like `[1] [2]`
- tweet id

Clicking a tweet card navigates to that tweet on X.

## References tab

Each reference card shows:

- internal reference number
- canonical URL
- host/domain
- count of path tweets that cited it

Clicking a reference opens the canonical URL in a new tab.

## People tab

Each people card shows:

- profile picture when available
- handle
- display name
- profile URL
- source types such as `author` or `mention`
- count of path tweets where that handle appeared

Clicking a people card opens that X profile in a new tab.

## Replies tab

Each reply card shows:

- the number of tweets collected into that reply chain
- which path node the chain belongs to, such as `Root`, `Ancestor 2`, or `Explored`
- which anchor author that chain replies to
- one card per tweet in the collected trimmed subtree
- the tweet ids included in that trimmed chain

These chains are aggregated from the X API conversation graphs for tweets across
the full root-to-explored path. Each visible card represents one subtree that:

- starts at one direct reply to one path tweet
- includes descendants below that direct reply
- is shown only if one of the path authors participates somewhere in that subtree
- is trimmed at the last tweet by any of those path authors

Clicking a tweet card navigates to that specific tweet on X.

## Report tab

The report tab appears after `Generate Report` succeeds.

It shows:

- the generated narrative text
- the generation timestamp
- the model used for generation
- a `Copy Markdown` action for copying the report body to the clipboard
- a `Download Report` action for saving the report as Markdown

The report is generated from the current artifact, so if the path changes, the report should be regenerated.

## Export

`Export` downloads a JSON snapshot containing:

- `clickedTweetId`
- `exportedAt`
- `artifact`

## Generate Report

`Generate Report` sends the current artifact to the background worker, which forwards it to the local AriadeX report backend.

The extension only needs the backend URL from `dev_env.generated.json`. The backend itself owns prompt loading, the OpenAI API key, and the final model call.

While the request is running, the panel header now shows staged progress messages for:

- loading report settings
- sending the artifact to the AriadeX report backend
- waiting for OpenAI
- report ready

For now the backend is OpenAI-only:

- set `OPENAI_API_KEY`
- optional: set `OPENAI_MODEL`
- optional: set `OPENAI_BASE_URL`

By default, the extension calls `http://127.0.0.1:8787/v1/report`. Start that backend with `npm run report:backend`.
