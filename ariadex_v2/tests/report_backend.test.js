const test = require("node:test");
const assert = require("node:assert/strict");

const reportBackend = require("../server/report_backend.js");

test("resolveProviderConfig uses OpenAI settings", () => {
  const config = reportBackend.resolveProviderConfig({
    OPENAI_API_KEY: "openai-key",
    OPENAI_MODEL: "gpt-4.1-mini"
  }, {
    llm: {
      baseUrl: "https://api.openai.com/v1"
    }
  });

  assert.deepEqual(config, {
    provider: "openai",
    apiBaseUrl: "https://api.openai.com/v1",
    model: "gpt-4.1-mini",
    apiKey: "openai-key"
  });
});

test("resolveProviderConfig rejects missing OpenAI credentials", () => {
  assert.throws(
    () => reportBackend.resolveProviderConfig({}, {}),
    /missing_openai_api_key/
  );
});

test("callReportModel sends prompt and artifact to chat completions", async () => {
  const calls = [];
  const report = await reportBackend.callReportModel({
    fetchImpl: async (url, options = {}) => {
      calls.push({
        url: String(url),
        method: options.method || "GET",
        headers: options.headers || {},
        body: String(options.body || "")
      });
      return {
        ok: true,
        async json() {
          return {
            choices: [{
              message: {
                content: "Narrative report."
              }
            }]
          };
        }
      };
    },
    artifact: {
      path: [{ id: "1", text: "Root" }],
      references: [],
      people: [],
      replyChains: []
    },
    prompt: "Explain the conversation clearly.",
    providerConfig: {
      provider: "openai",
      apiBaseUrl: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      apiKey: "openai-key"
    }
  });

  assert.equal(report.text, "Narrative report.");
  assert.equal(report.provider, "openai");
  assert.equal(calls[0].url, "https://api.openai.com/v1/chat/completions");
  assert.equal(calls[0].method, "POST");
  assert.match(calls[0].body, /Explain the conversation clearly/);
  assert.match(calls[0].body, /\\"path\\"/);
});
