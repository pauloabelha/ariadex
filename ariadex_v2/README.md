# AriadeX v2

Minimal clean-room prototype.

Current scope:
- inject `Explore Path` into tweet cards on `x.com`
- recursively resolve the clicked tweet's root path
- collect and canonicalize references cited along that root path
- collect deduped people from path authors and mentions
- collect `replyChains` from the X API conversation graph for every tweet on the resolved root-to-explored path
- treat every author on that root-to-explored path as a valid first-class participant in reply-chain filtering
- keep reply branches only when one of those path authors appears in the branch
- trim each kept branch at the last tweet by any of those path authors
- render the path, references, people, and replies in separate tabs
- export the current artifact as JSON from the panel

Important limitation:
- this version uses the X API directly and requires a bearer token in local storage
- parent rule is deterministic: `quote > reply`
- references are deduped and numbered globally for the current explored path
- people are deduped globally for the current explored path by canonical X handle
- replies depend on `conversation_id` search, so the reply view is bounded by what the X API returns for each conversation touched by the resolved path
- replies can differ from the visible X UI because the API may return deleted, hidden, or otherwise non-prominent conversation tweets, especially until cache is cleared
- each path tweet shows its local reference numbers like `[1] [2]`

Code health:
- the root-path algorithm lives in its own module and is testable under Node
- background and content scripts stay thin around that core logic
- recursive resolution, X-API reply-chain collection, export, and panel rendering are covered by unit tests
- tweet payloads and conversation membership are cached in `chrome.storage.local`

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
