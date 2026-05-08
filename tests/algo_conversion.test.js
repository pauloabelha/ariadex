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
