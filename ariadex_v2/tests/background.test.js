const test = require("node:test");
const assert = require("node:assert/strict");

const background = require("../extension/background.js");

function createChromeStub(initialCache = {}) {
  let cache = { ...initialCache };

  return {
    runtime: {
      lastError: null,
      onMessage: {
        addListener() {}
      }
    },
    storage: {
      local: {
        get(_keys, callback) {
          callback({ [background.TWEET_CACHE_KEY]: cache });
        },
        set(value, callback) {
          cache = { ...(value?.[background.TWEET_CACHE_KEY] || {}) };
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
  const token = background.buildSyndicationToken("2035043544617168917");
  assert.equal(typeof token, "string");
  assert.ok(token.length > 0);
});

test("normalizeTweet maps only the fields needed for v2", () => {
  const tweet = background.normalizeTweet({
    id_str: "10",
    text: "hello",
    in_reply_to_status_id_str: "9",
    quoted_tweet: { id_str: "8" },
    user: { screen_name: "alice" }
  });

  assert.deepEqual(tweet, {
    id: "10",
    author: "alice",
    text: "hello",
    url: "https://x.com/alice/status/10",
    quotedId: "8",
    repliedToId: "9"
  });
});

test("resolveParentId prioritizes quoted parent over reply parent", () => {
  assert.deepEqual(
    background.resolveParentId({
      quotedId: "100",
      repliedToId: "200"
    }),
    { parentId: "100", relationType: "quote" }
  );
});

test("resolveParentId falls back to reply parent", () => {
  assert.deepEqual(
    background.resolveParentId({
      quotedId: "",
      repliedToId: "200"
    }),
    { parentId: "200", relationType: "reply" }
  );
});

test("fetchTweet hits the network only on cache miss and writes through", async () => {
  const chromeStub = createChromeStub();
  const storage = background.createStorageAdapter(chromeStub);
  const fetchImpl = createFetchStub({
    10: { id_str: "10", text: "hello", user: { screen_name: "alice" } }
  });
  const client = background.createTweetClient(fetchImpl);

  const first = await background.fetchTweet("10", { storage, client });
  const second = await background.fetchTweet("10", { storage, client });

  assert.equal(first.id_str, "10");
  assert.equal(second.id_str, "10");
  assert.deepEqual(fetchImpl.calls, ["10"]);
  assert.equal(chromeStub.inspectCache()["10"].id_str, "10");
});

test("resolveRootPath walks quote parent first and then reply ancestry", async () => {
  const chromeStub = createChromeStub();
  const storage = background.createStorageAdapter(chromeStub);
  const fetchImpl = createFetchStub({
    30: {
      id_str: "30",
      text: "clicked",
      user: { screen_name: "clicked" },
      quoted_tweet: { id_str: "20" },
      in_reply_to_status_id_str: "999"
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
  });
  const client = background.createTweetClient(fetchImpl);

  const path = await background.resolveRootPath("30", { storage, client });

  assert.deepEqual(
    path.map((entry) => [entry.id, entry.outboundRelation]),
    [
      ["10", ""],
      ["20", "reply"],
      ["30", "quote"]
    ]
  );
});

test("resolveRootPath stops at cycles", async () => {
  const chromeStub = createChromeStub();
  const storage = background.createStorageAdapter(chromeStub);
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
  const client = background.createTweetClient(fetchImpl);

  const path = await background.resolveRootPath("10", { storage, client });

  assert.deepEqual(path.map((entry) => entry.id), ["20", "10"]);
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
  const storage = background.createStorageAdapter(chromeStub);
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
  const client = background.createTweetClient(fetchImpl);

  const path = await background.resolveRootPath("30", { storage, client });

  assert.deepEqual(path.map((entry) => entry.id), ["10", "20", "30"]);
  assert.deepEqual(fetchImpl.calls, ["30", "10"]);
});
