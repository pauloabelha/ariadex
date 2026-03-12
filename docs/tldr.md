# Ariadex TL;DR

Ariadex is a Chrome extension for X that helps you make sense of busy conversation threads.

Right now, it adds a small `◇ Explore` button to each tweet. When you click it, Ariadex reads the tweets visible on the page, reconstructs who is replying to whom, builds a local conversation graph, and ranks the most important contributions. It then shows the top results in a floating side panel you can click to jump to the tweet in context.

In plain terms: Ariadex turns a messy thread into a structured map, then highlights the parts most worth reading.

## What it does today

- Injects `◇ Explore` into tweet action bars on `https://x.com/*`.
- Works on dynamic React timelines (new tweets loaded as you scroll).
- Avoids duplicate button injection.
- Extracts core tweet metadata from the DOM (author, text, URL, engagement counts).
- Resolves the likely conversation root before analysis.
- Infers reply relationships when explicit parent IDs are not available.
- Builds a typed graph (`reply`, `quote`, `repost`).
- Collapses root-author continuation chains into one discourse unit (`author_thread`).
- Runs a local influence ranking pass (ConversationRank).
- Renders top-ranked items in a deterministic floating panel.

## How the pipeline works

1. You click `◇ Explore` on a tweet.
2. Ariadex resolves the canonical root tweet for that local conversation.
3. It collects visible tweets from the DOM.
4. It extracts tweet fields and infers `reply_to` links.
5. It builds a typed conversation graph.
6. It collapses root-author thread segments.
7. It computes influence scores.
8. It renders top results in the panel and enables click-to-scroll.

## Why this project exists

X threads are high volume and often hard to parse quickly. Ariadex is built to surface signal over noise by giving structure first and ranking second.

## Technical shape

- Chrome Extension Manifest V3.
- Lightweight content-script architecture.
- No external API dependency for the core MVP flow.
- DOM-first extraction with defensive fallbacks.
- Unit tests with `jsdom` for selectors, extraction, graph logic, ranking, and UI rendering.

## Current limitations

- Operates only on tweets currently visible in the DOM.
- Reply inference is heuristic, because X does not always expose explicit parent linkage in-page.
- Ranking quality depends on completeness of visible thread context.

## Where it is headed

- Better conversation reconstruction beyond viewport-limited DOM.
- Stronger ranking signals and user-tunable ranking modes.
- Filtering/export capabilities for deeper thread analysis.

If you want to start quickly: load `extension/` as unpacked in `chrome://extensions`, open X, click `◇ Explore`, and inspect the floating panel.
