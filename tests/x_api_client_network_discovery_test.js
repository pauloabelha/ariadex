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

