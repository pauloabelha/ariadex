# Ariadex

Ariadex is a Chrome extension MVP that augments X (`https://x.com`) by injecting an `◇ Explore` button into tweet action bars.

This is the first step toward a conversation exploration tool that can later build and rank discussion graphs.

## Why Ariadex Exists
Conversations on X are high-volume and structurally complex. Ariadex starts with a lightweight UI anchor inside each tweet so future versions can:

- map conversation branches
- identify high-signal replies
- rank discussion paths with graph-inspired relevance signals

## MVP Features
- Manifest V3 extension architecture
- automatic execution on `https://x.com/*`
- dynamic tweet detection for React-rendered timelines
- one `◇ Explore` button per tweet action bar
- duplicate-injection protection
- click action now logs a structured conversation graph:

```js
console.log({
  rootTweet,
  graph,
  ranking
});
```

## Repository Structure

```text
ariadex/
  extension/
    manifest.json
    reply_inference.js
    root_resolution.js
    conversation_rank.js
    ui_panel.js
    content.js
    styles.css
  docs/
    architecture.md
    conversation_collection.md
    conversation_graph.md
    conversation_rank.md
    ui_panel.md
    ui_rendering.md
    extension_design.md
    dom_injection_strategy.md
    testing.md
  tests/
    conversation_collection_test.js
    conversation_rank_test.js
    conversation_graph_test.js
    dom_injection_test.js
    reply_inference_test.js
    root_resolution_test.js
    selector_test.js
    typed_conversation_graph_test.js
    tweet_extraction_test.js
    ui_panel_render_test.js
  X_example.html
  package.json
  README.md
```

## Install and Run (Load Unpacked)
1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the `extension/` folder inside this repository.
5. Navigate to `https://x.com`.
6. Confirm tweet action bars show `◇ Explore`.

## Run Tests

```bash
npm install
npm test
```

The tests use `jsdom` to simulate tweet-like DOM structures and validate selector logic, injection, and duplicate prevention.

## Architecture Summary
- Content script (`content.js`) scans tweet candidates.
- Action bar is selected via semantic `role='group'` + action-label hints.
- Button is appended once per action bar.
- On click, Ariadex extracts tweet metadata and collects visible conversation tweets.
- On click, Ariadex resolves the canonical conversation root (quote/reply aware).
- Ariadex infers `reply_to` from DOM structure and reply context text.
- Ariadex builds a typed graph with `reply`, `quote`, and `repost` edges.
- Ariadex also keeps a reply-tree projection (`root`, `children`) for traversal.
- Ariadex computes ConversationRank influence scores over the typed graph.
- Ariadex renders top-ranked threads in a deterministic floating panel on `document.body`.
- `MutationObserver` handles lazy-loaded tweets efficiently using batched processing.

Pipeline:

```text
Clicked Tweet
↓
Root Resolution
↓
DOM Tweets
↓
Tweet Extraction
↓
Reply Inference
↓
Typed Conversation Graph
↓
ConversationRank
↓
UI Rendering
↓
Future: Hybrid ranking signals
```

## User Interface
Ariadex shows ranked conversation threads directly inside X:

- deterministic placement: floating panel attached to `document.body`
- fixed position + high z-index for consistent visibility

Each ranked item is clickable and scrolls/highlights the corresponding tweet.

## Conversation Reconstruction
Ariadex reconstructs reply relationships from page layout because X often does not expose explicit parent IDs in visible tweet DOM.

Inference strategy:
- indentation depth (left offset / margin / padding)
- `Replying to @username` context matching
- fallback to nearest previous tweet with smaller indentation

Root canonicalization strategy:
- quote tweet detection (embedded tweet becomes root)
- embedded tweet ancestry detection
- fallback to earliest local tweet in thread scope

If no confident parent is found, `reply_to` remains `null`, and graph construction still proceeds safely.

## ConversationRank
ConversationRank is a weighted PageRank-style algorithm over typed edges:

- `reply`: `1.0`
- `quote`: `1.25`
- `repost`: `0.75`

It ranks the most influential tweets in the current visible conversation graph.

See:
- `docs/architecture.md`
- `docs/conversation_collection.md`
- `docs/conversation_graph.md`
- `docs/conversation_rank.md`
- `docs/ui_panel.md`
- `docs/extension_design.md`
- `docs/dom_injection_strategy.md`
- `docs/testing.md`

## Roadmap
1. Replace alert with Ariadex panel UI.
2. Parse conversation threads and reply edges.
3. Build local conversation graph representation.
4. Introduce ranking signals inspired by public recommendation-system patterns.
5. Add user controls (ranking mode, filtering, export).
