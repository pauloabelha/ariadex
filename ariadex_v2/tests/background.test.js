const test = require("node:test");
const assert = require("node:assert/strict");

const algo = require("../extension/algo.js");
const background = require("../extension/background.js");

function createChromeStub(initialCache = {}, initialConversationCache = {}, initialLocalStorage = {}) {
  let cache = { ...initialCache };
  let conversationCache = { ...initialConversationCache };
  let localStorageEntries = { ...initialLocalStorage };
  const listeners = {
    message: null,
    connect: null
  };

  return {
    runtime: {
      id: "abc123",
      lastError: null,
      getURL(path) {
        return `chrome-extension://abc123/${path}`;
      },
      onMessage: {
        addListener(listener) {
          listeners.message = listener;
        }
      },
      onConnect: {
        addListener(listener) {
          listeners.connect = listener;
        }
      }
    },
    storage: {
      local: {
        get(keys, callback) {
          const requestedKeys = Array.isArray(keys) ? keys : Object.keys(keys || {});
          const result = {};

          for (const key of requestedKeys) {
            if (key === algo.TWEET_CACHE_KEY) {
              result[key] = cache;
              continue;
            }
            if (key === algo.CONVERSATION_CACHE_KEY) {
              result[key] = conversationCache;
              continue;
            }
            if (Object.prototype.hasOwnProperty.call(localStorageEntries, key)) {
              result[key] = localStorageEntries[key];
            }
          }

          callback(result);
        },
        set(value, callback) {
          if (Object.prototype.hasOwnProperty.call(value || {}, algo.TWEET_CACHE_KEY)) {
            cache = { ...(value?.[algo.TWEET_CACHE_KEY] || {}) };
          }
          if (Object.prototype.hasOwnProperty.call(value || {}, algo.CONVERSATION_CACHE_KEY)) {
            conversationCache = { ...(value?.[algo.CONVERSATION_CACHE_KEY] || {}) };
          }
          for (const [key, entryValue] of Object.entries(value || {})) {
            if (key === algo.TWEET_CACHE_KEY || key === algo.CONVERSATION_CACHE_KEY) {
              continue;
            }
            localStorageEntries[key] = entryValue;
          }
          callback();
        },
        remove(_keys, callback) {
          cache = {};
          conversationCache = {};
          callback();
        }
      }
    },
    inspectCache() {
      return { ...cache };
    },
    inspectConversationCache() {
      return { ...conversationCache };
    },
    triggerMessage(message, sender, sendResponse) {
      return listeners.message ? listeners.message(message, sender, sendResponse) : false;
    },
    triggerConnect(port) {
      if (listeners.connect) {
        listeners.connect(port);
      }
    }
  };
}

function createFetchStub(payloadById, options = {}) {
  const calls = [];
  const userByUsername = new Map();
  let nextUserId = 1;

  function ensureUserFromPayload(payload) {
    const username = String(payload?.user?.screen_name || "").trim();
    if (!username) {
      return null;
    }
    const normalizedUsername = username.replace(/^@+/, "");
    if (!userByUsername.has(normalizedUsername)) {
      userByUsername.set(normalizedUsername, {
        id: `u${nextUserId}`,
        username: normalizedUsername,
        name: String(payload?.user?.name || "").trim(),
        profile_image_url: String(payload?.user?.profile_image_url_https || payload?.user?.profile_image_url || "").trim()
      });
      nextUserId += 1;
    }
    return userByUsername.get(normalizedUsername);
  }

  Object.values(payloadById).forEach((payload) => {
    ensureUserFromPayload(payload);
  });

  function resolveConversationId(tweetId, seen = new Set()) {
    const normalizedId = String(tweetId || "");
    if (!normalizedId || seen.has(normalizedId)) {
      return normalizedId;
    }
    seen.add(normalizedId);
    const payload = payloadById[normalizedId];
    if (!payload) {
      return normalizedId;
    }
    const explicitConversationId = String(payload.conversation_id_str || "").trim();
    if (explicitConversationId) {
      return explicitConversationId;
    }
    const parentId = String(payload.in_reply_to_status_id_str || "").trim();
    if (!parentId) {
      return normalizedId;
    }
    return resolveConversationId(parentId, seen);
  }

  function toApiTweet(payload) {
    if (!payload?.id_str) {
      return null;
    }
    const author = ensureUserFromPayload(payload);
    const mentions = Array.isArray(payload?.entities?.user_mentions)
      ? payload.entities.user_mentions.map((mention) => ({
        id: `m:${String(mention?.screen_name || "").replace(/^@+/, "").toLowerCase()}`,
        username: String(mention?.screen_name || "").replace(/^@+/, "")
      }))
      : [];
    const urls = Array.isArray(payload?.entities?.urls)
      ? payload.entities.urls.map((entry) => ({
        expanded_url: entry?.expanded_url || entry?.url || "",
        unwound_url: entry?.expanded_url || entry?.url || "",
        url: entry?.url || entry?.expanded_url || ""
      }))
      : [];
    const referenced_tweets = [];
    if (payload?.in_reply_to_status_id_str) {
      referenced_tweets.push({ type: "replied_to", id: String(payload.in_reply_to_status_id_str) });
    }
    if (payload?.quoted_tweet?.id_str) {
      referenced_tweets.push({ type: "quoted", id: String(payload.quoted_tweet.id_str) });
    }

    return {
      id: String(payload.id_str),
      author_id: author?.id || "",
      conversation_id: resolveConversationId(payload.id_str),
      created_at: payload.created_at || "",
      text: String(payload.text || ""),
      entities: {
        mentions,
        urls
      },
      referenced_tweets
    };
  }

  async function fetchImpl(url) {
    const parsed = new URL(String(url));
    calls.push(parsed.pathname + parsed.search);

    if (/\/2\/tweets\/[^/]+$/.test(parsed.pathname)) {
      const id = parsed.pathname.split("/").pop();
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
          return {
            data: toApiTweet(payload),
            includes: {
              users: [ensureUserFromPayload(payload)].filter(Boolean)
            }
          };
        }
      };
    }

    if (parsed.pathname === "/2/tweets") {
      const ids = String(parsed.searchParams.get("ids") || "")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
      const payloads = ids.map((id) => payloadById[id]).filter(Boolean);
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            data: payloads.map((payload) => toApiTweet(payload)),
            includes: {
              users: payloads.map((payload) => ensureUserFromPayload(payload)).filter(Boolean)
            }
          };
        }
      };
    }

    if (parsed.pathname === "/2/tweets/search/all" && Number(options.searchAllStatus || 200) !== 200) {
      return {
        ok: false,
        status: Number(options.searchAllStatus || 403),
        async json() {
          return {};
        }
      };
    }

    if (parsed.pathname === "/2/tweets/search/recent" || parsed.pathname === "/2/tweets/search/all") {
      const query = String(parsed.searchParams.get("query") || "");
      const match = query.match(/^conversation_id:(.+)$/);
      const conversationId = match ? match[1] : "";
      const payloads = Object.values(payloadById).filter((payload) => resolveConversationId(payload.id_str) === conversationId);
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            data: payloads.map((payload) => toApiTweet(payload)),
            includes: {
              users: payloads.map((payload) => ensureUserFromPayload(payload)).filter(Boolean)
            },
            meta: {}
          };
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

