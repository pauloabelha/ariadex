# Extension Design

## Design Goals
- Inject a stable, lightweight button into tweet action bars.
- Support React-driven dynamic DOM updates.
- Avoid duplicate injections.
- Keep implementation testable and modular.

## Key Modules (`extension/content.js`)
- `getTweetCandidates(root)`
- `locateActionBar(tweet)`
- `injectExploreButton(tweet)`
- `processRoot(root)`
- `createObserver()`
- `init()`

## Selector Strategy
Because X DOM can shift frequently, the script uses layered selectors:

1. `article[data-testid="tweet"]`
2. `div[data-testid="tweet"]`
3. `article[role='article']`
4. `article`

Action bar detection targets `div[role='group']` and scores each group by labels/controls containing action hints (`reply`, `repost`, `retweet`, `like`, `bookmark`, `share`, `view`).

## Duplicate Prevention
Before append, the script checks for:
- `.ariadex-explore-button`
- `[data-ariadex-explore-button]`

It also marks initialized document root with `data-ariadex-initialized` to avoid duplicate extension startup.

## UX Behavior
On click:

```js
alert("Explore conversation (Ariadex MVP)");
```

This placeholder is intentionally simple and deterministic for MVP validation.
