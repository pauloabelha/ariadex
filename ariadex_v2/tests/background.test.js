const test = require("node:test");
const assert = require("node:assert/strict");

const algo = require("../extension/algo.js");
const background = require("../extension/background.js");

function createChromeStub(initialCache = {}) {
  let cache = { ...initialCache };

  return {
    runtime: {
      lastError: null,
      onMessage: {
        addListener() {}
      },
      onConnect: {
        addListener() {}
      }
    },
    storage: {
      local: {
        get(_keys, callback) {
          callback({ [algo.TWEET_CACHE_KEY]: cache });
        },
        set(value, callback) {
          cache = { ...(value?.[algo.TWEET_CACHE_KEY] || {}) };
          callback();
        },
        remove(_keys, callback) {
          cache = {};
          callback();
        }
      }
    },
    inspectCache() {
      return { ...cache };
    }
  };
}

function createFetchStub(payloadById) {
  const calls = [];

  async function fetchImpl(url) {
    const match = String(url).match(/[?&]id=(\d+)/);
    const id = match ? match[1] : "";
    calls.push(id);
    const payload = payloadById[id];
    if (!payload) {
      return {
        ok: false,
        status: 404,
        async json() {
          return {};
        }
      };
    }

    return {
      ok: true,
      status: 200,
      async json() {
        return payload;
      }
    };
  }

  fetchImpl.calls = calls;
  return fetchImpl;
}

test("buildSyndicationToken returns a stable token string", () => {
  const token = algo.buildSyndicationToken("2035043544617168917");
  assert.equal(typeof token, "string");
  assert.ok(token.length > 0);
});

test("normalizeTweet maps only the fields needed for v2", () => {
  const tweet = algo.normalizeTweet({
    id_str: "10",
    text: "hello",
    in_reply_to_status_id_str: "9",
    quoted_tweet: { id_str: "8" },
    entities: {
      urls: [
        { expanded_url: "https://example.com/a?utm_source=x" }
      ]
    },
    user: { screen_name: "alice" }
  });

  assert.deepEqual(tweet, {
    id: "10",
    author: "alice",
    text: "hello",
    url: "https://x.com/alice/status/10",
    referenceUrls: ["https://example.com/a?utm_source=x"],
    quotedId: "8",
    repliedToId: "9"
  });
});

test("canonicalizeReferenceUrl strips trackers and ignores x urls", () => {
  assert.equal(
    algo.canonicalizeReferenceUrl("https://Example.com/a/?utm_source=x#frag"),
    "https://example.com/a"
  );
  assert.equal(
    algo.canonicalizeReferenceUrl("https://youtu.be/abc123?si=noise"),
    "https://youtube.com/watch?v=abc123"
  );
  assert.equal(algo.canonicalizeReferenceUrl("https://x.com/a/status/1"), "");
});

test("buildReferenceArtifact dedupes references and assigns stable numbers", () => {
  const artifact = algo.buildReferenceArtifact([
    {
      id: "10",
      referenceUrls: ["https://example.com/a?utm_source=1", "https://x.com/a/status/1"]
    },
    {
      id: "20",
      referenceUrls: ["https://example.com/a", "https://example.com/b"]
    }
  ]);

  assert.deepEqual(artifact.references.map((ref) => [ref.number, ref.canonicalUrl]), [
    [1, "https://example.com/a"],
    [2, "https://example.com/b"]
  ]);
  assert.deepEqual(artifact.path.map((tweet) => tweet.referenceNumbers), [
    [1],
    [1, 2]
  ]);
});

test("buildReferenceArtifact collapses repeated path references from bare and absolute urls", () => {
  const artifact = algo.buildReferenceArtifact([
    {
      id: "root",
      referenceUrls: ["https://example.com/home"]
    },
    {
      id: "ancestor",
      referenceUrls: ["causalai.net/r120.pdf"]
    },
    {
      id: "explored",
      referenceUrls: ["https://causalai.net/r120.pdf"]
    }
  ]);

  assert.deepEqual(artifact.references.map((ref) => [ref.number, ref.canonicalUrl]), [
    [1, "https://example.com/home"],
    [2, "https://causalai.net/r120.pdf"]
  ]);
  assert.deepEqual(artifact.path.map((tweet) => [tweet.id, tweet.referenceNumbers]), [
    ["root", [1]],
    ["ancestor", [2]],
    ["explored", [2]]
  ]);
});

test("resolveParentId prioritizes quoted parent over reply parent", () => {
  assert.deepEqual(
    algo.resolveParentId({
      quotedId: "100",
      repliedToId: "200"
    }),
    { parentId: "100", relationType: "quote" }
  );
});

test("resolveParentId falls back to reply parent", () => {
  assert.deepEqual(
    algo.resolveParentId({
      quotedId: "",
      repliedToId: "200"
    }),
    { parentId: "200", relationType: "reply" }
  );
});

