const test = require("node:test");
const assert = require("node:assert/strict");

const {
  deriveProviderName,
  isLocalEnabled,
  resolveArticleModel,
  resolveContributionModel,
  resolveEndpointBase,
  resolveLocalServerConfig
} = require("../server/llm_runtime.js");

test("llm runtime defaults to local mode from repo config", () => {
  assert.equal(isLocalEnabled(undefined), true);
  assert.equal(resolveEndpointBase(undefined, { local: true }), "http://127.0.0.1:8091/v1");
  assert.equal(resolveContributionModel(undefined, { local: true }), "google_gemma-4-E2B-it-Q4_K_M");
  assert.equal(resolveArticleModel(undefined, { local: true }), "google_gemma-4-E2B-it-Q4_K_M");
});

test("llm runtime resolves local server config from repo defaults", () => {
  const config = resolveLocalServerConfig();
  assert.equal(config.enabled, true);
  assert.equal(config.baseUrl, "http://127.0.0.1:8091/v1");
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.port, 8091);
  assert.match(config.binary, /llama-server$/);
  assert.match(config.modelPath, /google_gemma-4-E2B-it-Q4_K_M\.gguf$/);
});

test("deriveProviderName treats localhost endpoints as local", () => {
  assert.equal(deriveProviderName("http://127.0.0.1:8080/v1"), "local");
  assert.equal(deriveProviderName("https://api.openai.com/v1", false), "openai");
});
