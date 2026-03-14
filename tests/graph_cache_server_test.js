const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const {
  createLogger,
  createServer
} = require("../server/graph_cache_server.js");

test("createLogger respects log level filtering", () => {
  const records = [];
  const logger = createLogger({
    level: "info",
    sink: (record) => records.push(record)
  });

  logger.debug("debug_hidden", { a: 1 });
  logger.info("info_visible", { b: 2 });

  assert.equal(records.length, 1);
  assert.equal(records[0].event, "info_visible");
  assert.equal(records[0].b, 2);
});

function invokeServer(server, { method, url, bodyText = "" }) {
  return new Promise((resolve, reject) => {
    const req = new EventEmitter();
    req.method = method;
    req.url = url;
    req.headers = {};
    req.setEncoding = () => {};

    const headers = {};
    let statusCode = null;
    let payload = "";
    const res = {
      setHeader(name, value) {
        headers[String(name).toLowerCase()] = value;
      },
      writeHead(nextStatusCode, nextHeaders = {}) {
        statusCode = nextStatusCode;
        for (const [name, value] of Object.entries(nextHeaders)) {
          headers[String(name).toLowerCase()] = value;
        }
      },
      end(chunk = "") {
        payload += String(chunk || "");
        resolve({
          statusCode,
          headers,
          payload
        });
      }
    };

    try {
      server.emit("request", req, res);
    } catch (error) {
      reject(error);
      return;
    }

    process.nextTick(() => {
      if (bodyText) {
        req.emit("data", bodyText);
      }
      req.emit("end");
    });
  });
}

test("createServer logs request lifecycle and sets request id header", async () => {
  const records = [];
  const logger = createLogger({
    level: "debug",
    sink: (record) => records.push(record)
  });

  const service = {
    async getSnapshot() {
      return {
        canonicalRootId: "1",
        rootId: "1",
        root: null,
        nodes: [],
        edges: [],
        ranking: [],
        rankingMeta: { scoreById: {} },
        warnings: [],
        cache: { hit: true, mode: "fast" }
      };
    }
  };

  const server = createServer(service, { logger });

  const response = await invokeServer(server, {
    method: "POST",
    url: "/v1/conversation-snapshot",
    bodyText: JSON.stringify({
      clickedTweetId: "123",
      mode: "fast"
    })
  });

  assert.equal(response.statusCode, 200);
  const requestId = response.headers["x-ariadex-request-id"];
  assert.ok(requestId);
  assert.ok(String(requestId).length >= 16);

  const started = records.find((record) => record.event === "http_request_started");
  const completed = records.find((record) => record.event === "http_request_completed");
  assert.ok(started);
  assert.ok(completed);
  assert.equal(started.method, "POST");
  assert.equal(completed.statusCode, 200);
});

test("createServer returns 400 for invalid json with structured warning log", async () => {
  const records = [];
  const logger = createLogger({
    level: "debug",
    sink: (record) => records.push(record)
  });

  const service = {
    async getSnapshot() {
      return {};
    }
  };

  const server = createServer(service, { logger });
  const response = await invokeServer(server, {
    method: "POST",
    url: "/v1/conversation-snapshot",
    bodyText: "{bad-json"
  });

  assert.equal(response.statusCode, 400);
  const invalid = records.find((record) => record.event === "http_request_invalid_json");
  assert.ok(invalid);
  assert.equal(invalid.statusCode, 400);
});
