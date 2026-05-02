const test = require("node:test");
const assert = require("node:assert/strict");

const syncScript = require("../scripts/sync_env_to_generated_config.js");

test("buildGeneratedConfig reads the X bearer token from environment input", () => {
  const config = syncScript.buildGeneratedConfig({
    X_BEARER_TOKEN: "token-from-env"
  });

  assert.deepEqual(config, {
    bearerToken: "token-from-env",
    reportBackendBaseUrl: "http://127.0.0.1:8787"
  });
});

test("buildGeneratedConfig accepts the alternate X_API_BEARER_TOKEN name", () => {
  const config = syncScript.buildGeneratedConfig({
    X_API_BEARER_TOKEN: "alternate-token",
    X_API_BASE_URL: "https://api.x.com/2"
  });

  assert.deepEqual(config, {
    bearerToken: "alternate-token",
    apiBaseUrl: "https://api.x.com/2",
    reportBackendBaseUrl: "http://127.0.0.1:8787"
  });
});

test("buildGeneratedConfig carries the default report backend base url", () => {
  const config = syncScript.buildGeneratedConfig({
    X_BEARER_TOKEN: "token-from-env"
  });

  assert.deepEqual(config, {
    bearerToken: "token-from-env",
    reportBackendBaseUrl: "http://127.0.0.1:8787"
  });
});

test("buildGeneratedConfig uses an explicit report backend base url override", () => {
  const config = syncScript.buildGeneratedConfig({
    X_BEARER_TOKEN: "token-from-env",
    REPORT_BACKEND_BASE_URL: "http://127.0.0.1:9901"
  });

  assert.deepEqual(config, {
    bearerToken: "token-from-env",
    reportBackendBaseUrl: "http://127.0.0.1:9901"
  });
});

test("buildGeneratedConfig rejects when the bearer token is missing", () => {
  assert.throws(() => syncScript.buildGeneratedConfig({}), /Missing X_BEARER_TOKEN or X_API_BEARER_TOKEN/);
});
