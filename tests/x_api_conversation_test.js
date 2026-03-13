const test = require("node:test");
const assert = require("node:assert/strict");
const xApiConversation = require("../extension/x_api_conversation.js");

function createFakeClient(routeMap) {
  const calls = [];

  return {
    client: {
      options: {
        maxPagesPerCollection: 1,
        maxResultsPerPage: 100,
        maxConversationRoots: 10,
        maxConnectedTweets: 100,
        includeRetweets: true,
        includeQuoteReplies: true,
        requestTimeoutMs: 30000
      },
      async request(path) {
        calls.push(path);
        if (!Object.prototype.hasOwnProperty.call(routeMap, path)) {
          throw new Error(`Unexpected route: ${path}`);
        }
        return routeMap[path];
      }
    },
    calls
  };
}

function jsonResponse(body, status = 200, statusText = "OK") {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body);
    }
  };
}

function createMockFetch(handler) {
  return async (urlString) => {
    const url = new URL(urlString);
    const payload = handler(url);

    if (payload && payload.__status) {
      return jsonResponse(payload.body, payload.__status, payload.__statusText || "Error");
    }

    return jsonResponse(payload);
  };
}

test("resolveCanonicalRootTweetId prioritizes quoted tweet over reply chain", async () => {
  const { client, calls } = createFakeClient({
    "/tweets/200": {
      data: {
        id: "200",
        referenced_tweets: [
          { type: "quoted", id: "100" },
          { type: "replied_to", id: "50" }
        ]
      }
    }
  });

  const rootId = await xApiConversation.resolveCanonicalRootTweetId({
    clickedTweetId: "200",
    client
  });

  assert.equal(rootId, "100");
  assert.deepEqual(calls, ["/tweets/200"]);
});

test("resolveCanonicalRootTweetId keeps quote precedence even with root hint", async () => {
  const { client, calls } = createFakeClient({
    "/tweets/300": {
      data: {
        id: "300",
        referenced_tweets: [{ type: "quoted", id: "100" }]
      }
    }
  });

  const rootId = await xApiConversation.resolveCanonicalRootTweetId({
    clickedTweetId: "300",
    rootHintTweetId: "250",
    client
  });

  assert.equal(rootId, "100");
  assert.deepEqual(calls, ["/tweets/300"]);
});

test("resolveCanonicalRootTweetId climbs reply chain to original tweet", async () => {
  const { client, calls } = createFakeClient({
    "/tweets/30": {
      data: {
        id: "30",
        referenced_tweets: [{ type: "replied_to", id: "20" }]
      }
    },
    "/tweets/20": {
      data: {
        id: "20",
        referenced_tweets: [{ type: "replied_to", id: "10" }]
      }
    },
    "/tweets/10": {
      data: {
        id: "10",
        referenced_tweets: []
      }
    }
  });

  const rootId = await xApiConversation.resolveCanonicalRootTweetId({
    clickedTweetId: "30",
    client
  });

  assert.equal(rootId, "10");
  assert.deepEqual(calls, ["/tweets/30", "/tweets/20", "/tweets/10"]);
});

