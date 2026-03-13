# Extension Design

## Design Goals
- keep extension runtime thin
- isolate platform-independent logic in `core/`
- isolate retrieval logic in `data/`
- isolate panel rendering logic in `ui/`

## `extension/content.js` responsibilities
1. inject `◇ Explore` into tweet action bars
2. detect clicked tweet + DOM root hint
3. read runtime API config/token/following set
4. call data layer (`buildConversationDataset`)
5. call core engine (`runConversationEngine`)
6. call UI renderer (`renderConversationPanel`)

## Dependency Flow

```text
extension/content.js
  -> extension/dom_collector.js (data)
  -> extension/x_api_client.js (data)
  -> extension/conversation_engine.js (core orchestration)
  -> extension/panel_renderer.js (ui)
```

Core algorithms are not implemented in `content.js`.

## DOM Injection Strategy
- robust tweet selectors with fallback chain
- action-bar scoring by interaction hints
- duplicate button prevention (`data-ariadex-explore-button`)
- mutation observer with batched rescans

## Runtime Config
X API config is loaded by:
- `extension/dev_env_loader.js`
- generated file: `extension/dev_env.generated.json`

This file is produced from `~/ariadex/.env` by `scripts/sync_env_to_generated_config.js`.
