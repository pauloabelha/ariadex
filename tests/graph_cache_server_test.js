const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const {
  createLogger,
  createServer,
  normalizeViewerHandles,
  enrichFollowingSetFromViewerHandles
} = require("../server/graph_cache_server.js");
const xApiClient = require("../data/x_api_client.js");

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
    async getSnapshot(params) {
      assert.ok(params.requestId);
      return {
        canonicalRootId: "1",
        rootId: "1",
        root: null,
        nodes: [],
        edges: [],
        ranking: [],
        rankingMeta: { scoreById: {} },
        warnings: [],
        diagnostics: {
          ranking: {
            rankingCount: 0,
            nonZeroScoreCount: 0
          },
          emptyRankingReason: "no_nodes"
        },
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
  assert.equal(response.headers["access-control-allow-private-network"], "true");

  const started = records.find((record) => record.event === "http_request_started");
  const completed = records.find((record) => record.event === "http_request_completed");
  assert.ok(started);
  assert.ok(completed);
  assert.equal(started.method, "POST");
  assert.equal(completed.statusCode, 200);
  assert.equal(completed.rankingCount, 0);
  assert.equal(completed.nonZeroScoreCount, 0);
  assert.equal(completed.emptyRankingReason, "no_nodes");
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
  assert.equal(response.headers["access-control-allow-private-network"], "true");
  const invalid = records.find((record) => record.event === "http_request_invalid_json");
  assert.ok(invalid);
  assert.equal(invalid.statusCode, 400);
});

test("normalizeViewerHandles keeps valid unique handles", () => {
  const handles = normalizeViewerHandles(["@PauloAbelha", "pauloabelha", "bad handle", "@Another_One"]);
  assert.deepEqual(handles, ["pauloabelha", "another_one"]);
});

test("enrichFollowingSetFromViewerHandles resolves following ids from first valid viewer handle", async () => {
  const originalFetchUserByUsername = xApiClient.fetchUserByUsername;
  const originalFetchFollowingUserIds = xApiClient.fetchFollowingUserIds;

  xApiClient.fetchUserByUsername = async (_client, handle) => {
    if (handle === "pauloabelha") {
      return { id: "viewer-1", username: "pauloabelha" };
    }
    return null;
  };
  xApiClient.fetchFollowingUserIds = async (_client, userId) => {
    assert.equal(userId, "viewer-1");
    return ["42", "77"];
  };

  const records = [];
  const logger = createLogger({
    level: "debug",
    sink: (record) => records.push(record)
  });

  try {
    const result = await enrichFollowingSetFromViewerHandles({
      followingSet: new Set(),
      viewerHandles: ["@pauloabelha"],
      client: { request: async () => ({}) },
      logger,
      requestId: "req-1"
    });

    assert.equal(result.resolvedFromViewer, true);
    assert.equal(result.viewerHandleUsed, "@pauloabelha");
    assert.equal(result.followingSet.has("42"), true);
    assert.equal(result.followingSet.has("77"), true);
    assert.equal(records.some((record) => record.event === "snapshot_following_resolved_from_viewer"), true);
  } finally {
    xApiClient.fetchUserByUsername = originalFetchUserByUsername;
    xApiClient.fetchFollowingUserIds = originalFetchFollowingUserIds;
  }
});
