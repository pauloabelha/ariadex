# UX Notes

AriadeX should feel like a compact investigation panel, not a second feed.

The user has already found something interesting on X. The extension should help them preserve context, compare path evidence, and produce a readable explanation without pulling them away from the page.

## Entry Point

The extension injects an `Explore Path` action into tweet cards.

The action should feel lightweight:

- one click starts exploration
- progress is visible
- failures are plain and recoverable
- the result appears in-place

## Panel

The floating panel is the main surface.

It is:

- draggable from the header
- compact enough to sit beside the X timeline
- stateful across rerenders
- organized by artifact tabs

Header actions:

- `Export`
- `Generate Report`
- `Generate Gist`
- `Clear Cache`

## Tabs

`Root Path`

Shows the resolved root-to-explored chain. Cards include structural labels, relation labels, author handles, tweet text, reference markers, and tweet ids.

`References`

Shows canonical external URLs cited by path tweets. Each reference can be opened directly.

`People`

Shows path authors and mentioned users. Each person links to their X profile when the handle is valid.

`Replies`

Shows anchored reply chains. Each chain names the path tweet it belongs to, the anchor author, and the collected tweets in that trimmed subtree.

`Gist`

Appears after `Generate Gist`. The gist is meant to be portable, shorter, and easier to reuse elsewhere.

`Report`

Appears after `Generate Report`. The report is meant to be more narrative and explanatory.

## Interaction Rules

The panel should never hide the evidence behind the generated prose.

Generated text is useful, but the artifact is the source of truth. The user should always be able to return to the path, references, people, and replies.

Progress messages should describe real stages:

- loading generated config
- resolving path
- collecting references
- collecting people
- collecting replies
- calling backend
- waiting for model response
- ready

## Export

`Export` downloads a JSON snapshot:

```json
{
  "clickedTweetId": "...",
  "exportedAt": "...",
  "artifact": {}
}
```

The export is the best handoff format for debugging, notebooks, and future analysis.

## Report And Gist

Both generated outputs come from the same artifact.

The extension sends the artifact to the background service worker. The service worker calls the local backend. The backend loads a prompt and calls OpenAI.

This keeps the browser extension free of OpenAI credentials.

## UX Principles

- Keep the artifact visible.
- Prefer deterministic labels over clever prose.
- Make generated text optional.
- Use stable numbering for references.
- Preserve user agency with export, copy, and download actions.
- Make stale data easy to clear.
