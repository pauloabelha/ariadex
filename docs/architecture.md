# Ariadex MVP Architecture

## Purpose
Ariadex MVP injects an `◇ Explore` button into each tweet on `https://x.com/*`. This button is the first UI anchor for future conversation exploration and graph ranking.

## Architecture Overview
The MVP uses a single **Manifest V3 content script** architecture:

- `extension/manifest.json`
- `extension/content.js`
- `extension/styles.css`

No background service worker is required for this phase because all behavior is local DOM augmentation.

## Runtime Flow
1. Chrome loads `content.js` and `styles.css` on `https://x.com/*` at `document_idle`.
2. `content.js` scans current DOM for tweet containers.
3. For each tweet, it locates an action bar (`div[role="group"]`) using action-signal heuristics.
4. If no Ariadex button exists, it appends `◇ Explore`.
5. On `◇ Explore` click, Ariadex:
   - resolves the canonical conversation root from the clicked tweet
   - extracts tweet metadata
   - collects visible conversation tweets from DOM around the resolved root
   - infers `reply_to` relationships
   - builds a typed conversation graph from `reply`, `quote`, and `repost` edges
   - logs `{ rootTweet, graph }` to console
6. A `MutationObserver` watches subtree additions and rescans only newly added roots, throttled with `requestAnimationFrame`.

## Conversation Root Resolution
The clicked tweet is not always the true thread root. Ariadex canonicalizes root before extraction:

- quote tweets: if clicked tweet contains embedded tweet, use embedded tweet as root
- embedded replies: if clicked tweet is inside a parent tweet card, use nearest ancestor tweet
- normal reply threads: use earliest local tweet container in scope

Root resolution is implemented in `extension/root_resolution.js` via:
- `resolveConversationRoot(tweetElement)`

## Conversation Graph Layer
The conversation graph layer sits between DOM collection and future ranking:

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
Conversation Graph
↓
Future: ConversationRank
```

Core helpers in `extension/content.js`:
- `indexTweetsById(tweets)`
- `attachReplies(tweets)`
- `buildTypedEdges(tweets, index)`
- `buildConversationGraph(tweets)`

Reply inference helper module:
- `extension/reply_inference.js`
- `inferReplyStructure(tweetElements, tweetData)`

The graph builder tolerates missing parents and incomplete datasets, deduplicates tweets, and stays fully client-side (no network/API dependency).

## Why This Is MV3-Aligned
- Uses declarative `content_scripts` in `manifest_version: 3`.
- Avoids remote code execution and dynamic script loading.
- Keeps permission scope limited to requested MVP permissions (`activeTab`, `scripting`) and URL match pattern.
- Uses no eval or inline script injection.

## Forward Evolution
A future architecture can add:

- `service_worker` for extension-wide state and caching.
- `chrome.storage` for preferences and per-user ranking settings.
- conversation graph extraction from visible tweet/reply links.
- local ranking pass inspired by candidate + signal design from `the-algorithm` (without direct integration).
