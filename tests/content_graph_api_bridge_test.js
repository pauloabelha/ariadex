const test = require("node:test");
const assert = require("node:assert/strict");

const content = require("../extension/content.js");

function makePayload(overrides = {}) {
  return {
    canonicalRootId: "100",
    rootId: "100",
    root: { id: "100" },
    nodes: [{ id: "100" }],
    edges: [],
    ranking: [{ id: "100", score: 1 }],
    rankingMeta: { scoreById: { 100: 1 } },
    warnings: [],
    ...overrides
  };
}

function cleanupGlobals() {
  delete global.chrome;
  delete global.window;
}

test.afterEach(() => {
  cleanupGlobals();
});

test("buildConversationSnapshot uses extension message bridge for graph API", async () => {
  let sentMessage = null;
  global.chrome = {
    runtime: {
      id: "test-extension-id",
      sendMessage(message, callback) {
        sentMessage = message;
        callback({
          ok: true,
          status: 200,
          statusText: "OK",
          body: makePayload()
        });
      }
    }
  };
  global.window = {
    fetch() {
      throw new Error("window.fetch should not be used when bridge is available");
    },
    localStorage: { getItem: () => null }
  };

  const snapshot = await content.buildConversationSnapshot({
    clickedTweetId: "200",
    graphApiUrl: "http://127.0.0.1:8787",
    allowClientDirectApi: false,
    rankOptions: { followingSet: new Set(["42"]) }
  });

  assert.equal(snapshot.canonicalRootId, "100");
  assert.equal(sentMessage.type, "ariadex_graph_api_request");
  assert.equal(sentMessage.url, "http://127.0.0.1:8787/v1/conversation-snapshot");
  assert.equal(sentMessage.method, "POST");
});

test("buildConversationSnapshot throws when bridge request fails and direct mode is disabled", async () => {
  global.chrome = {
    runtime: {
      id: "test-extension-id",
      sendMessage(_message, callback) {
        callback({
          ok: false,
          error: "server_unavailable"
        });
      }
    }
  };
  global.window = {
    localStorage: { getItem: () => null }
  };

  await assert.rejects(
    () => content.buildConversationSnapshot({
      clickedTweetId: "200",
      graphApiUrl: "http://127.0.0.1:8787",
      allowClientDirectApi: false,
      rankOptions: { followingSet: new Set() }
    }),
    /Graph API request failed and direct client API mode is disabled/
  );
});

test("buildConversationSnapshot falls back to window.fetch when extension bridge is unavailable", async () => {
  let fetchCalls = 0;
  global.window = {
    fetch: async () => {
      fetchCalls += 1;
      return {
        ok: true,
        async json() {
          return makePayload({ canonicalRootId: "fallback-root" });
        }
      };
    },
    localStorage: { getItem: () => null }
  };

  const snapshot = await content.buildConversationSnapshot({
    clickedTweetId: "200",
    graphApiUrl: "http://127.0.0.1:8787",
    allowClientDirectApi: false,
    rankOptions: { followingSet: new Set() }
  });

  assert.equal(fetchCalls >= 1, true);
  assert.equal(snapshot.canonicalRootId, "fallback-root");
});

test("buildConversationArticle uses extension message bridge for article endpoint", async () => {
  let sentMessage = null;
  global.chrome = {
    runtime: {
      id: "test-extension-id",
      sendMessage(message, callback) {
        sentMessage = message;
        callback({
          ok: true,
          status: 200,
          statusText: "OK",
          body: {
            article: {
              title: "Digest",
              dek: "Dek",
              summary: "Summary",
              sections: [{ heading: "One", body: "Body" }]
            },
            pdf: {
              filename: "digest.pdf",
              mimeType: "application/pdf",
              base64: "JVBERi0xLjQ="
            }
          }
        });
      }
    }
  };
  global.window = {
    fetch() {
      throw new Error("window.fetch should not be used when bridge is available");
    },
    localStorage: { getItem: () => null }
  };

  const article = await content.buildConversationArticle({
    clickedTweetId: "200",
    graphApiUrl: "http://127.0.0.1:8787",
    rankOptions: { followingSet: new Set(["42"]) }
  });

  assert.equal(article.article.title, "Digest");
  assert.equal(sentMessage.url, "http://127.0.0.1:8787/v1/conversation-article");
  assert.equal(sentMessage.method, "POST");
});
