const test = require("node:test");
const assert = require("node:assert/strict");

const startLocalLlm = require("../scripts/start_local_llm.js");
const smokeLocalLlm = require("../scripts/smoke_local_llm.js");

test("start_local_llm launches llama-server with configured host and port", () => {
  const spawnCalls = [];
  const handlers = {};
  const child = {
    killed: false,
    killCalls: [],
    on(event, handler) {
      handlers[event] = handler;
    },
    kill(signal) {
      this.killCalls.push(signal);
      this.killed = true;
    }
  };
  const processObj = {
    exitCode: 0,
    signals: {},
    on(event, handler) {
      this.signals[event] = handler;
    }
  };

  const result = startLocalLlm.run({
    resolveConfig() {
      return {
        enabled: true,
        baseUrl: "http://127.0.0.1:8091/v1",
        binary: "/tmp/llama-server",
        modelPath: "/tmp/model.gguf",
        host: "127.0.0.1",
        port: 8091,
        model: "google_gemma-4-E2B-it-Q4_K_M"
      };
    },
    existsSyncImpl(filePath) {
      return filePath === "/tmp/llama-server" || filePath === "/tmp/model.gguf";
    },
    spawnImpl(command, args, options) {
      spawnCalls.push({ command, args, options });
      return child;
    },
    consoleImpl: { log() {} },
    processObj
  });

  assert.equal(spawnCalls.length, 1);
  assert.equal(spawnCalls[0].command, "/tmp/llama-server");
  assert.deepEqual(spawnCalls[0].args, ["-m", "/tmp/model.gguf", "--host", "127.0.0.1", "--port", "8091"]);
  assert.deepEqual(result.command, ["/tmp/llama-server", "-m", "/tmp/model.gguf", "--host", "127.0.0.1", "--port", "8091"]);

  handlers.exit(0, null);
  assert.equal(processObj.exitCode, 0);

  processObj.signals.SIGINT();
  assert.deepEqual(child.killCalls, ["SIGTERM"]);
});

test("start_local_llm fails fast when local llm is disabled", () => {
  assert.throws(
    () => startLocalLlm.run({
      resolveConfig() {
        return { enabled: false };
      }
    }),
    /Local LLM is disabled/
  );
});

test("smoke_local_llm throws if classifier returns no labels", async () => {
  await assert.rejects(
    () => smokeLocalLlm.run({
      resolveEndpointBaseImpl() {
        return "http://127.0.0.1:8091/v1";
      },
      resolveContributionModelImpl() {
        return "google_gemma-4-E2B-it-Q4_K_M";
      },
      createClassifierImpl() {
        return {
          async classifyTweets() {
            return {
              llmProvider: "local",
              classifiedCount: 0
            };
          }
        };
      },
      createArticleGeneratorImpl() {
        return {
          async generateArticle() {
            return {
              llmProvider: "local",
              usedLlm: false,
              usedOpenAi: false,
              title: "unused",
              summary: "unused",
              sections: []
            };
          }
        };
      },
      consoleImpl: { log() {} }
    }),
    /Local classifier did not return any labels/
  );
});

test("smoke_local_llm returns local classifier success and article fallback summary", async () => {
  const logs = [];
  const output = await smokeLocalLlm.run({
    resolveEndpointBaseImpl() {
      return "http://127.0.0.1:8091/v1";
    },
    resolveContributionModelImpl() {
      return "google_gemma-4-E2B-it-Q4_K_M";
    },
    createClassifierImpl() {
      return {
        async classifyTweets() {
          return {
            llmProvider: "local",
            classifiedCount: 2,
            contributingCount: 1,
            nonContributingCount: 1,
            byTweetId: { t1: true, t2: false },
            reasonByTweetId: { t1: "argument", t2: "reaction" }
          };
        }
      };
    },
    createArticleGeneratorImpl() {
      return {
        async generateArticle() {
          return {
            llmProvider: "local",
            usedLlm: false,
            usedOpenAi: false,
            title: "@root conversation",
            summary: "fallback summary",
            sections: [
              { heading: "Original tweet", body: "" },
              { heading: "Digest summary", body: "" }
            ]
          };
        }
      };
    },
    consoleImpl: {
      log(value) {
        logs.push(value);
      }
    }
  });

  assert.equal(output.endpointBase, "http://127.0.0.1:8091/v1");
  assert.equal(output.classifier.llmProvider, "local");
  assert.equal(output.classifier.classifiedCount, 2);
  assert.equal(output.article.llmProvider, "local");
  assert.equal(output.article.usedLlm, false);
  assert.deepEqual(output.article.headings, ["Original tweet", "Digest summary"]);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /"usedLlm": false/);
});
