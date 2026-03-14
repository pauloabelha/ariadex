# Ariadex TL;DR

Ariadex is a conversation analysis engine plus a Chrome extension UI.

When you click `◇ Explore` on X:
1. Ariadex canonicalizes the root tweet.
2. It retrieves connected tweets from the official X API in two passes:
   - core topicsphere pass (replies/quotes/quote-replies)
   - bounded followed-author discovery pass
   - replies and quotes are fetched concurrently per root to reduce latency
3. It builds a typed graph.
4. It runs ThinkerRank.
5. It renders two ranked panel sections.

ThinkerRank is now explicitly:
- recursive (PageRank-style over reply/quote edges)
- reach-aware (likes/reposts/replies/quotes affect prior + influence transfer)
- follower-aware (author follower count contributes to prior)
- deterministic (stable tie-breaks)

Core idea:
- you are influential if influential tweets reply/quote you
- high-reach tweets start with higher prior and pass stronger influence

The project is now layered:
- `core/`: portable engine (no DOM/browser APIs)
- `data/`: data retrieval/normalization
- `ui/`: panel + tweet highlight
- `extension/`: thin integration glue

Extension networking note:
- `content.js` asks `background.js` to call the Graph API.
- This avoids x.com CSP/private-network blocks for localhost dev servers.
- extension now uses async snapshot jobs and shows server progress messages while loading.

Server filtering note:
- graph-cache server can run an OpenAI cheap model pass (`gpt-4o-mini`) to mark tweets as contributing/non-contributing
- non-contributing tweets are filtered before ThinkerRank

UI note:
- ranking cards show author avatars when `author_profile.profile_image_url` is available
- Fast/Deep toggle was removed; exploration is deep-only
- if `followingSet` is empty, "From Your Network" will stay empty by design
- app-only bearer token mode cannot fetch the viewer's full following graph from X API
- extension now extracts viewer handle hints from X header DOM for diagnostics/debugging

Ops note:
- server logs support ANSI color (`ARIADEX_LOG_COLOR=true`) and detailed debug traces (`ARIADEX_LOG_LEVEL=debug`)
- cache hit requests can run incremental diff refresh (`incremental=true`) to catch new replies/quotes without full rebuild

The same core logic can run in:
- Chrome extension
- Node tests
- backend services
- future web/mobile clients
