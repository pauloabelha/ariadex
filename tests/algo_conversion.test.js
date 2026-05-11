const test = require("node:test");
const assert = require("node:assert/strict");

const algo = require("../extension/algo.js");

test("convertApiTweetToPayload maps X API tweets into the legacy internal payload shape", () => {
  const payload = algo.convertApiTweetToPayload({
    id: "123",
    author_id: "u1",
    conversation_id: "root",
    created_at: "2026-05-08T12:00:00.000Z",
    text: "Hello https://t.co/x",
    entities: {
      urls: [
        {
          unwound_url: "https://example.com/paper?utm_source=x",
          expanded_url: "https://t.co/x",
          url: "https://t.co/x"
        }
      ],
      mentions: [
        { username: "Bob" },
        { username: "@Carol" }
      ]
    },
    referenced_tweets: [
      { type: "replied_to", id: "122" },
      { type: "quoted", id: "99" }
    ]
  }, new Map([[
    "u1",
    {
      username: "Alice",
      name: "Alice Example",
      profile_image_url: "https://img.example/alice.jpg"
    }
  ]]));

  assert.deepEqual(payload, {
    id_str: "123",
    conversation_id_str: "root",
    created_at: "2026-05-08T12:00:00.000Z",
    text: "Hello https://t.co/x",
    in_reply_to_status_id_str: "122",
    quoted_tweet: { id_str: "99" },
    entities: {
      urls: [{ expanded_url: "https://example.com/paper?utm_source=x" }],
      user_mentions: [
        { screen_name: "Bob", name: "", profile_image_url_https: "" },
        { screen_name: "@Carol", name: "", profile_image_url_https: "" }
      ]
    },
    user: {
      screen_name: "alice",
      name: "Alice Example",
      profile_image_url_https: "https://img.example/alice.jpg"
    }
  });
});

test("convertApiTweetToPayload is defensive around missing ids and users", () => {
  assert.equal(algo.convertApiTweetToPayload({}, new Map()), null);
  assert.equal(
    algo.convertApiTweetToPayload({
      id: "123",
      text: "anonymous"
    }, new Map()).user.screen_name,
    "unknown"
  );
});

test("collectReplyChainsForAnchorTweets dedupes duplicate anchors and duplicate chain ids", async () => {
  const anchorTweets = [
    { id: "10", author: "alice", conversationId: "10" },
    { id: "10", author: "alice", conversationId: "10" },
    { id: "20", author: "bob", conversationId: "20" }
  ];
  const deps = {
    async storage() {},
    async client() {}
  };
  const conversations = {
    10: [
      {
        id_str: "11",
        conversation_id_str: "10",
        text: "direct reply",
        user: { screen_name: "alice" },
        in_reply_to_status_id_str: "10"
      }
    ],
    20: [
      {
        id_str: "11",
        conversation_id_str: "20",
        text: "same tweet id but different anchor",
        user: { screen_name: "bob" },
        in_reply_to_status_id_str: "20"
      }
    ]
  };
  const originalFetchConversation = algo.fetchConversation;
  let callCount = 0;

  // Exercise through the public function by providing a deps object that lets
  // fetchConversation be reached, then short-circuit its network dependency at
  // the storage/client boundary.
  deps.storage = {
    async readConversationCache() {
      return {};
    },
    async readCache() {
      return {};
    },
    async writeConversationCache() {},
    async writeCache() {}
  };
  deps.client = {
    async fetchConversationFromNetwork(conversationId) {
      callCount += 1;
      return conversations[conversationId] || [];
    },
    async fetchTweetsFromNetwork() {
      return [];
    }
  };

  try {
    const chains = await algo.collectReplyChainsForAnchorTweets(anchorTweets, deps);
    assert.equal(callCount, 2);
    assert.deepEqual(chains.map((chain) => [chain.anchorTweetId, chain.id]), [
      ["10", "11"],
      ["20", "11"]
    ]);
  } finally {
    assert.equal(algo.fetchConversation, originalFetchConversation);
  }
});

test("dedupeQuoteTweets removes spam and near-identical quote phrasing", () => {
  const quotes = algo.dedupeQuoteTweets([
    { id: "1", text: "This is a careful caveat about deployment constraints.", author: "alice" },
    { id: "2", text: "This is a careful caveat about deployment constraints!", author: "bob" },
    { id: "3", text: "wow", author: "carol" },
    { id: "4", text: "Different evidence from a benchmark with concrete numbers.", author: "dana" }
  ]);

  assert.deepEqual(quotes.map((tweet) => tweet.id), ["1", "4"]);
});