test("buildConversationSnapshot returns API-derived nodes, edges and ranking", async () => {
  const byId = {
    "10": {
      id: "10",
      author_id: "u10",
      text: "Root",
      public_metrics: { reply_count: 2, retweet_count: 1, like_count: 9, quote_count: 1 },
      referenced_tweets: []
    },
    "11": {
      id: "11",
      author_id: "u11",
      text: "Reply to root",
      public_metrics: { reply_count: 0, retweet_count: 0, like_count: 2, quote_count: 0 },
      referenced_tweets: [{ type: "replied_to", id: "10" }]
    },
    "12": {
      id: "12",
      author_id: "u12",
      text: "Quote root",
      public_metrics: { reply_count: 1, retweet_count: 0, like_count: 4, quote_count: 0 },
      referenced_tweets: [{ type: "quoted", id: "10" }]
    },
    "14": {
      id: "14",
      author_id: "u14",
      text: "Reply to quote",
      public_metrics: { reply_count: 0, retweet_count: 0, like_count: 3, quote_count: 0 },
      referenced_tweets: [{ type: "replied_to", id: "12" }]
    }
  };

  const users = {
    u10: { id: "u10", username: "root_author", name: "Root" },
    u11: { id: "u11", username: "reply_author", name: "Reply" },
    u12: { id: "u12", username: "quote_author", name: "Quote" },
    u13: { id: "u13", username: "repost_author", name: "Repost" },
    u14: { id: "u14", username: "quote_reply_author", name: "Quote Reply" }
  };

  const fetchImpl = createMockFetch((url) => {
    const { pathname, searchParams } = url;

    if (pathname === "/2/tweets/10" || pathname === "/2/tweets/12") {
      const id = pathname.split("/").pop();
      return {
        data: byId[id],
        includes: {
          users: [users[byId[id].author_id]]
        }
      };
    }

    if (pathname === "/2/tweets/search/recent") {
      const query = searchParams.get("query");
      if (query === "conversation_id:10") {
        return {
          data: [byId["10"], byId["11"]],
          includes: { users: [users.u10, users.u11] },
          meta: {}
        };
      }

      if (query === "conversation_id:12") {
        return {
          data: [byId["12"], byId["14"]],
          includes: { users: [users.u12, users.u14] },
          meta: {}
        };
      }
    }

    if (pathname === "/2/tweets/10/quote_tweets") {
      return {
        data: [byId["12"]],
        includes: { users: [users.u12] },
        meta: {}
      };
    }

    if (pathname === "/2/tweets/12/quote_tweets") {
      return {
        data: [],
        includes: { users: [] },
        meta: {}
      };
    }

    if (pathname === "/2/tweets/10/retweeted_by") {
      return {
        data: [users.u13],
        meta: {}
      };
    }

    if (pathname === "/2/tweets/12/retweeted_by") {
      return {
        data: [],
        meta: {}
      };
    }

    if (pathname === "/2/tweets") {
      return {
        data: [],
        includes: { users: [] }
      };
    }

    if (pathname === "/2/users") {
      return {
        data: []
      };
    }

    throw new Error(`Unexpected URL: ${url.toString()}`);
  });

  const snapshot = await xApiConversation.buildConversationSnapshot({
    clickedTweetId: "10",
    bearerToken: "test-token",
    fetchImpl,
    maxPagesPerCollection: 1,
    maxConversationRoots: 5,
    maxConnectedTweets: 50
  });

  assert.equal(snapshot.canonicalRootId, "10");
  assert.equal(Array.isArray(snapshot.nodes), true);
  assert.equal(Array.isArray(snapshot.edges), true);
  assert.equal(Array.isArray(snapshot.ranking), true);
  assert.equal(snapshot.ranking.length > 0, true);

  const nodeIds = new Set(snapshot.nodes.map((node) => node.id));
  assert.equal(nodeIds.has("10"), true);
  assert.equal(nodeIds.has("11"), true);
  assert.equal(nodeIds.has("12"), true);
  assert.equal(nodeIds.has("repost:10:u13"), true);
  assert.equal(nodeIds.has("14"), true);

  const rankedIds = new Set(snapshot.ranking.map((entry) => entry.id));
  assert.equal(rankedIds.has("repost:10:u13"), false);

  const edgeSet = new Set(snapshot.edges.map((edge) => `${edge.source}|${edge.target}|${edge.type}`));
  assert.equal(edgeSet.has("11|10|reply"), true);
  assert.equal(edgeSet.has("12|10|quote"), true);
  assert.equal(edgeSet.has("repost:10:u13|10|repost"), true);
  assert.equal(edgeSet.has("14|12|reply"), true);
});
