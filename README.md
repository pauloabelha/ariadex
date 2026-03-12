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
- placeholder click action:

```js
alert("Explore conversation (Ariadex MVP)");
```

## Repository Structure

```text
ariadex/
  extension/
    manifest.json
    content.js
    styles.css
  docs/
    architecture.md
    extension_design.md
    dom_injection_strategy.md
    testing.md
  tests/
    dom_injection_test.js
    selector_test.js
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
- `MutationObserver` handles lazy-loaded tweets efficiently using batched processing.

See:
- `docs/architecture.md`
- `docs/extension_design.md`
- `docs/dom_injection_strategy.md`
- `docs/testing.md`

## Roadmap
1. Replace alert with Ariadex panel UI.
2. Parse conversation threads and reply edges.
3. Build local conversation graph representation.
4. Introduce ranking signals inspired by public recommendation-system patterns.
5. Add user controls (ranking mode, filtering, export).
