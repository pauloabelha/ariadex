const test = require("node:test");
const assert = require("node:assert/strict");
const engine = require("../core/conversation_engine.js");

function createTweet({ id, author_id, author, reply_to = null, quote_of = null }) {
  return {
    id,
    author_id,
    author,
    text: `tweet ${id}`,
    reply_to,
    quote_of,
    repost_of: null,
    replies: 0,
    reposts: 0,
    likes: 0,
    quote_count: 0
  };
}

test("runConversationEngine builds graph and ranking in one pass", () => {
  const tweets = [
    createTweet({ id: "A", author_id: "u1", author: "@u1" }),
    createTweet({ id: "B", author_id: "u2", author: "@u2", reply_to: "A" }),
    createTweet({ id: "C", author_id: "u3", author: "@u3", quote_of: "A" })
  ];

  const result = engine.runConversationEngine({
    tweets,
    rankOptions: { followingSet: new Set(["u2"]) }
  });

  assert.equal(result.rootId !== null, true);
  assert.equal(Array.isArray(result.nodes), true);
  assert.equal(Array.isArray(result.edges), true);
  assert.equal(Array.isArray(result.ranking), true);
  assert.ok(result.rankingMeta.scoreById instanceof Map);

  const edgeSet = new Set(result.edges.map((edge) => `${edge.source}|${edge.target}|${edge.type}`));
  assert.equal(edgeSet.has("B|A|reply"), true);
  assert.equal(edgeSet.has("C|A|quote"), true);
});

test("runConversationEngine is deterministic for equal-score graphs", () => {
  const tweets = [
    createTweet({ id: "A", author_id: "u1", author: "@u1" }),
    createTweet({ id: "B", author_id: "u2", author: "@u2" }),
    createTweet({ id: "C", author_id: "u3", author: "@u3" })
  ];

  const first = engine.runConversationEngine({ tweets });
  const second = engine.runConversationEngine({ tweets });

  assert.deepEqual(
    first.ranking.map((entry) => entry.id),
    second.ranking.map((entry) => entry.id)
  );
});

test("runConversationEngine handles large conversations (1000+ tweets)", () => {
  const tweets = [];

  for (let i = 0; i < 1200; i += 1) {
    tweets.push(createTweet({
      id: `T${i}`,
      author_id: `u${i % 50}`,
      author: `@u${i % 50}`,
      reply_to: i > 0 ? `T${i - 1}` : null
    }));
  }

  const result = engine.runConversationEngine({
    tweets,
    collapseThreads: false
  });

  assert.equal(result.nodes.length, 1200);
  assert.equal(result.ranking.length, 1200);
});
