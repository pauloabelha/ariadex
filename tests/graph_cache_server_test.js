const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const {
  createLogger,
  createServer,
  buildSnapshotFromDataset,
  createEntityCache,
  createGraphCacheService,
  hashCacheKey,
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

test("buildSnapshotFromDataset ranks full tweet set even when contributionById marks tweets false", () => {
  const dataset = {
    canonicalRootId: "root",
    rootTweet: {
      id: "root",
      text: "Root tweet",
      author_id: "u1"
    },
    tweets: [
      {
        id: "root",
        text: "Root tweet",
        author_id: "u1",
        conversation_id: "root"
      },
      {
        id: "reply-1",
        text: "Reply one",
        author_id: "u2",
        conversation_id: "root",
        referenced_tweets: [{ type: "replied_to", id: "root" }]
      },
      {
        id: "reply-2",
        text: "Reply two",
        author_id: "u3",
        conversation_id: "root",
        referenced_tweets: [{ type: "replied_to", id: "root" }]
      }
    ],
    contributionById: {
      root: true,
      "reply-1": false,
      "reply-2": false
    },
    warnings: []
  };

  const snapshot = buildSnapshotFromDataset(dataset, new Set());

  assert.equal(snapshot.diagnostics.filter.inputTweetCount, 3);
  assert.equal(snapshot.diagnostics.filter.filteredTweetCount, 3);
  assert.equal(snapshot.diagnostics.filter.removedTweetCount, 0);
  assert.equal(snapshot.diagnostics.filter.contributionFilterEnabled, false);
  assert.ok(snapshot.nodes.length >= 3);
});

test("buildSnapshotFromDataset emits a path-anchored artifact when clicked tweet is provided", () => {
  const dataset = {
    canonicalRootId: "root",
    rootTweet: {
      id: "root",
      text: "Root tweet",
      author_id: "u1"
    },
    tweets: [
      {
        id: "root",
        text: "Root tweet with https://example.com/doc.pdf and https://x.com/alice/status/42?s=20",
        author_id: "u1"
      },
      {
        id: "seed",
        text: "Explored tweet that quotes the root and cites https://youtu.be/demo123 with enough detail to matter in the path selection.",
        author_id: "u2",
        quote_of: "root",
        likes: 10,
        quote_count: 2,
        author_profile: { public_metrics: { followers_count: 1000 } }
      },
      {
        id: "reply",
        text: "This reply adds enough detail to be substantive and should be selected because it contains a concrete critique of the methods and data release.",
        author_id: "u3",
        reply_to: "seed",
        likes: 30,
        quote_count: 4,
        author_profile: { public_metrics: { followers_count: 2000 } }
      }
    ],
    warnings: []
  };

  const snapshot = buildSnapshotFromDataset(dataset, new Set(), { clickedTweetId: "seed" });

  assert.equal(snapshot.pathAnchored.artifact.exploredTweetId, "seed");
  assert.equal(snapshot.pathAnchored.artifact.mandatoryPath.length, 2);
  assert.equal(snapshot.pathAnchored.artifact.references.length, 2);
  assert.equal(snapshot.pathAnchored.artifact.references[0].kind, "document");
  assert.equal(snapshot.pathAnchored.tweetReferences.length, 1);
  assert.equal(snapshot.pathAnchored.tweetReferences[0].tweetId, "42");
  assert.equal(snapshot.pathAnchored.artifact.tweetReferences.length, 1);
  assert.equal(snapshot.pathAnchored.artifact.tweetReferences[0].canonicalUrl, "https://x.com/alice/status/42");
});

test("createEntityCache persists tweet and user entities via cache store", () => {
  const store = {
    map: new Map(),
    get(key) {
      return this.map.get(key) || null;
    },
    set(key, value, ttlMs) {
      this.map.set(key, {
        value,
        expiresAtMs: Date.now() + ttlMs
      });
    }
  };

  const entityCache = createEntityCache({ cacheStore: store });
  entityCache.setTweet({ id: "t1", text: "tweet" });
  entityCache.setUser({ id: "u1", username: "alice" });

  assert.equal(entityCache.getTweet("t1").text, "tweet");
  assert.equal(entityCache.getUser("u1").username, "alice");
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

test("createServer serves conversation article payloads", async () => {
  const records = [];
  const logger = createLogger({
    level: "debug",
    sink: (record) => records.push(record)
  });

  const service = {
    async getSnapshot() {
      throw new Error("getSnapshot should not be called");
    },
    async getArticle(params) {
      assert.equal(params.clickedTweetId, "123");
      return {
        article: {
          title: "Digest",
          dek: "Dek",
          summary: "Summary",
          sections: [{ heading: "Section", body: "Body" }]
        },
        pdf: {
          filename: "digest.pdf",
          mimeType: "application/pdf",
          base64: "JVBERi0xLjQ=",
          byteLength: 8
        },
        snapshot: {
          canonicalRootId: "1"
        },
        cache: {
          hit: true
        }
      };
    }
  };

  const server = createServer(service, { logger });
  const response = await invokeServer(server, {
    method: "POST",
    url: "/v1/conversation-article",
    bodyText: JSON.stringify({
      clickedTweetId: "123",
      mode: "deep"
    })
  });

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.payload);
  assert.equal(body.article.title, "Digest");
  assert.equal(body.pdf.filename, "digest.pdf");
  const completed = records.find((record) => record.event === "http_request_completed" && record.url === "/v1/conversation-article");
  assert.ok(completed);
  assert.equal(completed.articleCacheHit, true);
});

test("createGraphCacheService getArticle reuses cached snapshot without incremental refresh by default", async () => {
  const originalCreateClient = xApiClient.createClient;
  const originalResolveCanonicalRootTweetId = xApiClient.resolveCanonicalRootTweetId;
  const originalCollectConnectedApiTweetsIncremental = xApiClient.collectConnectedApiTweetsIncremental;

  const cacheStore = {
    map: new Map(),
    get(key) {
      return this.map.get(key) || null;
    },
    set(key, value, ttlMs) {
      this.map.set(key, {
        value,
        expiresAtMs: Date.now() + ttlMs
      });
    }
  };

  const snapshotCacheKey = hashCacheKey("root|fast|v3|rank:path_anchored_graph|following:none");
  cacheStore.set(snapshotCacheKey, {
    dataset: {
      canonicalRootId: "root",
      rootTweet: { id: "root", text: "Root", author_id: "u1" },
      tweets: [
        { id: "root", text: "Root", author_id: "u1", conversation_id: "root" },
        { id: "reply-1", text: "Reply", author_id: "u2", conversation_id: "root", referenced_tweets: [{ type: "replied_to", id: "root" }] }
      ],
      users: [],
      warnings: []
    }
  }, 60_000);

  let incrementalCalls = 0;
  xApiClient.createClient = async () => ({
    request: async () => {
      throw new Error("request should not be used on cached article path");
    },
    options: {}
  });
  xApiClient.resolveCanonicalRootTweetId = async () => "root";
  xApiClient.collectConnectedApiTweetsIncremental = async () => {
    incrementalCalls += 1;
    return { tweets: [], users: [] };
  };

  try {
    const service = createGraphCacheService({
      bearerToken: "test-token",
      cacheStore,
      articleGenerator: {
        signature: "article:test",
        async generateArticle() {
          return {
            title: "Digest",
            dek: "",
            summary: "Summary",
            sections: []
          };
        }
      },
      logger: createLogger({ level: "silent" })
    });

    const result = await service.getArticle({
      clickedTweetId: "clicked",
      mode: "fast",
      requestId: "req-1"
    });

    assert.equal(incrementalCalls, 0);
    assert.equal(result.snapshot.cache.hit, true);
    assert.equal(result.article.title, "Digest");
  } finally {
    xApiClient.createClient = originalCreateClient;
    xApiClient.resolveCanonicalRootTweetId = originalResolveCanonicalRootTweetId;
    xApiClient.collectConnectedApiTweetsIncremental = originalCollectConnectedApiTweetsIncremental;
  }
});

test("createGraphCacheService scopes article cache by explored tweet id", async () => {
  const originalCreateClient = xApiClient.createClient;
  const originalResolveCanonicalRootTweetId = xApiClient.resolveCanonicalRootTweetId;
  const originalCollectConnectedApiTweetsIncremental = xApiClient.collectConnectedApiTweetsIncremental;

  const cacheStore = {
    map: new Map(),
    get(key) {
      return this.map.get(key) || null;
    },
    set(key, value, ttlMs) {
      this.map.set(key, {
        value,
        expiresAtMs: Date.now() + ttlMs
      });
    }
  };

  const snapshotCacheKey = hashCacheKey("root|fast|v3|rank:path_anchored_graph|following:none");
  cacheStore.set(snapshotCacheKey, {
    dataset: {
      canonicalRootId: "root",
      rootTweet: { id: "root", text: "Root", author_id: "u1" },
      tweets: [
        { id: "root", text: "Root", author_id: "u1", conversation_id: "root" },
        { id: "seed-a", text: "Seed A", author_id: "u2", conversation_id: "root", referenced_tweets: [{ type: "replied_to", id: "root" }] },
        { id: "seed-b", text: "Seed B", author_id: "u3", conversation_id: "root", referenced_tweets: [{ type: "replied_to", id: "root" }] }
      ],
      users: [],
      warnings: []
    }
  }, 60_000);

  let articleCalls = 0;
  xApiClient.createClient = async () => ({
    request: async () => {
      throw new Error("request should not be used on cached article path");
    },
    options: {}
  });
  xApiClient.resolveCanonicalRootTweetId = async () => "root";
  xApiClient.collectConnectedApiTweetsIncremental = async () => ({ tweets: [], users: [] });

  try {
    const service = createGraphCacheService({
      bearerToken: "test-token",
      cacheStore,
      articleGenerator: {
        signature: "article:test",
        async generateArticle({ clickedTweetId }) {
          articleCalls += 1;
          return {
            title: `Digest ${clickedTweetId}`,
            dek: "",
            summary: `Summary ${clickedTweetId}`,
            sections: []
          };
        }
      },
      logger: createLogger({ level: "silent" })
    });

    const first = await service.getArticle({
      clickedTweetId: "seed-a",
      mode: "fast",
      requestId: "req-a"
    });
    const second = await service.getArticle({
      clickedTweetId: "seed-b",
      mode: "fast",
      requestId: "req-b"
    });

    assert.equal(articleCalls, 2);
    assert.equal(first.article.title, "Digest seed-a");
    assert.equal(second.article.title, "Digest seed-b");
    assert.notEqual(first.cache.key, second.cache.key);
  } finally {
    xApiClient.createClient = originalCreateClient;
    xApiClient.resolveCanonicalRootTweetId = originalResolveCanonicalRootTweetId;
    xApiClient.collectConnectedApiTweetsIncremental = originalCollectConnectedApiTweetsIncremental;
  }
});

test("createGraphCacheService skips incremental refresh when snapshot cache is still fresh", async () => {
  const originalCreateClient = xApiClient.createClient;
  const originalResolveCanonicalRootTweetId = xApiClient.resolveCanonicalRootTweetId;
  const originalCollectConnectedApiTweetsIncremental = xApiClient.collectConnectedApiTweetsIncremental;

  const cacheStore = {
    map: new Map(),
    get(key) {
      return this.map.get(key) || null;
    },
    set(key, value, ttlMs) {
      this.map.set(key, {
        value,
        expiresAtMs: Date.now() + ttlMs
      });
    }
  };

  const snapshotCacheKey = hashCacheKey("root|deep|v3|rank:path_anchored_graph|following:none");
  cacheStore.set(snapshotCacheKey, {
    dataset: {
      canonicalRootId: "root",
      rootTweet: { id: "root", text: "Root", author_id: "u1" },
      tweets: [
        { id: "root", text: "Root", author_id: "u1", conversation_id: "root" },
        { id: "clicked", text: "Clicked", author_id: "u2", conversation_id: "root", quote_of: "root", referenced_tweets: [{ type: "quoted", id: "root" }] }
      ],
      users: [],
      warnings: []
    },
    cachedAtMs: Date.now()
  }, 60_000);

  let incrementalCalls = 0;
  xApiClient.createClient = async () => ({
    request: async () => {
      throw new Error("request should not be used on fresh cached snapshot path");
    },
    options: {}
  });
  xApiClient.resolveCanonicalRootTweetId = async () => "root";
  xApiClient.collectConnectedApiTweetsIncremental = async () => {
    incrementalCalls += 1;
    return { tweets: [], users: [] };
  };

  try {
    const service = createGraphCacheService({
      bearerToken: "test-token",
      cacheStore,
      logger: createLogger({ level: "silent" })
    });

    const result = await service.getSnapshot({
      clickedTweetId: "clicked",
      mode: "deep",
      incremental: true,
      requestId: "req-fresh"
    });

    assert.equal(incrementalCalls, 0);
    assert.equal(result.cache.hit, true);
  } finally {
    xApiClient.createClient = originalCreateClient;
    xApiClient.resolveCanonicalRootTweetId = originalResolveCanonicalRootTweetId;
    xApiClient.collectConnectedApiTweetsIncremental = originalCollectConnectedApiTweetsIncremental;
  }
});

test("createGraphCacheService hydrates only missing path tweets from cache", async () => {
  const originalCreateClient = xApiClient.createClient;
  const originalResolveCanonicalRootTweetId = xApiClient.resolveCanonicalRootTweetId;
  const originalCollectConnectedApiTweetsIncremental = xApiClient.collectConnectedApiTweetsIncremental;
  const originalFetchTweetById = xApiClient.fetchTweetById;

  const cacheStore = {
    map: new Map(),
    get(key) {
      return this.map.get(key) || null;
    },
    set(key, value, ttlMs) {
      this.map.set(key, {
        value,
        expiresAtMs: Date.now() + ttlMs
      });
    }
  };

  const snapshotCacheKey = hashCacheKey("root|deep|v3|rank:path_anchored_graph|following:none");
  cacheStore.set(snapshotCacheKey, {
    dataset: {
      canonicalRootId: "root",
      rootTweet: { id: "root", text: "Root", author_id: "u1" },
      tweets: [
        { id: "root", text: "Root", author_id: "u1", conversation_id: "root" }
      ],
      users: [],
      warnings: []
    },
    cachedAtMs: Date.now()
  }, 60_000);

  let incrementalCalls = 0;
  const fetchedIds = [];
  xApiClient.createClient = async () => ({
    request: async () => {
      throw new Error("request should not be used directly on missing path hydration test");
    },
    options: {},
    entityCache: {
      getTweet: () => null,
      getUser: () => null
    }
  });
  xApiClient.resolveCanonicalRootTweetId = async () => "root";
  xApiClient.collectConnectedApiTweetsIncremental = async () => {
    incrementalCalls += 1;
    return { tweets: [], users: [] };
  };
  xApiClient.fetchTweetById = async (_client, tweetId) => {
    fetchedIds.push(tweetId);
    if (tweetId === "clicked") {
      return {
        tweet: {
          id: "clicked",
          author_id: "u2",
          text: "Clicked quote",
          referenced_tweets: [{ type: "quoted", id: "parent" }],
          public_metrics: {}
        },
        users: [{ id: "u2", username: "clicked", name: "Clicked", public_metrics: {} }]
      };
    }
    if (tweetId === "parent") {
      return {
        tweet: {
          id: "parent",
          author_id: "u3",
          text: "Parent reply",
          referenced_tweets: [{ type: "replied_to", id: "root" }],
          public_metrics: {}
        },
        users: [{ id: "u3", username: "parent", name: "Parent", public_metrics: {} }]
      };
    }
    return { tweet: null, users: [] };
  };

  try {
    const service = createGraphCacheService({
      bearerToken: "test-token",
      cacheStore,
      logger: createLogger({ level: "silent" })
    });

    const result = await service.getSnapshot({
      clickedTweetId: "clicked",
      mode: "deep",
      incremental: true,
      requestId: "req-path"
    });

    assert.equal(incrementalCalls, 0);
    assert.deepEqual(fetchedIds, ["clicked", "parent", "root"]);
    assert.equal(result.cache.hit, true);
    assert.deepEqual(result.pathAnchored.mandatoryPathIds, ["root", "parent", "clicked"]);
  } finally {
    xApiClient.createClient = originalCreateClient;
    xApiClient.resolveCanonicalRootTweetId = originalResolveCanonicalRootTweetId;
    xApiClient.collectConnectedApiTweetsIncremental = originalCollectConnectedApiTweetsIncremental;
    xApiClient.fetchTweetById = originalFetchTweetById;
  }
});

test("createGraphCacheService rehydrates incomplete cached path tweets and recovers ancestor references", async () => {
  const originalCreateClient = xApiClient.createClient;
  const originalResolveCanonicalRootTweetId = xApiClient.resolveCanonicalRootTweetId;
  const originalCollectConnectedApiTweetsIncremental = xApiClient.collectConnectedApiTweetsIncremental;
  const originalFetchTweetById = xApiClient.fetchTweetById;

  const cacheStore = {
    map: new Map(),
    get(key) {
      return this.map.get(key) || null;
    },
    set(key, value, ttlMs) {
      this.map.set(key, {
        value,
        expiresAtMs: Date.now() + ttlMs
      });
    }
  };

  const snapshotCacheKey = hashCacheKey("root|deep|v3|rank:path_anchored_graph|following:none");
  cacheStore.set(snapshotCacheKey, {
    dataset: {
      canonicalRootId: "root",
      rootTweet: { id: "root", text: "Old root", author_id: "u1" },
      tweets: [
        { id: "root", text: "Old root", author_id: "u1" },
        { id: "clicked", text: "Clicked", author_id: "u2", quote_of: "parent", referenced_tweets: [{ type: "quoted", id: "parent" }] }
      ],
      users: [],
      warnings: []
    },
    cachedAtMs: Date.now()
  }, 60_000);

  const fetchedIds = [];
  xApiClient.createClient = async () => ({
    request: async () => {
      throw new Error("request should not be used directly");
    },
    options: {},
    entityCache: {
      getTweet: () => null,
      getUser: () => null
    }
  });
  xApiClient.resolveCanonicalRootTweetId = async () => "root";
  xApiClient.collectConnectedApiTweetsIncremental = async () => ({ tweets: [], users: [] });
  xApiClient.fetchTweetById = async (_client, tweetId) => {
    fetchedIds.push(tweetId);
    if (tweetId === "clicked") {
      return {
        tweet: {
          id: "clicked",
          author_id: "u2",
          text: "Clicked",
          referenced_tweets: [{ type: "quoted", id: "parent" }],
          public_metrics: {},
          entities: { urls: [] }
        },
        users: [{ id: "u2", username: "clicked", name: "Clicked", public_metrics: {} }]
      };
    }
    if (tweetId === "parent") {
      return {
        tweet: {
          id: "parent",
          author_id: "u3",
          text: "Parent reply",
          referenced_tweets: [{ type: "replied_to", id: "root" }],
          public_metrics: {},
          entities: { urls: [] }
        },
        users: [{ id: "u3", username: "parent", name: "Parent", public_metrics: {} }]
      };
    }
    if (tweetId === "root") {
      return {
        tweet: {
          id: "root",
          author_id: "u1",
          text: "Root with article",
          referenced_tweets: [],
          public_metrics: {},
          entities: {
            urls: [{ expanded_url: "https://example.com/root-article" }]
          }
        },
        users: [{ id: "u1", username: "root", name: "Root", public_metrics: {} }]
      };
    }
    return { tweet: null, users: [] };
  };

  try {
    const service = createGraphCacheService({
      bearerToken: "test-token",
      cacheStore,
      logger: createLogger({ level: "silent" })
    });

    const result = await service.getSnapshot({
      clickedTweetId: "clicked",
      mode: "deep",
      incremental: true,
      requestId: "req-rehydrate"
    });

    assert.deepEqual(fetchedIds, ["clicked", "parent", "root"]);
    assert.deepEqual(result.pathAnchored.mandatoryPathIds, ["root", "parent", "clicked"]);
    assert.equal(result.pathAnchored.references.some((ref) => ref.canonicalUrl === "https://example.com/root-article"), true);
  } finally {
    xApiClient.createClient = originalCreateClient;
    xApiClient.resolveCanonicalRootTweetId = originalResolveCanonicalRootTweetId;
    xApiClient.collectConnectedApiTweetsIncremental = originalCollectConnectedApiTweetsIncremental;
    xApiClient.fetchTweetById = originalFetchTweetById;
  }
});

test("normalizeViewerHandles keeps valid unique handles", () => {
  const handles = normalizeViewerHandles(["@PauloAbelha", "pauloabelha", "bad handle", "@Another_One"]);
  assert.deepEqual(handles, ["pauloabelha", "another_one"]);
});

test("normalizeViewerHandles rejects reserved nav tokens like more", () => {
  const handles = normalizeViewerHandles(["@more", "more", "@pauloabelha"]);
  assert.deepEqual(handles, ["pauloabelha"]);
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
