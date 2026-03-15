const test = require("node:test");
const assert = require("node:assert/strict");

const xApiClient = require("../data/x_api_client.js");

function jsonResponse(body, status = 200, statusText = "OK") {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: {
      get() {
        return null;
      }
    },
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body);
    }
  };
}

test("buildConversationDataset discovers followed-author topic tweets in bounded pass", async () => {
  const calledUrls = [];
  const fetchImpl = async (urlString) => {
    const url = new URL(urlString);
    calledUrls.push(url.toString());
    const path = url.pathname;
    const query = url.searchParams.get("query") || "";

    if (path === "/2/tweets/100") {
      return jsonResponse({
        data: {
          id: "100",
          author_id: "u_root",
          text: "root",
          referenced_tweets: [],
          public_metrics: {}
        },
        includes: {
          users: [{ id: "u_root", username: "rooter" }]
        }
      });
    }

    if (path === "/2/tweets/search/recent" && query === "conversation_id:100") {
      return jsonResponse({
        data: [
          {
            id: "101",
            author_id: "u_reply",
            text: "reply",
            referenced_tweets: [{ type: "replied_to", id: "100" }],
            public_metrics: {}
          }
        ],
        includes: {
          users: [{ id: "u_reply", username: "replyguy" }]
        },
        meta: {}
      });
    }

    if (path === "/2/tweets/search/recent" && query.includes("conversation_id:100") && query.includes("from:alice")) {
      return jsonResponse({
        data: [
          {
            id: "150",
            author_id: "u_alice",
            text: "followed account contribution",
            referenced_tweets: [{ type: "quoted", id: "100" }],
            public_metrics: {}
          }
        ],
        includes: {
          users: [{ id: "u_alice", username: "alice" }]
        },
        meta: {}
      });
    }

    if (path === "/2/tweets") {
      const ids = (url.searchParams.get("ids") || "").split(",").filter(Boolean);
      if (ids.includes("pearl")) {
        return jsonResponse({
          data: [
            {
              id: "pearl",
              author_id: "u_pearl",
              text: "Pearl root https://example.com/article",
              entities: {
                urls: [{ expanded_url: "https://example.com/article" }]
              },
              referenced_tweets: [],
              public_metrics: {}
            }
          ],
          includes: {
            users: [{ id: "u_pearl", username: "yudapearl" }]
          }
        });
      }
      return jsonResponse({ data: [], includes: { users: [] } });
    }

    if (path === "/2/users") {
      return jsonResponse({ data: [] });
    }

    if (path === "/2/tweets/100/quote_tweets") {
      return jsonResponse({ data: [], includes: { users: [] }, meta: {} });
    }

    throw new Error(`Unexpected URL: ${url.toString()}`);
  };

  const progress = [];
  const dataset = await xApiClient.buildConversationDataset({
    clickedTweetId: "100",
    bearerToken: "test-token",
    fetchImpl,
    includeQuoteTweets: false,
    includeQuoteReplies: false,
    followingSet: new Set(["@alice"]),
    maxNetworkDiscoveryQueries: 2,
    maxNetworkDiscoveryAuthors: 5,
    maxConversationRoots: 4,
    maxPagesPerCollection: 1,
    onProgress: (event) => progress.push(event?.phase)
  });

  const ids = new Set((dataset.tweets || []).map((tweet) => tweet.id));
  assert.equal(ids.has("150"), true);
  assert.equal(progress.includes("network_discovery_batch"), true);
  assert.equal(
    calledUrls.some((url) => url.includes("/2/tweets/search/recent") && url.includes("from%3Aalice")),
    true
  );
});

test("buildConversationDataset skips network discovery queries when following set is empty", async () => {
  const calledSearchQueries = [];
  const fetchImpl = async (urlString) => {
    const url = new URL(urlString);
    const path = url.pathname;
    const query = url.searchParams.get("query") || "";
    if (path === "/2/tweets/search/recent") {
      calledSearchQueries.push(query);
    }

    if (path === "/2/tweets/100") {
      return jsonResponse({
        data: {
          id: "100",
          author_id: "u_root",
          text: "root",
          referenced_tweets: [],
          public_metrics: {}
        },
        includes: {
          users: [{ id: "u_root", username: "rooter" }]
        }
      });
    }

    if (path === "/2/tweets/search/recent" && query === "conversation_id:100") {
      return jsonResponse({
        data: [],
        includes: { users: [] },
        meta: {}
      });
    }

    if (path === "/2/tweets") {
      return jsonResponse({ data: [], includes: { users: [] } });
    }

    if (path === "/2/users") {
      return jsonResponse({ data: [] });
    }

    throw new Error(`Unexpected URL: ${url.toString()}`);
  };

  await xApiClient.buildConversationDataset({
    clickedTweetId: "100",
    bearerToken: "test-token",
    fetchImpl,
    includeQuoteTweets: false,
    includeQuoteReplies: false,
    followingSet: new Set(),
    maxNetworkDiscoveryQueries: 2,
    maxNetworkDiscoveryAuthors: 5,
    maxConversationRoots: 4,
    maxPagesPerCollection: 1
  });

  assert.deepEqual(calledSearchQueries, ["conversation_id:100"]);
});