test("fetchTweet hits the network only on cache miss and writes through", async () => {
  const chromeStub = createChromeStub();
  const storage = algo.createStorageAdapter(chromeStub);
  const fetchImpl = createFetchStub({
    10: { id_str: "10", text: "hello", user: { screen_name: "alice" } }
  });
  const client = algo.createTweetClient(fetchImpl);

  const first = await algo.fetchTweet("10", { storage, client });
  const second = await algo.fetchTweet("10", { storage, client });

  assert.equal(first.id_str, "10");
  assert.equal(second.id_str, "10");
  assert.deepEqual(fetchImpl.calls, ["10"]);
  assert.equal(chromeStub.inspectCache()["10"].id_str, "10");
});

test("resolveRootPath walks quote parent first and then reply ancestry", async () => {
  const chromeStub = createChromeStub();
  const storage = algo.createStorageAdapter(chromeStub);
  const fetchImpl = createFetchStub({
    30: {
      id_str: "30",
      text: "clicked",
      user: { screen_name: "clicked" },
      entities: {
        urls: [
          { expanded_url: "https://example.com/c" }
        ]
      },
      quoted_tweet: { id_str: "20" },
      in_reply_to_status_id_str: "999"
    },
    20: {
      id_str: "20",
      text: "quoted reply",
      user: { screen_name: "quoted" },
      entities: {
        urls: [
          { expanded_url: "https://example.com/b" }
        ]
      },
      in_reply_to_status_id_str: "10"
    },
    10: {
      id_str: "10",
      text: "root",
      user: { screen_name: "root" },
      entities: {
        urls: [
          { expanded_url: "https://example.com/a" }
        ]
      }
    }
  });
  const client = algo.createTweetClient(fetchImpl);

  const artifact = await algo.resolveRootPath("30", { storage, client });

  assert.deepEqual(
    artifact.path.map((entry) => [entry.id, entry.outboundRelation]),
    [
      ["10", ""],
      ["20", "reply"],
      ["30", "quote"]
    ]
  );
  assert.deepEqual(artifact.path.map((entry) => entry.referenceNumbers), [
    [1],
    [2],
    [3]
  ]);
  assert.deepEqual(artifact.references.map((entry) => entry.canonicalUrl), [
    "https://example.com/a",
    "https://example.com/b",
    "https://example.com/c"
  ]);
});

test("resolveRootPath stops at cycles", async () => {
  const chromeStub = createChromeStub();
  const storage = algo.createStorageAdapter(chromeStub);
  const fetchImpl = createFetchStub({
    10: {
      id_str: "10",
      text: "a",
      user: { screen_name: "a" },
      in_reply_to_status_id_str: "20"
    },
    20: {
      id_str: "20",
      text: "b",
      user: { screen_name: "b" },
      in_reply_to_status_id_str: "10"
    }
  });
  const client = algo.createTweetClient(fetchImpl);

  const artifact = await algo.resolveRootPath("10", { storage, client });

  assert.deepEqual(artifact.path.map((entry) => entry.id), ["20", "10"]);
});

test("resolveRootPath reuses cache entries across a recursive walk", async () => {
  const chromeStub = createChromeStub({
    20: {
      id_str: "20",
      text: "quoted reply",
      user: { screen_name: "quoted" },
      in_reply_to_status_id_str: "10"
    }
  });
  const storage = algo.createStorageAdapter(chromeStub);
  const fetchImpl = createFetchStub({
    30: {
      id_str: "30",
      text: "clicked",
      user: { screen_name: "clicked" },
      quoted_tweet: { id_str: "20" }
    },
    10: {
      id_str: "10",
      text: "root",
      user: { screen_name: "root" }
    }
  });
  const client = algo.createTweetClient(fetchImpl);

  const artifact = await algo.resolveRootPath("30", { storage, client });

  assert.deepEqual(artifact.path.map((entry) => entry.id), ["10", "20", "30"]);
  assert.deepEqual(fetchImpl.calls, ["30", "10"]);
});

test("background controller clears the stored tweet cache", async () => {
  const chromeStub = createChromeStub({
    10: { id_str: "10" }
  });
  const controller = background.createBackgroundController({
    chromeApi: chromeStub,
    fetchImpl: createFetchStub({})
  });

  await controller.clearCache();

  assert.deepEqual(chromeStub.inspectCache(), {});
});

test("background controller forwards progress events when resolving through the controller", async () => {
  const chromeStub = createChromeStub();
  const controller = background.createBackgroundController({
    chromeApi: chromeStub,
    fetchImpl: createFetchStub({
      30: {
        id_str: "30",
        text: "clicked",
        user: { screen_name: "clicked" },
        quoted_tweet: { id_str: "20" }
      },
      20: {
        id_str: "20",
        text: "quoted reply",
        user: { screen_name: "quoted" },
        in_reply_to_status_id_str: "10"
      },
      10: {
        id_str: "10",
        text: "root",
        user: { screen_name: "root" }
      }
    })
  });

  const phases = [];
  const artifact = await controller.resolveRootPath("30", {
    onProgress(progress) {
      phases.push(progress.phase);
    }
  });

  assert.deepEqual(phases, ["start", "path_walk", "path_walk", "path_walk", "canonicalizing_refs", "done"]);
  assert.deepEqual(artifact.path.map((entry) => entry.id), ["10", "20", "30"]);
});
