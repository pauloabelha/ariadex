# DOM Injection Strategy

## Inputs Analyzed
- `X_example.html` (local snapshot): confirms root app mount (`#react-root`) and dynamic React app behavior.
- Typical X tweet semantics: tweet containers and action bars are rendered after hydration and continuously updated.

## Injection Rules
1. Treat tweet containers as candidates via layered selectors.
2. For each tweet, pick the best `div[role='group']` that looks like an action bar.
3. Append one button only.
4. Never rewrite existing tweet controls.

## MutationObserver Strategy
The observer watches:

```js
{ childList: true, subtree: true }
```

For performance:
- only `addedNodes` are queued
- queued nodes are batched
- batch processing is throttled by `requestAnimationFrame`

This avoids full-document rescans on every micro-change while still capturing lazy-loaded tweets.

## Defensive Practices
- Ignore non-element nodes.
- Tolerate missing action bars.
- Use semantic attributes (`role`, `aria-label`) over fragile class names.
- Keep selectors centralized and test-covered.
