# AriadeX v2

Minimal clean-room prototype.

Current scope:
- inject `Explore Path` into tweet cards on `x.com`
- recursively resolve the clicked tweet's root path
- collect and canonicalize references cited along that root path
- render the path and the deduped reference list in separate tabs

Important limitation:
- this version uses X's public syndication tweet payloads
- parent rule is deterministic: `quote > reply`
- references are deduped and numbered globally for the current explored path
- each path tweet shows its local reference numbers like `[1] [2]`

Code health:
- the root-path algorithm lives in its own module and is testable under Node
- background and content scripts stay thin around that core logic
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
- [`docs/overview.md`](/home/pauloabelha/ariadex_v2/docs/overview.md)
- [`docs/algorithm.md`](/home/pauloabelha/ariadex_v2/docs/algorithm.md)
- [`docs/references.md`](/home/pauloabelha/ariadex_v2/docs/references.md)
- [`docs/ux.md`](/home/pauloabelha/ariadex_v2/docs/ux.md)
