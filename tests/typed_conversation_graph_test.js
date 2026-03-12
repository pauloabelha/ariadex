const test = require("node:test");
const assert = require("node:assert/strict");
const content = require("../extension/content.js");

function createTweet({ id, reply_to = null, quote_of = null, repost_of = null }) {
  return {
    id,
    author: `@${id.toLowerCase()}`,
    text: `tweet ${id}`,
    url: `https://x.com/user/status/${id}`,
    replies: 0,
    reposts: 0,
    likes: 0,
    reply_to,
    quote_of,
    repost_of
  };
}

test("buildConversationGraph returns typed reply edges", () => {
  const graph = content.buildConversationGraph([
    createTweet({ id: "A", reply_to: null }),
    createTweet({ id: "B", reply_to: "A" })
  ]);

  assert.equal(graph.rootId, "A");
  assert.equal(Array.isArray(graph.nodes), true);
  assert.equal(Array.isArray(graph.edges), true);
  assert.deepEqual(graph.edges, [{ source: "B", target: "A", type: "reply" }]);
});

test("buildConversationGraph includes quote and repost edge types", () => {
  const graph = content.buildConversationGraph([
    createTweet({ id: "A" }),
    createTweet({ id: "B", quote_of: "A" }),
    createTweet({ id: "C", repost_of: "A" })
  ]);

  const edges = graph.edges
    .map((edge) => `${edge.source}:${edge.target}:${edge.type}`)
    .sort();

  assert.deepEqual(edges, [
    "B:A:quote",
    "C:A:repost"
  ]);
});

test("buildConversationGraph ignores typed edges to unknown nodes", () => {
  const graph = content.buildConversationGraph([
    createTweet({ id: "A" }),
    createTweet({ id: "B", quote_of: "missing" })
  ]);

  assert.equal(graph.edges.length, 0);
});
