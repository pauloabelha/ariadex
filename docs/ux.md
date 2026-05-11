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

The extension also injects a sibling `Top Takes` action into tweet cards.

This action opens the same floating panel in a quote-discourse mode. It should help the user quickly see the most informative competing perspectives around the selected tweet without entering an endless quote-feed scroll.

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

The panel can be rendered in either root-path mode or Top Takes mode. These are separate workflows. Top Takes must not change the deterministic path resolver, reply-chain collection, or Explore Path interaction.

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

`Top Takes`

Appears after clicking `Top Takes`. Shows one sorted list of representative high-signal quote-tweet takes. Each card uses compact colored pills to show the author's apparent relationship to the source tweet's domain.

Domain pills:

- `Expert`: the author appears directly domain-fluent for the source tweet's subject based on the quote text and public X profile metadata.
- `Adjacent`: the author brings useful neighboring expertise or context, such as economics, policy, commercialization, deployment, operations, user experience, ethics, investing, or field practice.

Each selected take includes the quote tweet, the author, colored pills for domain/role/reference signals, compact scorecard values, domain signal evidence, and a concise explanation of why that take materially improves understanding.

Top Takes sections should prefer discourse coverage over ranking:

- Best Technical Explanation
- Strongest Skeptical Take
- Most Important Operational Caveat
- Best Evidence-Based Take
- Best Commercial Framing
- Most Informative Context

The UI should feel like epistemic tooling and perspective compression, not sentiment analysis, engagement farming, or a generic AI summary.

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

Top Takes progress messages should describe real stages:

- collecting quote tweets
- normalizing discourse
- sending batches to OpenAI
- analyzing epistemic roles
- grouping perspectives
- selecting representative takes
- rendering Top Takes

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

Top Takes uses a separate artifact and pipeline. The extension retrieves quote tweets and author profile metadata through the X API, normalizes and deduplicates them, then asks OpenAI for structured epistemic classifications. The prompt must optimize for informational contribution, perspective diversity, mechanistic understanding, operational realism, meaningful skepticism, and evidence-based reasoning. It must not optimize for popularity, agreement, hype, or objective truth determination.

Profile metadata is weak public evidence, not credential verification. The model should not equate follower count or verification with expertise. It should prefer demonstrated domain fluency in the quote itself and classify authors into `Expert` or `Adjacent`.

## UX Principles

- Keep the artifact visible.
- Keep Top Takes grounded in quote tweets.
- Prefer deterministic labels over clever prose.
- Make generated text optional.
- Use stable numbering for references.
- Preserve user agency with export, copy, and download actions.
- Make stale data easy to clear.