test("buildConversationDataset preserves quote retrieval when replies endpoint fails", async () => {
  const fetchImpl = async (urlString) => {
    const url = new URL(urlString);
    const path = url.pathname;
    const query = url.searchParams.get("query") || "";

    if (path === "/2/tweets/100") {
      return jsonResponse({
        data: {
          id: "100",
          author_id: "u_root",
          text: "root",
          referenced_tweets: [],
          public_metrics: {}
        },
        includes: {
          users: [{ id: "u_root", username: "rooter" }]
        }
      });
    }

    if (path === "/2/tweets/search/recent" && query === "conversation_id:100") {
      return jsonResponse({ title: "rate limited" }, 429, "Too Many Requests");
    }

    if (path === "/2/tweets/100/quote_tweets") {
      return jsonResponse({
        data: [
          {
            id: "200",
            author_id: "u_quote",
            text: "quote survives reply failure",
            referenced_tweets: [{ type: "quoted", id: "100" }],
            public_metrics: {}
          }
        ],
        includes: {
          users: [{ id: "u_quote", username: "quoteuser" }]
        },
        meta: {}
      });
    }

    if (path === "/2/tweets") {
      return jsonResponse({ data: [], includes: { users: [] } });
    }

    if (path === "/2/users") {
      return jsonResponse({ data: [] });
    }

    throw new Error(`Unexpected URL: ${url.toString()}`);
  };

  const dataset = await xApiClient.buildConversationDataset({
    clickedTweetId: "100",
    bearerToken: "test-token",
    fetchImpl,
    includeQuoteTweets: true,
    includeQuoteReplies: false,
    followingSet: new Set(),
    maxConversationRoots: 2,
    maxPagesPerCollection: 1
  });

  const ids = new Set((dataset.tweets || []).map((tweet) => tweet.id));
  assert.equal(ids.has("200"), true);
  assert.equal((dataset.warnings || []).some((warning) => String(warning).includes("conversation replies failed")), true);
});

test("buildConversationDataset seeds collection from clicked and root-hint path on fresh builds", async () => {
  const calledTweetLookups = [];
  const calledQuoteLookups = [];

  const fetchImpl = async (urlString) => {
    const url = new URL(urlString);
    const path = url.pathname;
    const query = url.searchParams.get("query") || "";

    if (path === "/2/tweets/pearl") {
      calledTweetLookups.push("pearl");
      return jsonResponse({
        data: {
          id: "pearl",
          author_id: "u_pearl",
          text: "Pearl root https://example.com/article",
          entities: {
            urls: [{ expanded_url: "https://example.com/article" }]
          },
          referenced_tweets: [],
          public_metrics: {}
        },
        includes: {
          users: [{ id: "u_pearl", username: "yudapearl" }]
        }
      });
    }

    if (path === "/2/tweets/lecun") {
      calledTweetLookups.push("lecun");
      return jsonResponse({
        data: {
          id: "lecun",
          author_id: "u_lecun",
          text: "LeCun reply",
          referenced_tweets: [{ type: "replied_to", id: "pearl" }],
          public_metrics: {}
        },
        includes: {
          users: [{ id: "u_lecun", username: "ylecun" }]
        }
      });
    }

    if (path === "/2/tweets/bareinboim") {
      calledTweetLookups.push("bareinboim");
      return jsonResponse({
        data: {
          id: "bareinboim",
          author_id: "u_bareinboim",
          text: "Bareinboim quote",
          referenced_tweets: [{ type: "quoted", id: "lecun" }],
          public_metrics: {}
        },
        includes: {
          users: [{ id: "u_bareinboim", username: "eliasbareinboim" }]
        }
      });
    }

    if (path === "/2/tweets/search/recent") {
      if (query === "conversation_id:pearl") {
        return jsonResponse({ data: [], includes: { users: [] }, meta: {} });
      }
      if (query === "conversation_id:lecun") {
        return jsonResponse({ data: [], includes: { users: [] }, meta: {} });
      }
      if (query === "conversation_id:bareinboim") {
        return jsonResponse({ data: [], includes: { users: [] }, meta: {} });
      }
    }

    if (path === "/2/tweets/pearl/quote_tweets") {
      calledQuoteLookups.push(path);
      return jsonResponse({ data: [], includes: { users: [] }, meta: {} });
    }

    if (path === "/2/tweets/lecun/quote_tweets") {
      calledQuoteLookups.push(path);
      return jsonResponse({
        data: [
          {
            id: "quote-of-lecun",
            author_id: "u_quote",
            text: "Quote of Lecun",
            referenced_tweets: [{ type: "quoted", id: "lecun" }],
            public_metrics: {}
          }
        ],
        includes: {
          users: [{ id: "u_quote", username: "quoteuser" }]
        },
        meta: {}
      });
    }

    if (path === "/2/tweets/bareinboim/quote_tweets") {
      calledQuoteLookups.push(path);
      return jsonResponse({ data: [], includes: { users: [] }, meta: {} });
    }

    if (path === "/2/tweets") {
      return jsonResponse({ data: [], includes: { users: [] } });
    }

    if (path === "/2/users") {
      return jsonResponse({ data: [] });
    }

    throw new Error(`Unexpected URL: ${url.toString()}`);
  };

  const dataset = await xApiClient.buildConversationDataset({
    clickedTweetId: "bareinboim",
    rootHintTweetId: "lecun",
    bearerToken: "test-token",
    fetchImpl,
    includeQuoteTweets: true,
    includeQuoteReplies: false,
    followingSet: new Set(),
    maxConversationRoots: 4,
    maxPagesPerCollection: 1
  });

  const ids = new Set((dataset.tweets || []).map((tweet) => tweet.id));
  assert.equal(ids.has("quote-of-lecun"), true);
  assert.equal(calledTweetLookups.includes("lecun"), true);
  assert.equal(calledTweetLookups.includes("bareinboim"), true);
  assert.equal(calledTweetLookups.includes("pearl"), true);
  assert.equal(calledQuoteLookups.includes("/2/tweets/lecun/quote_tweets"), true);
});