function createClient(fetchImpl) {
  return algo.createTweetClient(fetchImpl, { bearerToken: "test-token" });
}

test("buildApiUrl writes stable X API urls", () => {
  const url = algo.buildApiUrl(algo.DEFAULT_API_BASE_URL, "/tweets/10", {
    expansions: ["author_id"],
    "tweet.fields": ["author_id", "conversation_id"]
  });

  assert.equal(url.toString(), "https://api.x.com/2/tweets/10?expansions=author_id&tweet.fields=author_id%2Cconversation_id");
});

test("normalizeTweet maps only the fields needed for v2", () => {
  const tweet = algo.normalizeTweet({
    id_str: "10",
    text: "hello",
    in_reply_to_status_id_str: "9",
    quoted_tweet: { id_str: "8" },
    entities: {
      user_mentions: [
        { screen_name: "Bob", name: "Bob Example", profile_image_url_https: "https://img.example/bob.jpg" }
      ],
      urls: [
        { expanded_url: "https://example.com/a?utm_source=x" }
      ]
    },
    user: { screen_name: "alice", name: "Alice Example", profile_image_url_https: "https://img.example/alice.jpg" }
  });

  assert.deepEqual(tweet, {
    id: "10",
    conversationId: "10",
    createdAt: "",
    author: "alice",
    authorName: "Alice Example",
    authorAvatarUrl: "https://img.example/alice.jpg",
    text: "hello",
    url: "https://x.com/alice/status/10",
    referenceUrls: ["https://example.com/a?utm_source=x"],
    mentionHandles: ["bob"],
    mentionPeople: [{ handle: "bob", displayName: "Bob Example", avatarUrl: "https://img.example/bob.jpg" }],
    quotedId: "8",
    repliedToId: "9"
  });
});

test("normalizeTweet returns null for payloads without a stable tweet id", () => {
  assert.equal(
    algo.normalizeTweet({
      text: "missing id",
      user: { screen_name: "alice" }
    }),
    null
  );
});

test("extractReferenceUrls keeps explicit url entities and drops blanks", () => {
  assert.deepEqual(
    algo.extractReferenceUrls({
      entities: {
        urls: [
          { expanded_url: "https://example.com/a" },
          { url: "https://example.com/b" },
          { expanded_url: "   " },
          {}
        ]
      }
    }),
    ["https://example.com/a", "https://example.com/b"]
  );
});

test("canonicalizeHandle normalizes x handles and rejects invalid values", () => {
  assert.equal(algo.canonicalizeHandle("@Alice_1"), "alice_1");
  assert.equal(algo.canonicalizeHandle(" bad handle "), "");
  assert.equal(algo.canonicalizeHandle(""), "");
});

test("normalizeDisplayName trims and collapses whitespace", () => {
  assert.equal(algo.normalizeDisplayName("  Alice \n Example  "), "Alice Example");
  assert.equal(algo.normalizeDisplayName(""), "");
});

test("normalizeAvatarUrl trims and preserves avatar urls", () => {
  assert.equal(algo.normalizeAvatarUrl(" https://img.example/a.jpg "), "https://img.example/a.jpg");
  assert.equal(algo.normalizeAvatarUrl(""), "");
});

test("extractMentionHandles keeps explicit user mentions and drops invalid handles", () => {
  assert.deepEqual(
    algo.extractMentionHandles({
      entities: {
        user_mentions: [
          { screen_name: "Alice" },
          { screen_name: "@Bob" },
          { screen_name: "bad handle" }
        ]
      }
    }),
    ["alice", "bob"]
  );
});