test("groupTopTakes returns one ranked representative list", () => {
  const grouped = algo.groupTopTakes([
    {
      tweetId: "1",
      role: "skepticism",
      roleLabel: "Strongest Skeptical Take",
      domainGroup: "adjacent",
      domainGroupLabel: "Adjacent",
      combinedScore: 0.9,
      scorecard: { substance: 0.9, novelty: 0.9, credibility: 0.9 },
      explanation: "Names the failure mode.",
      raw: { id: "1", text: "The demo hides the hard part.", author: "alice" }
    },
    {
      tweetId: "2",
      role: "technical_explanation",
      roleLabel: "Best Technical Explanation",
      domainGroup: "expert",
      domainGroupLabel: "Expert",
      combinedScore: 0.7,
      scorecard: { substance: 0.7, novelty: 0.6, credibility: 0.8 },
      explanation: "Explains the mechanism.",
      raw: { id: "2", text: "The method works because retrieval narrows the search.", author: "bob" }
    }
  ]);

  assert.deepEqual(grouped.groupedRoles.map((group) => [group.group, group.label]), [["ranked", "Top Takes"]]);
  assert.deepEqual(grouped.representativeTakes.map((take) => take.tweetId), ["1", "2"]);
});

test("normalizeTopTakesClassification preserves author expertise fields", () => {
  const classification = algo.normalizeTopTakesClassification({
    tweetId: "10",
    role: "technical_explanation",
    domainGroup: "expert",
    authorDomainRelevance: 0.9,
    authorExpertiseSignal: 0.8,
    expertiseEvidence: "Profile says robotics researcher; quote explains control latency.",
    isDomainFluentTechnicalTake: true,
    scorecard: {
      substance: 0.7,
      novelty: 0.6,
      credibility: 0.7
    },
    confidence: 0.9,
    explanation: "Mechanistic robotics explanation."
  }, new Map([[
    "10",
    { id: "10", text: "Control latency matters here.", author: "roboticist" }
  ]]));

  assert.equal(classification.domainGroup, "expert");
  assert.equal(classification.domainGroupLabel, "Expert");
  assert.equal(classification.authorDomainRelevance, 0.9);
  assert.equal(classification.authorExpertiseSignal, 0.8);
  assert.equal(classification.domainExpertScore, 0.9);
  assert.equal(classification.adjacentExpertScore, 0);
  assert.equal(classification.authorScore, 0.9);
  assert.ok(classification.lengthScore > 0);
  assert.equal(classification.referenceScore, 0);
  assert.ok(classification.takeScore > 0);
  assert.equal(classification.expertiseEvidence, "Profile says robotics researcher; quote explains control latency.");
  assert.equal(classification.isDomainFluentTechnicalTake, true);
});

test("normalizeTopTakesClassification penalizes low-information affective reactions", () => {
  const quoteById = new Map([
    ["good", {
      id: "good",
      text: "As an Industrial Engineer who has spent 10+ years moving designs from CAD to production, the full-stack architecture and reliable contact-rich manipulation learned from real humans at scale are the important pieces.",
      author: "engineer"
    }],
    ["bad", {
      id: "bad",
      text: "I don't want to stop this work, but I'm not alone in experiencing an initial reaction of revulsion.",
      author: "observer"
    }]
  ]);
  const base = {
    role: "skepticism",
    domainGroup: "adjacent",
    authorDomainRelevance: 0.5,
    authorExpertiseSignal: 0.5,
    scorecard: { substance: 0.8, novelty: 0.8, credibility: 0.8 },
    confidence: 0.8
  };

  const good = algo.normalizeTopTakesClassification({ ...base, tweetId: "good" }, quoteById);
  const bad = algo.normalizeTopTakesClassification({ ...base, tweetId: "bad" }, quoteById);

  assert.equal(good.contentMultiplier, 1);
  assert.equal(bad.contentMultiplier, 0.55);
  assert.ok(good.combinedScore > bad.combinedScore);
  assert.ok(good.takeScore > bad.takeScore);
});

test("selectTopCommentsForTweet keeps the top three direct replies by engagement", () => {
  const comments = algo.selectTopCommentsForTweet(
    { id: "10" },
    [
      { id: "11", repliedToId: "10", text: "low", metrics: { likes: 1 }, author: "a" },
      { id: "12", repliedToId: "10", text: "top", metrics: { likes: 10 }, author: "b" },
      { id: "13", repliedToId: "99", text: "reply to someone else", metrics: { likes: 100 }, author: "c" },
      { id: "14", repliedToId: "10", text: "middle", metrics: { likes: 3, replies: 2 }, author: "d" },
      { id: "15", repliedToId: "10", text: "third", metrics: { likes: 2 }, author: "e" }
    ],
    { topCommentsPerQuote: 3 }
  );

  assert.deepEqual(comments.map((comment) => comment.id), ["12", "14", "15"]);
});

