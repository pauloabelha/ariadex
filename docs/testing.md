# Testing

## Test Stack
- Node.js built-in test runner (`node:test`)
- `jsdom` for DOM simulation

## Test Files
- `tests/selector_test.js`
- `tests/dom_injection_test.js`

## What Is Covered
1. Tweet selector detection (`article`, `data-testid` cases).
2. Action bar identification (`div[role='group']` with action hints).
3. Button injection behavior.
4. Duplicate prevention (idempotent reinjection).
5. Processing dynamically added tweet blocks.

## Run Tests
```bash
npm install
npm test
```

## Manual Verification on X
1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select `ariadex/extension`.
4. Visit `https://x.com` and scroll timeline.
5. Confirm each tweet action bar gets one `◇ Explore` button.
6. Click button and verify alert appears.