test("extractMentionPeople keeps display names alongside canonical handles", () => {
  assert.deepEqual(
    algo.extractMentionPeople({
      entities: {
        user_mentions: [
          { screen_name: "Alice", name: "Alice Example", profile_image_url_https: "https://img.example/alice.jpg" },
          { screen_name: "@Bob", name: "  Bob   Example ", profile_image_url_https: "https://img.example/bob.jpg" },
          { screen_name: "bad handle", name: "Ignored" }
        ]
      }
    }),
    [
      { handle: "alice", displayName: "Alice Example", avatarUrl: "https://img.example/alice.jpg" },
      { handle: "bob", displayName: "Bob Example", avatarUrl: "https://img.example/bob.jpg" }
    ]
  );
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

test("canonicalizeReferenceUrl returns empty for invalid urls and normalizes youtube watch params", () => {
  assert.equal(algo.canonicalizeReferenceUrl("not a valid url%%%"), "");
  assert.equal(
    algo.canonicalizeReferenceUrl("youtube.com/watch?v=abc123&si=noise&feature=shared"),
    "https://youtube.com/watch?v=abc123"
  );
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

test("buildPeopleArtifact dedupes path authors and mentions by canonical handle", () => {
  const artifact = algo.buildPeopleArtifact([
    {
      id: "10",
      author: "Alice",
      authorName: "Alice Example",
      authorAvatarUrl: "https://img.example/alice.jpg",
      mentionPeople: [
        { handle: "Bob", displayName: "Bob Example", avatarUrl: "https://img.example/bob.jpg" },
        { handle: "@carol", displayName: "Carol Example", avatarUrl: "" },
        { handle: "bad handle", displayName: "Ignored" }
      ]
    },
    {
      id: "20",
      author: "bob",
      authorName: "Bobby",
      authorAvatarUrl: "",
      mentionPeople: [
        { handle: "alice", displayName: "Alice Example", avatarUrl: "" },
        { handle: "Bob", displayName: "" }
      ]
    }
  ]);

  assert.deepEqual(artifact.people.map((person) => person.handle), [
    "alice",
    "bob",
    "carol"
  ]);
  assert.deepEqual(artifact.path.map((tweet) => [tweet.id, tweet.peopleHandles]), [
    ["10", ["alice", "bob", "carol"]],
    ["20", ["bob", "alice"]]
  ]);
  assert.deepEqual(artifact.people.map((person) => [person.handle, person.displayName]), [
    ["alice", "Alice Example"],
    ["bob", "Bob Example"],
    ["carol", "Carol Example"]
  ]);
  assert.deepEqual(artifact.people.map((person) => [person.handle, person.avatarUrl]), [
    ["alice", "https://img.example/alice.jpg"],
    ["bob", "https://img.example/bob.jpg"],
    ["carol", ""]
  ]);
  assert.deepEqual(artifact.people.map((person) => [person.handle, person.citedByTweetIds, person.sourceTypes]), [
    ["alice", ["10", "20"], ["author", "mention"]],
    ["bob", ["10", "20"], ["mention", "author"]],
    ["carol", ["10"], ["mention"]]
  ]);
});

test("buildLocalReplyChains defaults required participation to the anchor author but allows override", () => {
  const anchorTweet = {
    id: "10",
    author: "barenboim"
  };
  const conversationTweets = [
    {
      id: "11",
      author: "stephen",
      text: "first reply",
      repliedToId: "10",
      createdAt: "2026-03-20T10:00:00.000Z",
      url: "https://x.com/stephen/status/11"
    },
    {
      id: "12",
      author: "barenboim",
      text: "author follows up",
      repliedToId: "11",
      createdAt: "2026-03-20T11:00:00.000Z",
      url: "https://x.com/barenboim/status/12"
    }
  ];

  const defaultChains = algo.buildLocalReplyChains(anchorTweet, conversationTweets);
  assert.deepEqual(defaultChains[0].tweets.map((entry) => entry.id), ["11", "12"]);

  const overrideChains = algo.buildLocalReplyChains(anchorTweet, conversationTweets, {
    participantHandle: "stephen"
  });
  assert.deepEqual(overrideChains[0].tweets.map((entry) => entry.id), ["11"]);
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

test("resolveParentId returns an empty relation when the tweet has no structural parent", () => {
  assert.deepEqual(algo.resolveParentId(null), { parentId: "", relationType: "" });
  assert.deepEqual(algo.resolveParentId({ quotedId: "", repliedToId: "" }), { parentId: "", relationType: "" });
});

test("fetchTweet hits the network only on cache miss and writes through", async () => {
  const chromeStub = createChromeStub();
  const storage = algo.createStorageAdapter(chromeStub);
  const fetchImpl = createFetchStub({
    10: { id_str: "10", text: "hello", user: { screen_name: "alice" } }
  });
  const client = createClient(fetchImpl);

  const first = await algo.fetchTweet("10", { storage, client });
  const second = await algo.fetchTweet("10", { storage, client });

  assert.equal(first.id_str, "10");
  assert.equal(second.id_str, "10");
  assert.equal(fetchImpl.calls.length, 1);
  assert.match(fetchImpl.calls[0], /\/2\/tweets\/10\?/);
  assert.equal(chromeStub.inspectCache()["10"].id_str, "10");
});

test("fetchTweet coalesces concurrent requests for the same tweet id", async () => {
  algo.inFlightTweetFetchById.clear();
  const chromeStub = createChromeStub();
  const storage = algo.createStorageAdapter(chromeStub);
  let resolveFetch;
  let callCount = 0;
  const client = {
    fetchTweetFromNetwork() {
      callCount += 1;
      return new Promise((resolve) => {
        resolveFetch = resolve;
      });
    }
  };

  const firstPromise = algo.fetchTweet("10", { storage, client });
  const secondPromise = algo.fetchTweet("10", { storage, client });
  await new Promise((resolve) => setImmediate(resolve));
  resolveFetch({ id_str: "10", text: "hello", user: { screen_name: "alice" } });

  const [first, second] = await Promise.all([firstPromise, secondPromise]);

  assert.equal(callCount, 1);
  assert.equal(first.id_str, "10");
  assert.equal(second.id_str, "10");
});

test("fetchTweet rejects missing tweet ids before touching storage or network", async () => {
  const storage = {
    async readCache() {
      assert.fail("readCache should not run when the tweet id is missing");
    }
  };
  const client = {
    async fetchTweetFromNetwork() {
      assert.fail("fetchTweetFromNetwork should not run when the tweet id is missing");
    }
  };

  await assert.rejects(() => algo.fetchTweet("", { storage, client }), /missing_tweet_id/);
});

test("fetchTweets reads cached tweet ids first and only fetches missing ids", async () => {
  const chromeStub = createChromeStub({
    10: { id_str: "10", text: "cached", user: { screen_name: "alice" } }
  });
  const storage = algo.createStorageAdapter(chromeStub);
  const fetchImpl = createFetchStub({
    20: { id_str: "20", text: "from network", user: { screen_name: "bob" } }
  });
  const client = createClient(fetchImpl);

  const payloads = await algo.fetchTweets(["10", "20"], { storage, client });

  assert.deepEqual(payloads.map((payload) => payload.id_str), ["10", "20"]);
  assert.equal(fetchImpl.calls.length, 1);
  assert.match(fetchImpl.calls[0], /\/2\/tweets\?/);
  assert.equal(chromeStub.inspectCache()["20"].id_str, "20");
});

test("fetchConversation reuses a fully indexed conversation without hitting the X API", async () => {
  const chromeStub = createChromeStub({
    10: { id_str: "10", text: "root", user: { screen_name: "alice" } },
    20: { id_str: "20", text: "reply", user: { screen_name: "bob" }, in_reply_to_status_id_str: "10" }
  }, {
    10: { complete: true, tweetIds: ["10", "20"] }
  });
  const storage = algo.createStorageAdapter(chromeStub);
  const fetchImpl = createFetchStub({});
  const client = createClient(fetchImpl);

  const payloads = await algo.fetchConversation("10", { storage, client });

  assert.deepEqual(payloads.map((payload) => payload.id_str), ["10", "20"]);
  assert.deepEqual(fetchImpl.calls, []);
});

test("fetchConversation indexes fetched conversations so the next read is cache-only", async () => {
  const chromeStub = createChromeStub();
  const storage = algo.createStorageAdapter(chromeStub);
  const fetchImpl = createFetchStub({
    10: { id_str: "10", text: "root", user: { screen_name: "alice" } },
    20: { id_str: "20", text: "reply", user: { screen_name: "bob" }, in_reply_to_status_id_str: "10" }
  });
  const client = createClient(fetchImpl);

  const firstPayloads = await algo.fetchConversation("10", { storage, client });
  const firstCallCount = fetchImpl.calls.length;
  const secondPayloads = await algo.fetchConversation("10", { storage, client });

  assert.deepEqual(firstPayloads.map((payload) => payload.id_str), ["10", "20"]);
  assert.deepEqual(secondPayloads.map((payload) => payload.id_str), ["10", "20"]);
  assert.equal(fetchImpl.calls.length, firstCallCount);
  assert.deepEqual(chromeStub.inspectConversationCache(), {
    10: { complete: true, tweetIds: ["10", "20"] }
  });
});

test("fetchConversation falls back to recent search when full-archive search is unavailable", async () => {
  const chromeStub = createChromeStub();
  const storage = algo.createStorageAdapter(chromeStub);
  const fetchImpl = createFetchStub({
    10: { id_str: "10", text: "root", user: { screen_name: "alice" } },
    20: { id_str: "20", text: "reply", user: { screen_name: "bob" }, in_reply_to_status_id_str: "10" }
  }, {
    searchAllStatus: 403
  });
  const client = createClient(fetchImpl);

  const payloads = await algo.fetchConversation("10", { storage, client });

  assert.deepEqual(payloads.map((payload) => payload.id_str), ["10", "20"]);
  assert.equal(fetchImpl.calls.some((entry) => entry.startsWith("/2/tweets/search/all?")), true);
  assert.equal(fetchImpl.calls.some((entry) => entry.startsWith("/2/tweets/search/recent?")), true);
});

test("fetchConversation coalesces concurrent requests for the same conversation id", async () => {
  algo.inFlightConversationFetchById.clear();
  const chromeStub = createChromeStub();
  const storage = algo.createStorageAdapter(chromeStub);
  let resolveFetch;
  let callCount = 0;
  const client = createClient(async (url) => {
    if (String(url).includes("/search/all") || String(url).includes("/search/recent")) {
      callCount += 1;
      return new Promise((resolve) => {
        resolveFetch = () => resolve({
          ok: true,
          status: 200,
          async json() {
            return {
              data: [
                {
                  id: "10",
                  author_id: "u1",
                  conversation_id: "10",
                  text: "root",
                  entities: {},
                  referenced_tweets: []
                }
              ],
              includes: {
                users: [{ id: "u1", username: "alice", name: "Alice" }]
              },
              meta: {}
            };
          }
        });
      });
    }

    return {
      ok: true,
      status: 200,
      async json() {
        return { data: [], includes: { users: [] }, meta: {} };
      }
    };
  });

  const firstPromise = algo.fetchConversation("10", { storage, client });
  const secondPromise = algo.fetchConversation("10", { storage, client });
  await new Promise((resolve) => setImmediate(resolve));
  resolveFetch();

  const [first, second] = await Promise.all([firstPromise, secondPromise]);

  assert.equal(callCount, 1);
  assert.deepEqual(first.map((payload) => payload.id_str), ["10"]);
  assert.deepEqual(second.map((payload) => payload.id_str), ["10"]);
});

test("createTweetClient requests the X API endpoint with a bearer token", async () => {
  const calls = [];
  const client = createClient(async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      async json() {
        return {
          data: {
            id: "10",
            author_id: "u1",
            conversation_id: "10",
            text: "hello"
          },
          includes: {
            users: [{ id: "u1", username: "alice", name: "Alice Example" }]
          }
        };
      }
    };
  });

  await client.fetchTweetFromNetwork("10");

  assert.match(calls[0].url, /https:\/\/api\.x\.com\/2\/tweets\/10\?/);
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.headers.Authorization, "Bearer test-token");
});

test("createTweetClient surfaces network failures with the response status", async () => {
  const client = createClient(async () => ({
    ok: false,
    status: 503,
    async json() {
      return {};
    }
  }));

  await assert.rejects(() => client.fetchTweetFromNetwork("10"), /tweet_fetch_failed_503/);
});

test("resolveRootPath walks quote parent first and then reply ancestry", async () => {
  const chromeStub = createChromeStub();
  const storage = algo.createStorageAdapter(chromeStub);
  const fetchImpl = createFetchStub({
    30: {
      id_str: "30",
      text: "clicked",
      user: { screen_name: "clicked", name: "Clicked Author", profile_image_url_https: "https://img.example/clicked.jpg" },
      entities: {
        user_mentions: [
          { screen_name: "QuoteGuide", name: "Quote Guide", profile_image_url_https: "https://img.example/guide.jpg" }
        ],
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
      user: { screen_name: "quoted", name: "Quoted Author", profile_image_url_https: "https://img.example/quoted.jpg" },
      entities: {
        user_mentions: [
          { screen_name: "Root", name: "Root Author", profile_image_url_https: "https://img.example/root.jpg" }
        ],
        urls: [
          { expanded_url: "https://example.com/b" }
        ]
      },
      in_reply_to_status_id_str: "10"
    },
    10: {
      id_str: "10",
      text: "root",
      user: { screen_name: "root", name: "Root Author", profile_image_url_https: "https://img.example/root.jpg" },
      entities: {
        user_mentions: [
          { screen_name: "Quoted", name: "Quoted Author", profile_image_url_https: "https://img.example/quoted.jpg" }
        ],
        urls: [
          { expanded_url: "https://example.com/a" }
        ]
      }
    }
  });
  const client = createClient(fetchImpl);

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
  assert.deepEqual(artifact.path.map((entry) => [entry.id, entry.peopleHandles]), [
    ["10", ["root", "quoted"]],
    ["20", ["quoted", "root"]],
    ["30", ["clicked", "quoteguide"]]
  ]);
  assert.deepEqual(artifact.people.map((entry) => entry.handle), [
    "root",
    "quoted",
    "clicked",
    "quoteguide"
  ]);
  assert.deepEqual(artifact.people.map((entry) => [entry.handle, entry.displayName]), [
    ["root", "Root Author"],
    ["quoted", "Quoted Author"],
    ["clicked", "Clicked Author"],
    ["quoteguide", ""]
  ]);
  assert.deepEqual(artifact.people.map((entry) => [entry.handle, entry.avatarUrl]), [
    ["root", "https://img.example/root.jpg"],
    ["quoted", "https://img.example/quoted.jpg"],
    ["clicked", "https://img.example/clicked.jpg"],
    ["quoteguide", ""]
  ]);
});

test("resolveRootPath emits progress metadata for each phase", async () => {
  const chromeStub = createChromeStub();
  const storage = algo.createStorageAdapter(chromeStub);
  const fetchImpl = createFetchStub({
    20: {
      id_str: "20",
      text: "clicked",
      user: { screen_name: "clicked" },
      in_reply_to_status_id_str: "10"
    },
    10: {
      id_str: "10",
      text: "root",
      user: { screen_name: "root" }
    }
  });
  const client = createClient(fetchImpl);
  const progressEvents = [];

  await algo.resolveRootPath("20", {
    storage,
    client,
    onProgress(progress) {
      progressEvents.push(progress);
    }
  });

  // Keep the assertions explicit so a future shape change is caught immediately.
  assert.deepEqual(progressEvents, [
    { phase: "start", clickedTweetId: "20" },
    {
      phase: "path_walk",
      currentTweetId: "20",
      tweetCount: 1,
      ancestorCount: 0,
      nextParentId: "10",
      nextRelationType: "reply"
    },
    {
      phase: "path_walk",
      currentTweetId: "10",
      tweetCount: 2,
      ancestorCount: 1,
      nextParentId: "",
      nextRelationType: ""
    },
    { phase: "canonicalizing_refs", tweetCount: 2 },
    { phase: "collecting_local_reply_chains", conversationId: "10", conversationIds: ["10"] },
    { phase: "done", tweetCount: 2, referenceCount: 0 }
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
  const client = createClient(fetchImpl);

  const artifact = await algo.resolveRootPath("10", { storage, client });

  assert.deepEqual(artifact.path.map((entry) => entry.id), ["20", "10"]);
});

test("resolveRootPath stops cleanly when a fetched payload cannot be normalized", async () => {
  const chromeStub = createChromeStub();
  const storage = algo.createStorageAdapter(chromeStub);
  const client = {
    async fetchTweetFromNetwork() {
      return { text: "missing id" };
    }
  };

  const artifact = await algo.resolveRootPath("10", { storage, client });

  assert.deepEqual(artifact, {
    path: [],
    references: [],
    people: [],
    replyChains: []
  });
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
  const client = createClient(fetchImpl);

  const artifact = await algo.resolveRootPath("30", { storage, client });

  assert.deepEqual(artifact.path.map((entry) => entry.id), ["10", "20", "30"]);
  assert.equal(fetchImpl.calls.length, 6);
  assert.match(fetchImpl.calls[0], /\/2\/tweets\/30\?/);
  assert.match(fetchImpl.calls[1], /\/2\/tweets\/10\?/);
  assert.ok(fetchImpl.calls.filter((entry) => /\/2\/tweets\/search\/(all|recent)\?/.test(entry)).length >= 1);
});

test("resolveRootPath keeps only reply chains where the explored author participates", async () => {
  const chromeStub = createChromeStub();
  const storage = algo.createStorageAdapter(chromeStub);
  const fetchImpl = createFetchStub({
    30: {
      id_str: "30",
      conversation_id_str: "30",
      text: "clicked quote",
      user: { screen_name: "quoted" },
      quoted_tweet: { id_str: "20" }
    },
    20: {
      id_str: "20",
      conversation_id_str: "10",
      text: "quoted reply",
      user: { screen_name: "quoted" },
      in_reply_to_status_id_str: "10"
    },
    10: {
      id_str: "10",
      conversation_id_str: "10",
      text: "root",
      user: { screen_name: "root" }
    },
    40: {
      id_str: "40",
      conversation_id_str: "30",
      text: "direct reply",
      user: { screen_name: "quoted" },
      in_reply_to_status_id_str: "30"
    },
    50: {
      id_str: "50",
      conversation_id_str: "30",
      text: "reply branch continues",
      user: { screen_name: "eve" },
      in_reply_to_status_id_str: "40"
    },
    60: {
      id_str: "60",
      conversation_id_str: "30",
      text: "second direct reply",
      user: { screen_name: "mallory" },
      in_reply_to_status_id_str: "30"
    },
    70: {
      id_str: "70",
      conversation_id_str: "10",
      text: "someone replies to root instead",
      user: { screen_name: "trent" },
      in_reply_to_status_id_str: "10"
    }
  });
  const client = createClient(fetchImpl);

  const artifact = await algo.resolveRootPath("30", { storage, client });

  assert.equal(artifact.replyChains.length, 2);
  const exploredChain = artifact.replyChains.find((chain) => chain.anchorTweetId === "30");
  assert.deepEqual(exploredChain.participantHandles, ["quoted"]);
  assert.deepEqual(exploredChain.tweets.map((entry) => entry.id), ["40"]);
  const rootChain = artifact.replyChains.find((chain) => chain.anchorTweetId === "10");
  assert.deepEqual(rootChain.participantHandles, ["quoted"]);
  assert.deepEqual(rootChain.tweets.map((entry) => entry.id), ["20"]);
});

test("resolveRootPath trims each kept reply chain at the explored author's last tweet", async () => {
  const chromeStub = createChromeStub();
  const storage = algo.createStorageAdapter(chromeStub);
  const fetchImpl = createFetchStub({
    30: {
      id_str: "30",
      conversation_id_str: "30",
      text: "clicked quote",
      user: { screen_name: "quoted" },
      quoted_tweet: { id_str: "20" }
    },
    20: {
      id_str: "20",
      conversation_id_str: "10",
      text: "quoted reply",
      user: { screen_name: "quoted" },
      in_reply_to_status_id_str: "10"
    },
    10: {
      id_str: "10",
      conversation_id_str: "10",
      text: "root",
      user: { screen_name: "root" }
    },
    40: {
      id_str: "40",
      conversation_id_str: "30",
      text: "direct reply",
      user: { screen_name: "alice" },
      in_reply_to_status_id_str: "30"
    },
    50: {
      id_str: "50",
      conversation_id_str: "30",
      text: "author joins",
      user: { screen_name: "quoted" },
      in_reply_to_status_id_str: "40"
    },
    60: {
      id_str: "60",
      conversation_id_str: "30",
      text: "someone continues after author",
      user: { screen_name: "bob" },
      in_reply_to_status_id_str: "50"
    },
    70: {
      id_str: "70",
      conversation_id_str: "30",
      text: "author answers again",
      user: { screen_name: "quoted" },
      in_reply_to_status_id_str: "60"
    },
    80: {
      id_str: "80",
      conversation_id_str: "30",
      text: "extra tail after last author tweet",
      user: { screen_name: "carol" },
      in_reply_to_status_id_str: "70"
    }
  });
  const client = createClient(fetchImpl);

  const artifact = await algo.resolveRootPath("30", { storage, client });

  assert.equal(artifact.replyChains.length, 2);
  const exploredChain = artifact.replyChains.find((chain) => chain.anchorTweetId === "30");
  assert.deepEqual(exploredChain.tweets.map((entry) => entry.id), ["40", "50", "60", "70"]);
  assert.deepEqual(exploredChain.participantHandles, ["alice", "quoted", "bob"]);
});

test("resolveRootPath keeps all subtree tweets up to the explored author's last tweet", async () => {
  const chromeStub = createChromeStub();
  const storage = algo.createStorageAdapter(chromeStub);
  const fetchImpl = createFetchStub({
    30: {
      id_str: "30",
      conversation_id_str: "30",
      text: "clicked quote",
      user: { screen_name: "quoted" },
      quoted_tweet: { id_str: "20" }
    },
    20: {
      id_str: "20",
      conversation_id_str: "10",
      text: "quoted reply",
      user: { screen_name: "quoted" },
      in_reply_to_status_id_str: "10"
    },
    10: {
      id_str: "10",
      conversation_id_str: "10",
      text: "root",
      user: { screen_name: "root" }
    },
    40: {
      id_str: "40",
      conversation_id_str: "30",
      text: "direct reply",
      user: { screen_name: "alice" },
      in_reply_to_status_id_str: "30"
    },
    50: {
      id_str: "50",
      conversation_id_str: "30",
      text: "side reply one",
      user: { screen_name: "bob" },
      in_reply_to_status_id_str: "40"
    },
    55: {
      id_str: "55",
      conversation_id_str: "30",
      text: "side reply two",
      user: { screen_name: "carol" },
      in_reply_to_status_id_str: "40"
    },
    60: {
      id_str: "60",
      conversation_id_str: "30",
      text: "author closes the thread",
      user: { screen_name: "quoted" },
      in_reply_to_status_id_str: "55"
    },
    70: {
      id_str: "70",
      conversation_id_str: "30",
      text: "tail after author",
      user: { screen_name: "dan" },
      in_reply_to_status_id_str: "60"
    }
  });
  const client = createClient(fetchImpl);

  const artifact = await algo.resolveRootPath("30", { storage, client });

  assert.equal(artifact.replyChains.length, 2);
  const exploredChain = artifact.replyChains.find((chain) => chain.anchorTweetId === "30");
  assert.deepEqual(exploredChain.tweets.map((entry) => entry.id), ["40", "50", "55", "60"]);
  assert.deepEqual(exploredChain.participantHandles, ["alice", "bob", "carol", "quoted"]);
});

test("resolveRootPath aggregates reply chains across the full root-to-explored path", async () => {
  const chromeStub = createChromeStub();
  const storage = algo.createStorageAdapter(chromeStub);
  const fetchImpl = createFetchStub({
    30: {
      id_str: "30",
      conversation_id_str: "30",
      text: "clicked quote",
      user: { screen_name: "quoted" },
      quoted_tweet: { id_str: "20" }
    },
    20: {
      id_str: "20",
      conversation_id_str: "10",
      text: "quoted reply",
      user: { screen_name: "quoted" },
      in_reply_to_status_id_str: "10"
    },
    10: {
      id_str: "10",
      conversation_id_str: "10",
      text: "root",
      user: { screen_name: "root" }
    },
    11: {
      id_str: "11",
      conversation_id_str: "10",
      text: "reply to root",
      user: { screen_name: "alice" },
      in_reply_to_status_id_str: "10"
    },
    12: {
      id_str: "12",
      conversation_id_str: "10",
      text: "root author responds",
      user: { screen_name: "root" },
      in_reply_to_status_id_str: "11"
    }
  });
  const client = createClient(fetchImpl);

  const artifact = await algo.resolveRootPath("30", { storage, client });

  assert.equal(artifact.replyChains.length, 2);
  const rootChain = artifact.replyChains.find((chain) => chain.anchorTweetId === "10");
  assert.deepEqual(rootChain.tweets.map((entry) => entry.id), ["11", "12"]);
  assert.deepEqual(rootChain.participantHandles, ["alice", "root"]);
  const quotedParentChain = artifact.replyChains.find((chain) => chain.anchorTweetId === "20");
  assert.equal(quotedParentChain, undefined);
});

test("resolveRootPath includes references cited only inside reply chains", async () => {
  const chromeStub = createChromeStub();
  const storage = algo.createStorageAdapter(chromeStub);
  const fetchImpl = createFetchStub({
    30: {
      id_str: "30",
      conversation_id_str: "30",
      text: "clicked quote",
      user: { screen_name: "quoted" },
      quoted_tweet: { id_str: "20" }
    },
    20: {
      id_str: "20",
      conversation_id_str: "10",
      text: "quoted reply",
      user: { screen_name: "quoted" },
      in_reply_to_status_id_str: "10"
    },
    10: {
      id_str: "10",
      conversation_id_str: "10",
      text: "root",
      user: { screen_name: "root" }
    },
    11: {
      id_str: "11",
      conversation_id_str: "10",
      text: "reply with paper",
      user: { screen_name: "alice" },
      in_reply_to_status_id_str: "10",
      entities: {
        urls: [
          { expanded_url: "https://example.com/reply-paper?utm_source=x" }
        ]
      }
    },
    12: {
      id_str: "12",
      conversation_id_str: "10",
      text: "root replies",
      user: { screen_name: "root" },
      in_reply_to_status_id_str: "11"
    }
  });
  const client = createClient(fetchImpl);

  const artifact = await algo.resolveRootPath("30", { storage, client });

  assert.ok(artifact.references.some((reference) => reference.canonicalUrl === "https://example.com/reply-paper"));
  const replyReference = artifact.references.find((reference) => reference.canonicalUrl === "https://example.com/reply-paper");
  assert.deepEqual(replyReference.citedByTweetIds, ["11"]);
});

test("createStorageAdapter surfaces chrome runtime errors for cache operations", async () => {
  const chromeStub = {
    runtime: {
      lastError: null
    },
    storage: {
      local: {
        get(_keys, callback) {
          chromeStub.runtime.lastError = { message: "read failed" };
          callback({});
          chromeStub.runtime.lastError = null;
        },
        set(_value, callback) {
          chromeStub.runtime.lastError = { message: "write failed" };
          callback();
          chromeStub.runtime.lastError = null;
        },
        remove(_keys, callback) {
          chromeStub.runtime.lastError = { message: "clear failed" };
          callback();
          chromeStub.runtime.lastError = null;
        }
      }
    }
  };
  const storage = algo.createStorageAdapter(chromeStub);

  await assert.rejects(() => storage.readCache(), /read failed/);
  await assert.rejects(() => storage.readConversationCache(), /read failed/);
  await assert.rejects(() => storage.writeCache({ 10: { id_str: "10" } }), /write failed/);
  await assert.rejects(() => storage.writeConversationCache({ 10: { complete: true, tweetIds: ["10"] } }), /write failed/);
  await assert.rejects(() => storage.clearCache(), /clear failed/);
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
  assert.deepEqual(chromeStub.inspectConversationCache(), {});
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
    bearerToken: "test-token",
    onProgress(progress) {
      phases.push(progress.phase);
    }
  });

  assert.deepEqual(phases, ["start", "path_walk", "path_walk", "path_walk", "canonicalizing_refs", "collecting_local_reply_chains", "done"]);
  assert.deepEqual(artifact.path.map((entry) => entry.id), ["10", "20", "30"]);
});

test("background controller falls back to chrome storage when the request omits the bearer token", async () => {
  const chromeStub = createChromeStub({}, {}, {
    "ariadex.x_api_bearer_token": "storage-token"
  });
  const controller = background.createBackgroundController({
    chromeApi: chromeStub,
    fetchImpl: createFetchStub({
      10: {
        id_str: "10",
        text: "root",
        user: { screen_name: "root" }
      }
    })
  });

  const artifact = await controller.resolveRootPath("10", {});

  assert.deepEqual(artifact.path.map((entry) => entry.id), ["10"]);
});

test("background controller can hydrate the bearer token from the generated config loader", async () => {
  const chromeStub = createChromeStub();
  const apiCalls = [];
  const controller = background.createBackgroundController({
    chromeApi: chromeStub,
    fetchImpl: async (url) => {
      apiCalls.push(String(url));
      return {
        ok: true,
        async json() {
          return {
            data: {
              id: "10",
              author_id: "u1",
              conversation_id: "10",
              text: "root"
            },
            includes: {
              users: [{
                id: "u1",
                username: "root",
                name: "Root"
              }]
            }
          };
        }
      };
    }
  });

  const originalLoadGeneratedConfig = require("../extension/dev_env_loader.js").loadGeneratedConfig;
  require("../extension/dev_env_loader.js").loadGeneratedConfig = async ({ chromeApi: currentChromeApi }) => {
    currentChromeApi.storage.local.set({ "ariadex.x_api_bearer_token": "generated-token" }, () => {});
    return {
      bearerToken: "generated-token",
      apiBaseUrl: "https://proxy.example.test/2"
    };
  };

  try {
    const artifact = await controller.resolveRootPath("10", {});
    assert.deepEqual(artifact.path.map((entry) => entry.id), ["10"]);
    assert.match(apiCalls[0], /^https:\/\/proxy\.example\.test\/2\/tweets\/10\?/);
  } finally {
    require("../extension/dev_env_loader.js").loadGeneratedConfig = originalLoadGeneratedConfig;
  }
});

test("background controller generates a narrative report through the configured endpoint", async () => {
  const chromeStub = createChromeStub();
  const calls = [];
  const controller = background.createBackgroundController({
    chromeApi: chromeStub,
    fetchImpl: async (url, options = {}) => {
      calls.push({
        url: String(url),
        method: options.method || "GET",
        headers: options.headers || {},
        body: options.body || ""
      });

      if (String(url).startsWith("chrome-extension://")) {
        return {
          ok: true,
          async json() {
            return {
              bearerToken: "generated-token",
              reportBackendBaseUrl: "http://127.0.0.1:8787"
            };
          }
        };
      }

      return {
        ok: true,
        async json() {
          return {
            ok: true,
            report: {
              text: "Generated report text.",
              model: "gpt-4o-mini",
              apiBaseUrl: "https://api.openai.com/v1",
              provider: "openai"
            }
          };
        }
      };
    }
  });

  const originalLoadGeneratedConfig = require("../extension/dev_env_loader.js").loadGeneratedConfig;
  require("../extension/dev_env_loader.js").loadGeneratedConfig = async ({ chromeApi: currentChromeApi, fetchImpl, view }) => {
    return originalLoadGeneratedConfig({ chromeApi: currentChromeApi, fetchImpl, view });
  };

  try {
    const phases = [];
    const report = await controller.generateReport({
      path: [{ id: "1", text: "Root" }],
      references: [],
      people: [],
      replyChains: []
    }, {
      onProgress(progress) {
        phases.push(progress.phase);
      }
    });

    assert.equal(report.text, "Generated report text.");
    assert.equal(report.model, "gpt-4o-mini");
    assert.equal(report.apiBaseUrl, "https://api.openai.com/v1");
    assert.equal(report.provider, "openai");
    assert.deepEqual(phases, [
      "loading_report_config",
      "calling_report_backend",
      "awaiting_llm_response",
      "report_ready"
    ]);
    assert.equal(calls[1].url, "http://127.0.0.1:8787/v1/report");
    assert.equal(calls[1].method, "POST");
    assert.match(String(calls[1].body), /"path"/);
  } finally {
    require("../extension/dev_env_loader.js").loadGeneratedConfig = originalLoadGeneratedConfig;
  }
});

test("background message handler resolves root-path requests and ignores unrelated messages", async () => {
  const chromeStub = createChromeStub();
  const controller = background.createBackgroundController({
    chromeApi: chromeStub,
    fetchImpl: createFetchStub({
      10: {
        id_str: "10",
        text: "root",
        user: { screen_name: "root" }
      }
    })
  });
  controller.registerMessageHandler();

  let response;
  const handled = chromeStub.triggerMessage(
    { type: background.RESOLVE_ROOT_PATH_MESSAGE_TYPE, tweetId: "10", bearerToken: "test-token" },
    {},
    (value) => {
      response = value;
    }
  );

  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(handled, true);
  assert.deepEqual(response, {
    ok: true,
    artifact: {
      path: [
        {
          id: "10",
          author: "root",
          authorName: "",
          authorAvatarUrl: "",
          createdAt: "",
          text: "root",
          url: "https://x.com/root/status/10",
          referenceUrls: [],
          mentionHandles: [],
          mentionPeople: [],
          outboundRelation: "",
          referenceNumbers: [],
          peopleHandles: ["root"]
        }
      ],
      references: [],
      people: [
        {
          handle: "root",
          displayName: "",
          avatarUrl: "",
          profileUrl: "https://x.com/root",
          citedByTweetIds: ["10"],
          sourceTypes: ["author"]
        }
      ],
      replyChains: []
    }
  });
  assert.equal(chromeStub.triggerMessage({ type: "UNRELATED" }, {}, () => {}), false);
});

test("background message handler resolves report-generation requests", async () => {
  const chromeStub = createChromeStub();
  const controller = background.createBackgroundController({
    chromeApi: chromeStub,
    fetchImpl: async (url) => {
      if (String(url).startsWith("chrome-extension://")) {
        return {
          ok: true,
          async json() {
            return {
              reportBackendBaseUrl: "http://127.0.0.1:8787"
            };
          }
        };
      }
      return {
        ok: true,
        async json() {
          return {
            ok: true,
            report: {
              text: "Generated report text.",
              model: "gpt-4o-mini",
              apiBaseUrl: "https://api.openai.com/v1",
              provider: "openai"
            }
          };
        }
      };
    }
  });
  controller.registerMessageHandler();

  let response;
  const handled = chromeStub.triggerMessage(
    {
      type: background.GENERATE_REPORT_MESSAGE_TYPE,
      artifact: {
        path: [{ id: "1" }],
        references: [],
        people: [],
        replyChains: []
      }
    },
    {},
    (value) => {
      response = value;
    }
  );

  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(handled, true);
  assert.deepEqual(response, {
    ok: true,
    report: {
      text: "Generated report text.",
      model: "gpt-4o-mini",
      apiBaseUrl: "https://api.openai.com/v1",
      provider: "openai"
    }
  });
});

test("background port handler streams progress and report results for report generation", async () => {
  const chromeStub = createChromeStub();
  const controller = background.createBackgroundController({
    chromeApi: chromeStub,
    fetchImpl: async (url) => {
      if (String(url).startsWith("chrome-extension://")) {
        return {
          ok: true,
          async json() {
            return {
              reportBackendBaseUrl: "http://127.0.0.1:8787"
            };
          }
        };
      }
      return {
        ok: true,
        async json() {
          return {
            ok: true,
            report: {
              text: "Generated report text.",
              model: "gpt-4o-mini",
              apiBaseUrl: "https://api.openai.com/v1",
              provider: "openai"
            }
          };
        }
      };
    }
  });
  controller.registerPortHandler();

  const sent = [];
  let onMessageListener = null;
  const port = {
    name: background.GENERATE_REPORT_PORT_NAME,
    onMessage: {
      addListener(listener) {
        onMessageListener = listener;
      }
    },
    postMessage(message) {
      sent.push(message);
    }
  };

  chromeStub.triggerConnect(port);
  onMessageListener({
    type: background.GENERATE_REPORT_MESSAGE_TYPE,
    artifact: {
      path: [{ id: "1" }],
      references: [],
      people: [],
      replyChains: []
    }
  });

  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(sent.map((message) => message.type), [
    "progress",
    "progress",
    "progress",
    "progress",
    "result"
  ]);
  assert.equal(sent.at(-1).report.text, "Generated report text.");
});

test("background message handler clears cache via runtime messages", async () => {
  const chromeStub = createChromeStub({
    10: { id_str: "10" }
  });
  const controller = background.createBackgroundController({
    chromeApi: chromeStub,
    fetchImpl: createFetchStub({})
  });
  controller.registerMessageHandler();

  let response;
  chromeStub.triggerMessage(
    { type: background.CLEAR_CACHE_MESSAGE_TYPE },
    {},
    (value) => {
      response = value;
    }
  );

  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(response, { ok: true, cleared: true });
  assert.deepEqual(chromeStub.inspectCache(), {});
});

test("background port handler streams progress and final results back to the caller", async () => {
  const chromeStub = createChromeStub();
  const controller = background.createBackgroundController({
    chromeApi: chromeStub,
    fetchImpl: createFetchStub({
      20: {
        id_str: "20",
        text: "clicked",
        user: { screen_name: "clicked" },
        in_reply_to_status_id_str: "10"
      },
      10: {
        id_str: "10",
        text: "root",
        user: { screen_name: "root" }
      }
    })
  });
  controller.registerPortHandler();

  const posted = [];
  let onMessage;
  const port = {
    name: background.RESOLVE_ROOT_PATH_PORT_NAME,
    onMessage: {
      addListener(listener) {
        onMessage = listener;
      }
    },
    postMessage(message) {
      posted.push(message);
    }
  };

  chromeStub.triggerConnect(port);
  onMessage({
    type: background.RESOLVE_ROOT_PATH_MESSAGE_TYPE,
    tweetId: "20",
    bearerToken: "test-token"
  });

  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(posted.map((message) => message.type), [
    "progress",
    "progress",
    "progress",
    "progress",
    "progress",
    "progress",
    "result"
  ]);
  assert.deepEqual(posted[posted.length - 1].artifact.path.map((entry) => entry.id), ["10", "20"]);
});
