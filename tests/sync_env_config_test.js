const test = require("node:test");
const assert = require("node:assert/strict");

const syncScript = require("../scripts/sync_env_to_generated_config.js");

test("buildGeneratedConfig resolves graph api url from environment map", () => {
  const config = syncScript.buildGeneratedConfig({
    X_BEARER_TOKEN: "token",
    ARIADEX_ENV: "prod",
    ARIADEX_GRAPH_API_URL_DEV: "http://127.0.0.1:8787",
    ARIADEX_GRAPH_API_URL_PROD: "https://api.ariadex.example"
  });

  assert.equal(config.environment, "prod");
  assert.equal(config.graphApiByEnv.dev, "http://127.0.0.1:8787");
  assert.equal(config.graphApiByEnv.prod, "https://api.ariadex.example");
  assert.equal(config.graphApiUrl, "https://api.ariadex.example");
});

test("buildGeneratedConfig prefers explicit ARIADEX_GRAPH_API_URL override", () => {
  const config = syncScript.buildGeneratedConfig({
    X_BEARER_TOKEN: "token",
    ARIADEX_ENV: "prod",
    ARIADEX_GRAPH_API_URL_DEV: "http://127.0.0.1:8787",
    ARIADEX_GRAPH_API_URL_PROD: "https://api.ariadex.example",
    ARIADEX_GRAPH_API_URL: "https://override.ariadex.example"
  });

  assert.equal(config.graphApiUrl, "https://override.ariadex.example");
});

test("buildGeneratedConfig defaults to server-only mode (no bearer in client config)", () => {
  const config = syncScript.buildGeneratedConfig({
    X_BEARER_TOKEN: "token-should-stay-server-side",
    ARIADEX_ENV: "dev",
    ARIADEX_GRAPH_API_URL_DEV: "http://127.0.0.1:8787"
  });

  assert.equal(config.allowClientDirectApi, false);
  assert.equal(Object.prototype.hasOwnProperty.call(config, "bearerToken"), false);
  assert.equal(config.graphApiUrl, "http://127.0.0.1:8787");
});
