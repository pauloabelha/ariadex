const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const devWithGraphCache = require("../scripts/dev_with_graph_cache.js");

test("withDefaults produces local graph-cache dev defaults", () => {
  const env = devWithGraphCache.withDefaults({});

  assert.equal(env.ARIADEX_ENV, "dev");
  assert.equal(env.ARIADEX_ALLOW_CLIENT_DIRECT_API, "false");
  assert.equal(env.ARIADEX_GRAPH_CACHE_PORT, "8787");
  assert.equal(env.ARIADEX_GRAPH_API_URL, "http://127.0.0.1:8787");
  assert.equal(env.ARIADEX_GRAPH_API_URL_DEV, "http://127.0.0.1:8787");
  assert.ok(env.ARIADEX_GRAPH_CACHE_FILE.endsWith(path.join(".cache", "graph_cache_store.json")));
});

test("withDefaults derives local graph api url from custom port", () => {
  const env = devWithGraphCache.withDefaults({
    ARIADEX_GRAPH_CACHE_PORT: "9911"
  });

  assert.equal(env.ARIADEX_GRAPH_API_URL, "http://127.0.0.1:9911");
  assert.equal(env.ARIADEX_GRAPH_API_URL_DEV, "http://127.0.0.1:9911");
});

test("ensureBearer accepts either X bearer env var and rejects missing bearer", () => {
  assert.doesNotThrow(() => devWithGraphCache.ensureBearer({ X_BEARER_TOKEN: "token-a" }));
  assert.doesNotThrow(() => devWithGraphCache.ensureBearer({ X_API_BEARER_TOKEN: "token-b" }));
  assert.throws(() => devWithGraphCache.ensureBearer({}), /Missing X_BEARER_TOKEN/);
});

test("run syncs local extension config env and spawns graph cache server", () => {
  const spawnCalls = [];
  const childHandlers = {};
  const processHandlers = {};
  let syncCalls = 0;
  const child = {
    killed: false,
    on(event, handler) {
      childHandlers[event] = handler;
    },
    kill(signal) {
      this.killed = signal;
    }
  };
  const processObj = {
    env: {},
    execPath: "/usr/bin/node",
    exitCode: 0,
    on(event, handler) {
      processHandlers[event] = handler;
    }
  };

  const result = devWithGraphCache.run({
    buildEnvObjectImpl() {
      return {
        X_BEARER_TOKEN: "token",
        ARIADEX_GRAPH_CACHE_PORT: "9911"
      };
    },
    syncFromEnvironmentImpl() {
      syncCalls += 1;
    },
    spawnImpl(command, args, options) {
      spawnCalls.push({ command, args, options });
      return child;
    },
    processObj
  });

  assert.equal(syncCalls, 1);
  assert.equal(processObj.env.ARIADEX_ENV, "dev");
  assert.equal(processObj.env.ARIADEX_GRAPH_API_URL, "http://127.0.0.1:9911");
  assert.equal(processObj.env.ARIADEX_GRAPH_API_URL_DEV, "http://127.0.0.1:9911");
  assert.equal(spawnCalls.length, 1);
  assert.equal(spawnCalls[0].command, "/usr/bin/node");
  assert.ok(spawnCalls[0].args[0].endsWith(path.join("server", "graph_cache_server.js")));
  assert.equal(spawnCalls[0].options.env.ARIADEX_GRAPH_CACHE_PORT, "9911");
  assert.equal(result.env.ARIADEX_GRAPH_API_URL, "http://127.0.0.1:9911");

  processHandlers.SIGINT();
  assert.equal(child.killed, "SIGTERM");

  childHandlers.exit(0, null);
  assert.equal(processObj.exitCode, 0);
});
