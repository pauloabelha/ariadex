# Testing

## Test Stack
- Node built-in test runner (`node:test`)
- `jsdom` for DOM/UI tests only

## Run

```bash
node --test tests/*.js
```

## Core (No Browser APIs)
These tests run pure engine/data logic:
- `tests/conversation_graph_test.js`
- `tests/conversation_adjacency_test.js`
- `tests/conversation_rank_test.js`
- `tests/core_conversation_engine_test.js`
- `tests/core_layer_boundary_test.js`
- `tests/core_root_resolution_test.js`
- `tests/reply_inference_test.js`
- `tests/root_resolution_test.js`
- `tests/thread_collapse_test.js`
- `tests/typed_conversation_graph_test.js`
- `tests/x_api_conversation_test.js`

## Data Layer
- `tests/conversation_collection_test.js`
- `tests/data_dom_collector_test.js`
- `tests/tweet_extraction_test.js`
- `tests/x_api_client_network_discovery_test.js`
- `tests/benchmark_snapshot_pipeline_test.js`
- `tests/openai_contribution_filter_test.js`
- `tests/graph_cache_server_test.js`

## UI / Extension DOM
- `tests/ui_panel_render_test.js`
- `tests/ui_panel_renderer_layer_test.js`
- `tests/dom_injection_test.js`
- `tests/selector_test.js`
- `tests/content_graph_api_bridge_test.js`

## Required Scenario Coverage
- graph construction correctness: `conversation_graph_test.js`, `typed_conversation_graph_test.js`
- reply edge detection: `conversation_graph_test.js`, `typed_conversation_graph_test.js`
- quote edge detection: `typed_conversation_graph_test.js`, `core_conversation_engine_test.js`
- ThinkerRank stability/determinism: `conversation_rank_test.js`, `core_conversation_engine_test.js`
- panel duplicate removal: `ui_panel_render_test.js`, `ui_panel_renderer_layer_test.js`
- empty following set: `ui_panel_render_test.js`
- large graphs (1000+): `conversation_adjacency_test.js`, `core_conversation_engine_test.js`, `ui_panel_render_test.js`
- missing parents: `conversation_graph_test.js`
- equal score deterministic ordering: `conversation_rank_test.js`, `ui_panel_render_test.js`
- followed-account discovery pass: `x_api_client_network_discovery_test.js`
- concurrent collection resilience (reply failure does not drop quote branch): `x_api_client_network_discovery_test.js`
- adjacency integrity: `conversation_adjacency_test.js`

## Performance Baseline Command

```bash
npm run benchmark:snapshot
```

This benchmark is deterministic (synthetic in-memory X API) and reports cold vs warm latency and per-endpoint request counts.
- core layer has no DOM/extension API usage: `core_layer_boundary_test.js`
- viewer-handle normalization and server-side following enrichment fallback: `graph_cache_server_test.js`

## Manual Extension Smoke Test
1. Run `node scripts/sync_env_to_generated_config.js`
2. Reload unpacked extension (`ariadex/extension`) in Chrome
3. Open `https://x.com`
4. Click `◇ Explore` on a tweet
5. Verify panel renders and clicking cards scrolls/highlights tweets

## Observability Smoke Test
1. Run `ARIADEX_LOG_COLOR=true ARIADEX_LOG_LEVEL=debug npm run dev:cache`
2. Trigger `◇ Explore`
3. Confirm logs include:
- `x_api_request_started` / `x_api_request_completed`
- `snapshot_phase`
- `snapshot_contribution_filter_applied` (when OpenAI enabled)
- `snapshot_completed` with ranking diagnostics
