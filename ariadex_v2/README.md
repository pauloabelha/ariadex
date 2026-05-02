# AriadeX v2

Minimal clean-room prototype.

Current scope:
- inject `Explore Path` into tweet cards on `x.com`
- recursively resolve the clicked tweet's root path
- collect and canonicalize references cited along that root path
- collect deduped people from path authors and mentions
- collect `replyChains` for every tweet on the resolved root-to-explored path
- define each reply chain as one direct-reply subtree anchored under one path tweet
- treat every author on that root-to-explored path as a valid participant when filtering those chains
- keep only anchored reply subtrees where one of those path authors appears somewhere in the subtree
- trim each kept subtree at the last tweet by any of those path authors
- render the path, references, people, and replies in separate tabs
- export the current artifact as JSON from the panel
- generate a narrative report from the current artifact through a local AriadeX report backend

Important limitation:
- this version uses the X API directly and requires a bearer token in local storage
- report generation requires a reachable local AriadeX report backend
- the report backend is OpenAI-only for now and requires `OPENAI_API_KEY`
- parent rule is deterministic: `quote > reply`
- references are deduped and numbered globally for the current explored path
- people are deduped globally for the current explored path by canonical X handle
- reply chains depend on `conversation_id` search, so the reply view is bounded by what the X API returns for each conversation touched by the resolved path
- replies can differ from the visible X UI because the API may return deleted, hidden, or otherwise non-prominent conversation tweets, especially until cache is cleared
- each path tweet shows its local reference numbers like `[1] [2]`
- the generated report is only as good as the configured model and the current artifact quality
- report generation status is streamed in phases, so the panel can distinguish config loading, backend call, OpenAI wait time, and final success

Code health:
- the root-path algorithm lives in its own module and is testable under Node
- background and content scripts stay thin around that core logic
- recursive resolution, X-API reply-chain collection, report generation, export, and panel rendering are covered by unit tests
- tweet payloads and conversation membership are cached in `chrome.storage.local`

Run:
1. Open `chrome://extensions`
2. Enable Developer mode
3. Click `Load unpacked`
4. Select `ariadex_v2/extension`
5. Open a tweet thread on `https://x.com`
6. Click `Explore Path`
7. In a terminal, run `npm run report:backend`
8. Click `Generate Report` after the artifact loads if you want a narrative summary
9. Use `Copy Markdown` or `Download Report` from the `Report` tab once generation succeeds

Configuration notes:
- the extension only reads `reportBackendBaseUrl` from `extension/dev_env.generated.json`
- set `REPORT_BACKEND_BASE_URL` if you want the extension to call a backend somewhere other than `http://127.0.0.1:8787`
- set `OPENAI_API_KEY` for the backend
- optional: set `OPENAI_MODEL` to override the default `gpt-4o-mini`
- optional: set `OPENAI_BASE_URL` if you need a non-default OpenAI-compatible URL

Tests:

```bash
cd /home/pauloabelha/ariadex/ariadex_v2
npm test
```

More detail:
- [`README_ARCHITECTURE.md`](/home/pauloabelha/ariadex/ariadex_v2/README_ARCHITECTURE.md)
- [`docs/overview.md`](/home/pauloabelha/ariadex/ariadex_v2/docs/overview.md)
- [`docs/algorithm.md`](/home/pauloabelha/ariadex/ariadex_v2/docs/algorithm.md)
- [`docs/references.md`](/home/pauloabelha/ariadex/ariadex_v2/docs/references.md)
- [`docs/ux.md`](/home/pauloabelha/ariadex/ariadex_v2/docs/ux.md)
