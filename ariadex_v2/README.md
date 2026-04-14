# AriadeX v2

Minimal clean-room prototype.

Current scope:
- inject `Explore Path` into tweet cards on `x.com`
- recursively resolve the clicked tweet's root path
- render only that ordered path in a side panel

Important limitation:
- this version uses X's public syndication tweet payloads
- parent rule is deterministic: `quote > reply`
- it only renders the root path, nothing else

Code health:
- background and content scripts are written to be testable under Node
- recursive resolution and label formatting are covered by unit tests
- tweet payloads are cached by tweet id in `chrome.storage.local`

Run:
1. Open `chrome://extensions`
2. Enable Developer mode
3. Click `Load unpacked`
4. Select `ariadex_v2/extension`
5. Open a tweet thread on `https://x.com`
6. Click `Explore Path`

Tests:

```bash
cd /home/pauloabelha/ariadex_v2
npm test
```

More detail:
- [`README_ARCHITECTURE.md`](/home/pauloabelha/ariadex_v2/README_ARCHITECTURE.md)
