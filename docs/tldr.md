# Ariadex TL;DR

Ariadex is a conversation analysis engine plus a Chrome extension UI.

When you click `◇ Explore` on X:
1. Ariadex canonicalizes the root tweet.
2. It retrieves connected tweets from the official X API.
3. It builds a typed graph.
4. It runs ThinkerRank.
5. It renders two ranked panel sections.

The project is now layered:
- `core/`: portable engine (no DOM/browser APIs)
- `data/`: data retrieval/normalization
- `ui/`: panel + tweet highlight
- `extension/`: thin integration glue

The same core logic can run in:
- Chrome extension
- Node tests
- backend services
- future web/mobile clients
