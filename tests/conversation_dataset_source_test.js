const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const datasetSource = require("../data/conversation_dataset_source.js");

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

test("loadConversationDataset normalizes fixture documents", async () => {
  const dataset = await datasetSource.loadConversationDataset({
    kind: "fixture",
    document: {
      fixtureType: "full_conversation_graph",
      source: {
        mode: "expensive_capture"
      },
      conversation: {
        clickedTweetId: "clicked",
        rootHintTweetId: "hint",
        canonicalRootId: "root",
        rootTweet: { id: "root", text: "Root tweet" },
        tweets: [{ id: "root", text: "Root tweet" }, { id: "clicked", text: "Clicked tweet" }],
        users: [{ id: "u1", username: "alice" }],
        warnings: ["warning-one"]
      }
    }
  });

  assert.equal(dataset.source.kind, "fixture");
  assert.equal(dataset.source.mode, "expensive_capture");
  assert.equal(dataset.clickedTweetId, "clicked");
  assert.equal(dataset.rootHintTweetId, "hint");
  assert.equal(dataset.canonicalRootId, "root");
  assert.equal(dataset.rootTweet.id, "root");
  assert.equal(dataset.tweets.length, 2);
  assert.equal(dataset.users.length, 1);
  assert.deepEqual(dataset.warnings, ["warning-one"]);
});

test("loadConversationDatasetFromFixtureFile reads persisted fixture json", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ariadex-fixture-source-"));
  const fixturePath = path.join(tempDir, "fixture.json");
  await fs.writeFile(fixturePath, `${JSON.stringify({
    fixtureType: "full_conversation_graph",
    conversation: {
      canonicalRootId: "root",
      tweets: [{ id: "root", text: "Root tweet" }],
      users: [],
      warnings: []
    }
  }, null, 2)}\n`, "utf8");

  const dataset = await datasetSource.loadConversationDatasetFromFixtureFile(fixturePath);

  assert.equal(dataset.source.kind, "fixture");
  assert.equal(dataset.source.path, fixturePath);
  assert.equal(dataset.canonicalRootId, "root");
  assert.equal(dataset.tweets.length, 1);
});

test("loadConversationDataset uses the same abstraction for live x api collection", async () => {
  const byId = {
    "10": {
      id: "10",
      author_id: "u10",
      text: "Root tweet",
      referenced_tweets: [],
      public_metrics: { reply_count: 1, retweet_count: 0, like_count: 5, quote_count: 0 }
    },
    "20": {
      id: "20",
      author_id: "u20",
      text: "Clicked reply",
      referenced_tweets: [{ type: "replied_to", id: "10" }],
      public_metrics: { reply_count: 0, retweet_count: 0, like_count: 2, quote_count: 0 }
    }
  };
  const users = {
    u10: { id: "u10", username: "root_author", name: "Root", public_metrics: { followers_count: 100 } },
    u20: { id: "u20", username: "clicked_author", name: "Clicked", public_metrics: { followers_count: 50 } }
  };

  const dataset = await datasetSource.loadConversationDataset({
    kind: "x_api",
    bearerToken: "token",
    clickedTweetId: "20",
    includeQuoteTweets: false,
    includeRetweets: false,
    includeQuoteReplies: false,
    maxPagesPerCollection: 1,
    maxConversationRoots: 4,
    maxConnectedTweets: 20,
    fetchImpl: async (urlString) => {
      const url = new URL(urlString);
      const { pathname, searchParams } = url;

      if (pathname === "/2/tweets/20") {
        return jsonResponse({
          data: byId["20"],
          includes: { users: [users.u20] }
        });
      }

      if (pathname === "/2/tweets/10") {
        return jsonResponse({
          data: byId["10"],
          includes: { users: [users.u10] }
        });
      }

      if (pathname === "/2/tweets/search/recent" && searchParams.get("query") === "conversation_id:10") {
        return jsonResponse({
          data: [byId["10"], byId["20"]],
          includes: { users: [users.u10, users.u20] },
          meta: {}
        });
      }

      throw new Error(`Unexpected URL ${urlString}`);
    }
  });

  assert.equal(dataset.source.kind, "x_api");
  assert.equal(dataset.clickedTweetId, "20");
  assert.equal(dataset.canonicalRootId, "10");
  assert.equal(dataset.rootTweet.id, "10");
  assert.equal(dataset.tweets.some((tweet) => tweet.id === "20"), true);
});
