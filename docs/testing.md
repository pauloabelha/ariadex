# Testing

## Test Stack
- Node built-in test runner (`node:test`)
- `jsdom` for DOM-coupled tests only

## Quick Start

Fresh checkout:

```bash
npm install
```

Run everything:

```bash
npm test
```

Run only the pure non-DOM suite:

```bash
npm run test:core
```

Run only the DOM-heavy suite:

```bash
npm run test:dom
```

CI also runs a benchmark smoke check:

```bash
npm run benchmark:snapshot
```

## Run

```bash
npm test
```

## Core (No Browser APIs)
These tests run pure engine/data logic:
- `tests/conversation_graph_test.js`
- `tests/conversation_adjacency_test.js`
- `tests/conversation_rank_test.js`
- `tests/core_conversation_engine_test.js`
- `tests/core_layer_boundary_test.js`
- `tests/core_root_resolution_test.js`
- `tests/thread_collapse_test.js`
- `tests/typed_conversation_graph_test.js`
- `tests/x_api_conversation_test.js`

## Data Layer
- `tests/conversation_collection_test.js`
- `tests/data_dom_collector_test.js`
- `tests/reply_inference_test.js`
- `tests/root_resolution_test.js`
- `tests/tweet_extraction_test.js`
- `tests/x_api_client_network_discovery_test.js`
- `tests/x_api_client_cache_test.js`
- `tests/benchmark_snapshot_pipeline_test.js`
- `tests/openai_contribution_filter_test.js`
- `tests/graph_cache_server_test.js`
- `tests/openai_article_generator_test.js`
- `tests/article_pdf_test.js`

## UI / Extension DOM
- `tests/ui_panel_render_test.js`
- `tests/ui_panel_renderer_layer_test.js`
- `tests/dom_injection_test.js`
- `tests/selector_test.js`
- `tests/content_graph_api_bridge_test.js`

Heuristic split:
- `test:core` covers the pure Node tests with no `jsdom` dependency
- `test:dom` covers DOM extraction/rendering tests that require `jsdom`
- some extension bridge tests stay in `test:core` because they stub browser APIs without creating a DOM

## Required Scenario Coverage
- graph construction correctness: `conversation_graph_test.js`, `typed_conversation_graph_test.js`
- reply edge detection: `conversation_graph_test.js`, `typed_conversation_graph_test.js`
- quote edge detection: `typed_conversation_graph_test.js`, `core_conversation_engine_test.js`
- ThinkerRank stability/determinism: `conversation_rank_test.js`, `core_conversation_engine_test.js`
- panel duplicate removal: `ui_panel_render_test.js`, `ui_panel_renderer_layer_test.js`
- Dex tabs + evidence canonicalization: `ui_panel_renderer_layer_test.js`
- empty following set: `ui_panel_render_test.js`
- large graphs (1000+): `conversation_adjacency_test.js`, `core_conversation_engine_test.js`, `ui_panel_render_test.js`
- missing parents: `conversation_graph_test.js`
- equal score deterministic ordering: `conversation_rank_test.js`, `ui_panel_render_test.js`
- followed-account discovery pass: `x_api_client_network_discovery_test.js`
- concurrent collection resilience (reply failure does not drop quote branch): `x_api_client_network_discovery_test.js`
- adjacency integrity: `conversation_adjacency_test.js`
- article input excludes synthetic/X-only references and preserves canonical non-X references: `openai_article_generator_test.js`
- PDF rendering returns a valid PDF header and includes article content: `article_pdf_test.js`
- article endpoint and panel digest actions work through the extension bridge: `graph_cache_server_test.js`, `content_graph_api_bridge_test.js`, `ui_panel_renderer_layer_test.js`

## Performance Baseline Command

```bash
npm run benchmark:snapshot
```

This benchmark is deterministic (synthetic in-memory X API) and reports cold vs warm latency and per-endpoint request counts.
- core layer has no DOM/extension API usage: `core_layer_boundary_test.js`
- viewer-handle normalization and server-side following enrichment fallback: `graph_cache_server_test.js`

## Manual Extension Smoke Test
1. Run `npm install`
2. Run `node scripts/sync_env_to_generated_config.js`
3. Reload unpacked extension (`ariadex/extension`) in Chrome
4. Open `https://x.com`
5. Click `◇ Explore` on a tweet
6. Verify panel renders and clicking cards scrolls/highlights tweets
7. Open `Digest`, click `Generate Article`, and verify `Download PDF` appears

## Failure Triage
- `Cannot find module 'jsdom'`: run `npm install`
- only `test:dom` fails: likely DOM selector/rendering regression
- only `test:core` fails: likely graph, ranking, caching, or server regression
- benchmark drift with green tests: inspect `npm run benchmark:snapshot`

## Continuous Integration

GitHub Actions workflow:
- [ci.yml](/home/pauloabelha/ariadex/.github/workflows/ci.yml)

What CI enforces:
- `npm run test:core`
- `npm run test:dom`
- `npm test`
- `npm run benchmark:snapshot` smoke execution

When it runs:
- on every pull request
- on every push to `main`

Runtime matrix:
- Node `18`
- Node `20`
- Node `22`

## Observability Smoke Test
1. Run `ARIADEX_LOG_COLOR=true ARIADEX_LOG_LEVEL=debug npm run dev:cache`
2. Trigger `◇ Explore`
3. Confirm logs include:
- `x_api_request_started` / `x_api_request_completed`
- `snapshot_phase`
- `snapshot_completed` with ranking diagnostics
- `snapshot_article_cache_hit` / `snapshot_article_cache_populated`
- `openai_article_generated` or `openai_article_generation_failed`