test("buildTopTakesCandidateBatch includes top comments as quote context", () => {
  const batch = algo.buildTopTakesCandidateBatch(
    { id: "1", text: "source" },
    [{
      id: "2",
      author: "expert",
      text: "quote",
      topComments: [
        { id: "3", author: "commenter", text: "useful correction", metrics: { likes: 5 } }
      ]
    }],
    0,
    10
  );

  assert.deepEqual(batch.quoteTweets[0].topComments, [{
    id: "3",
    author: "commenter",
    authorName: undefined,
    text: "useful correction",
    metrics: { likes: 5 },
    createdAt: undefined,
    authorFollowers: undefined,
    authorVerified: undefined,
    authorDescription: undefined
  }]);
});

test("OpenAI timing helpers summarize batches and estimate remaining time", () => {
  const summary = algo.summarizeOpenAiBatchTimings([
    { batchIndex: 1, quoteCount: 10, durationMs: 2000, completedAt: "now" },
    { batchIndex: 2, quoteCount: 5, durationMs: 1000, completedAt: "later" }
  ]);

  assert.equal(summary.batchCount, 2);
  assert.equal(summary.totalDurationMs, 3000);
  assert.equal(summary.averageBatchDurationMs, 1500);
  assert.equal(summary.averageMsPerQuote, 200);
  assert.equal(algo.estimateOpenAiRemainingMs(
    { quoteTweets: Array.from({ length: 4 }) },
    [{ quoteTweets: Array.from({ length: 6 }) }],
    summary
  ), 2000);
});

test("attachTopCommentsToQuoteTweets skips comment context when X rate-limits conversation fetches", async () => {
  const tweets = await algo.attachTopCommentsToQuoteTweets([
    { id: "10", conversationId: "10", author: "expert", text: "quote" }
  ], {
    storage: {
      async readConversationCache() {
        return {};
      }
    },
    client: {
      async fetchConversationFromNetwork() {
        const error = new Error("tweet_fetch_failed_429");
        error.status = 429;
        throw error;
      }
    }
  });

  assert.deepEqual(tweets, [{
    id: "10",
    conversationId: "10",
    author: "expert",
    text: "quote",
    topComments: []
  }]);
});

test("resolveTopTakes returns cached artifact without touching X or OpenAI", async () => {
  const cachedArtifact = {
    sourceTweet: { id: "10" },
    takes: [],
    groupedRoles: [],
    representativeTakes: [],
    people: [],
    stats: { representativeTakeCount: 0 },
    modelMetadata: { model: "gpt-5-mini" }
  };
  const progress = [];
  const artifact = await algo.resolveTopTakes("10", {
    storage: {
      async readTopTakesArtifactCache() {
        return {
          10: {
            version: algo.TOP_TAKES_CACHE_VERSION,
            cachedAt: "2026-05-08T00:00:00.000Z",
            artifact: cachedArtifact
          }
        };
      }
    },
    client: {
      async fetchTweetFromNetwork() {
        assert.fail("cached Top Takes should not fetch the source tweet");
      },
      async fetchQuoteTweetsFromNetwork() {
        assert.fail("cached Top Takes should not fetch quote tweets");
      }
    },
    async analyzeTopTakesBatch() {
      assert.fail("cached Top Takes should not call OpenAI");
    },
    onProgress(event) {
      progress.push(event.phase);
    }
  });

  assert.equal(artifact, cachedArtifact);
  assert.deepEqual(progress, ["top_takes_cache_hit", "top_takes_ready"]);
});

test("readQuoteTweetsForSource reuses cached empty quote collections", async () => {
  let networkCalls = 0;
  const payloads = await algo.readQuoteTweetsForSource("10", {
    storage: {
      async readQuoteTweetCache() {
        return {
          10: {
            fetchedAt: "2026-05-08T00:00:00.000Z",
            maxQuoteTweets: 200,
            payloads: []
          }
        };
      },
      async writeQuoteTweetCache() {
        assert.fail("empty cached quote collections should not be rewritten");
      }
    },
    client: {
      async fetchQuoteTweetsFromNetwork() {
        networkCalls += 1;
        return [];
      }
    }
  }, {
    maxQuoteTweets: 200
  });

  assert.deepEqual(payloads, []);
  assert.equal(networkCalls, 0);
});
