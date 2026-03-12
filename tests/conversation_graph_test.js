const test = require("node:test");
const assert = require("node:assert/strict");
const content = require("../extension/content.js");

function createTweet({ id, reply_to = null, author = "@user", text = "text" }) {
  return {
    id,
    author,
    text,
    url: id ? `https://x.com/user/status/${id}` : null,
    replies: 0,
    reposts: 0,
    likes: 0,
    reply_to
  };
}

test("buildConversationGraph handles linear chain A -> B -> C", () => {
  const tweets = [
    createTweet({ id: "A", reply_to: null }),
    createTweet({ id: "B", reply_to: "A" }),
    createTweet({ id: "C", reply_to: "B" })
  ];

  const graph = content.buildConversationGraph(tweets);

  assert.equal(graph.root.id, "A");
  assert.equal(graph.children.length, 1);
  assert.equal(graph.children[0].tweet.id, "B");
  assert.equal(graph.children[0].children.length, 1);
  assert.equal(graph.children[0].children[0].tweet.id, "C");
});

test("buildConversationGraph handles branching A -> {B, C}", () => {
  const tweets = [
    createTweet({ id: "A", reply_to: null }),
    createTweet({ id: "B", reply_to: "A" }),
    createTweet({ id: "C", reply_to: "A" })
  ];

  const graph = content.buildConversationGraph(tweets);
  const childIds = graph.children.map((node) => node.tweet.id).sort();

  assert.equal(graph.root.id, "A");
  assert.deepEqual(childIds, ["B", "C"]);
});

test("buildConversationGraph tolerates missing parent", () => {
  const tweets = [
    createTweet({ id: "B", reply_to: "unknown_parent" })
  ];

  const graph = content.buildConversationGraph(tweets);

  assert.equal(graph.root.id, "B");
  assert.equal(graph.children.length, 0);
});

test("buildConversationGraph ignores duplicate tweets", () => {
  const tweets = [
    createTweet({ id: "A", reply_to: null }),
    createTweet({ id: "B", reply_to: "A" }),
    createTweet({ id: "B", reply_to: "A", text: "duplicate" })
  ];

  const graph = content.buildConversationGraph(tweets);

  assert.equal(graph.root.id, "A");
  assert.equal(graph.children.length, 1);
  assert.equal(graph.children[0].tweet.id, "B");
});

test("indexTweetsById maps unique ids only", () => {
  const index = content.indexTweetsById([
    createTweet({ id: "A" }),
    createTweet({ id: "A", text: "dupe" }),
    createTweet({ id: "B" })
  ]);

  assert.equal(index.A.id, "A");
  assert.equal(index.B.id, "B");
  assert.deepEqual(Object.keys(index).sort(), ["A", "B"]);
});
