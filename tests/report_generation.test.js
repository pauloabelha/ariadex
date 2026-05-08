const test = require("node:test");
const assert = require("node:assert/strict");

const reportGeneration = require("../extension/report_generation.js");

test("normalizeReportSettings accepts aliases and removes trailing slashes", () => {
  assert.deepEqual(
    reportGeneration.normalizeReportSettings({
      backendBaseUrl: "http://127.0.0.1:8787/"
    }),
    { backendBaseUrl: "http://127.0.0.1:8787" }
  );
  assert.deepEqual(reportGeneration.normalizeReportSettings({}), {
    backendBaseUrl: "http://127.0.0.1:8787"
  });
});

test("extractChatCompletionText supports string and content-part responses", () => {
  assert.equal(
    reportGeneration.extractChatCompletionText({
      choices: [{ message: { content: " plain text " } }]
    }),
    "plain text"
  );
  assert.equal(
    reportGeneration.extractChatCompletionText({
      choices: [{
        message: {
          content: [
            { type: "text", text: "part one " },
            "part two",
            { type: "image_url", image_url: { url: "ignored" } }
          ]
        }
      }]
    }),
    "part one part two"
  );
  assert.equal(reportGeneration.extractChatCompletionText({ choices: [] }), "");
});

test("generateReport posts the artifact to the report endpoint and emits progress", async () => {
  const calls = [];
  const progress = [];

  const report = await reportGeneration.generateReport({
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      return {
        ok: true,
        async json() {
          return {
            report: {
              text: "Narrative report.",
              model: "gpt-4o-mini",
              apiBaseUrl: "https://api.openai.com/v1",
              provider: "openai"
            }
          };
        }
      };
    },
    artifact: {
      path: [{ id: "1" }],
      references: [],
      people: [],
      replyChains: []
    },
    settings: {
      reportBackendBaseUrl: "http://127.0.0.1:8787/"
    },
    onProgress(event) {
      progress.push(event);
    }
  });

  assert.equal(calls[0].url, "http://127.0.0.1:8787/v1/report");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers["Content-Type"], "application/json");
  assert.match(calls[0].options.body, /"path"/);
  assert.deepEqual(progress.map((event) => event.phase), [
    "calling_report_backend",
    "awaiting_llm_response",
    "report_ready"
  ]);
  assert.deepEqual(report, {
    text: "Narrative report.",
    model: "gpt-4o-mini",
    apiBaseUrl: "https://api.openai.com/v1",
    provider: "openai"
  });
});

test("generateGist posts to the gist endpoint and uses gist progress phases", async () => {
  const calls = [];
  const progress = [];

  const gist = await reportGeneration.generateGist({
    fetchImpl: async (url) => {
      calls.push(String(url));
      return {
        ok: true,
        async json() {
          return {
            report: {
              text: "Portable gist.",
              model: "gpt-4o-mini",
              apiBaseUrl: "https://api.openai.com/v1",
              provider: "openai"
            }
          };
        }
      };
    },
    artifact: {
      path: [{ id: "1" }],
      references: [],
      people: [],
      replyChains: []
    },
    onProgress(event) {
      progress.push(event);
    }
  });

  assert.equal(calls[0], "http://127.0.0.1:8787/v1/gist");
  assert.deepEqual(progress.map((event) => event.phase), [
    "calling_gist_backend",
    "awaiting_llm_response",
    "gist_ready"
  ]);
  assert.equal(gist.text, "Portable gist.");
});

test("generateReport surfaces backend failures with response details", async () => {
  await assert.rejects(
    () => reportGeneration.generateReport({
      fetchImpl: async () => ({
        ok: false,
        status: 500,
        async text() {
          return "backend exploded with a very useful detail";
        }
      }),
      artifact: {
        path: [],
        references: [],
        people: [],
        replyChains: []
      }
    }),
    /report_generation_failed_500:backend exploded/
  );
});

test("generateReport rejects missing dependencies and empty model responses", async () => {
  await assert.rejects(
    () => reportGeneration.generateReport({
      artifact: {}
    }),
    /missing_fetch_implementation/
  );
  await assert.rejects(
    () => reportGeneration.generateReport({
      fetchImpl: async () => ({ ok: true, async json() { return { report: { text: "" } }; } }),
      artifact: null
    }),
    /missing_report_artifact/
  );
  await assert.rejects(
    () => reportGeneration.generateReport({
      fetchImpl: async () => ({ ok: true, async json() { return { report: { text: "" } }; } }),
      artifact: {}
    }),
    /empty_report_response/
  );
});
