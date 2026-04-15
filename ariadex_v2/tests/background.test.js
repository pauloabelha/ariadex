const test = require("node:test");
const assert = require("node:assert/strict");

const algo = require("../extension/algo.js");
const background = require("../extension/background.js");

function createChromeStub(initialCache = {}) {
  let cache = { ...initialCache };
  const listeners = {
    message: null,
    connect: null
  };

  return {
    runtime: {
      lastError: null,
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
  const client = algo.createTweetClient(fetchImpl);

  const first = await algo.fetchTweet("10", { storage, client });
  const second = await algo.fetchTweet("10", { storage, client });

  assert.equal(first.id_str, "10");
  assert.equal(second.id_str, "10");
  assert.deepEqual(fetchImpl.calls, ["10"]);
  assert.equal(chromeStub.inspectCache()["10"].id_str, "10");
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

test("createTweetClient requests the syndication endpoint with credentials omitted", async () => {
  const calls = [];
  const client = algo.createTweetClient(async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      async json() {
        return { id_str: "10" };
      }
    };
  });

  await client.fetchTweetFromNetwork("10");

  assert.match(calls[0].url, /tweet-result\?id=10&token=/);
  assert.deepEqual(calls[0].options, { credentials: "omit" });
});

test("createTweetClient surfaces network failures with the response status", async () => {
  const client = algo.createTweetClient(async () => ({
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
    ["quoteguide", "Quote Guide"]
  ]);
  assert.deepEqual(artifact.people.map((entry) => [entry.handle, entry.avatarUrl]), [
    ["root", "https://img.example/root.jpg"],
    ["quoted", "https://img.example/quoted.jpg"],
    ["clicked", "https://img.example/clicked.jpg"],
    ["quoteguide", "https://img.example/guide.jpg"]
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
  const client = algo.createTweetClient(fetchImpl);
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
  const client = algo.createTweetClient(fetchImpl);

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
    people: []
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
  const client = algo.createTweetClient(fetchImpl);

  const artifact = await algo.resolveRootPath("30", { storage, client });

  assert.deepEqual(artifact.path.map((entry) => entry.id), ["10", "20", "30"]);
  assert.deepEqual(fetchImpl.calls, ["30", "10"]);
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
  await assert.rejects(() => storage.writeCache({ 10: { id_str: "10" } }), /write failed/);
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
    { type: background.RESOLVE_ROOT_PATH_MESSAGE_TYPE, tweetId: "10" },
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
      ]
    }
  });
  assert.equal(chromeStub.triggerMessage({ type: "UNRELATED" }, {}, () => {}), false);
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
    tweetId: "20"
  });

  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(posted.map((message) => message.type), [
    "progress",
    "progress",
    "progress",
    "progress",
    "progress",
    "result"
  ]);
  assert.deepEqual(posted[posted.length - 1].artifact.path.map((entry) => entry.id), ["10", "20"]);
});
