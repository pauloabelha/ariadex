const test = require("node:test");
const assert = require("node:assert/strict");
const ranker = require("../extension/conversation_rank.js");

function graph(nodes, edges) {
  return {
    rootId: nodes[0]?.id || null,
    nodes,
    edges,
    root: nodes[0] || null,
    children: []
  };
}

function getScore(ranking, id) {
  if (ranking.scoreById instanceof Map) {
    return ranking.scoreById.get(id);
  }

  return ranking.scoreById?.[id];
}

test("rankConversationGraph gives higher score to cited target", () => {
  const g = graph(
    [{ id: "A" }, { id: "B" }, { id: "C" }],
    [
      { source: "B", target: "A", type: "reply" },
      { source: "C", target: "A", type: "quote" }
    ]
  );

  const ranking = ranker.rankConversationGraph(g);

  assert.equal(ranking.topTweetIds[0], "A");
  assert.ok(getScore(ranking, "A") > getScore(ranking, "B"));
  assert.ok(getScore(ranking, "A") > getScore(ranking, "C"));
});

test("rankConversationGraph returns near-uniform scores with no edges", () => {
  const g = graph([{ id: "A" }, { id: "B" }, { id: "C" }], []);
  const ranking = ranker.rankConversationGraph(g);

  const a = getScore(ranking, "A");
  const b = getScore(ranking, "B");
  const c = getScore(ranking, "C");

  assert.ok(Math.abs(a - b) < 1e-4);
  assert.ok(Math.abs(b - c) < 1e-4);
  assert.ok(ranking.iterations >= 10);
});

test("edge type weights affect influence split", () => {
  const g = graph(
    [{ id: "A" }, { id: "B" }, { id: "D" }],
    [
      { source: "D", target: "A", type: "quote" },
      { source: "D", target: "B", type: "reply" }
    ]
  );

  const ranking = ranker.rankConversationGraph(g);
  assert.ok(getScore(ranking, "A") > getScore(ranking, "B"));
});

test("followed authors get boosted base score", () => {
  const g = graph(
    [
      { id: "A", author_id: "u1" },
      { id: "B", author_id: "u2" },
      { id: "C", author_id: "u3" }
    ],
    []
  );

  const ranking = ranker.rankConversationGraph(g, {
    followingSet: new Set(["u2"])
  });

  assert.equal(ranking.topTweetIds[0], "B");
  assert.ok(getScore(ranking, "B") > getScore(ranking, "A"));
});

test("followed authors can be matched by handle in followingSet", () => {
  const g = graph(
    [
      { id: "A", author_id: "u1", author: "@alice" },
      { id: "B", author_id: "u2", author: "@bob" },
      { id: "C", author_id: "u3", author: "@carol" }
    ],
    []
  );

  const ranking = ranker.rankConversationGraph(g, {
    followingSet: new Set(["@bob"])
  });

  assert.equal(ranking.topTweetIds[0], "B");
  assert.ok(getScore(ranking, "B") > getScore(ranking, "A"));
});

test("followed authors match case-insensitive handles in followingSet", () => {
  const g = graph(
    [
      { id: "A", author_id: "u1", author: "@alice" },
      { id: "B", author_id: "u2", author: "@bob" }
    ],
    []
  );

  const ranking = ranker.rankConversationGraph(g, {
    followingSet: new Set(["@BoB"])
  });

  assert.equal(ranking.topTweetIds[0], "B");
  assert.ok(getScore(ranking, "B") > getScore(ranking, "A"));
});

test("ranking is deterministic when scores tie", () => {
  const nodes = [{ id: "A" }, { id: "B" }, { id: "C" }, { id: "D" }];
  const g = graph(nodes, []);

  const first = ranker.rankConversationGraph(g);
  const second = ranker.rankConversationGraph(g);

  assert.deepEqual(first.topTweetIds, second.topTweetIds);
});

test("ranking includes adjacency index maps for traversal", () => {
  const g = graph(
    [{ id: "A" }, { id: "B" }],
    [{ source: "B", target: "A", type: "reply" }]
  );

  const ranking = ranker.rankConversationGraph(g);

  assert.ok(ranking.graphIndex);
  assert.ok(ranking.graphIndex.nodes instanceof Map);
  assert.ok(ranking.graphIndex.incomingEdges instanceof Map);
  assert.ok(ranking.graphIndex.outgoingEdges instanceof Map);
  assert.equal(ranking.graphIndex.nodeCount, 2);
  assert.equal(ranking.graphIndex.edgeCount, 1);
});

test("tweet reach affects ranking even when graph structure is identical", () => {
  const g = graph(
    [
      { id: "A" },
      { id: "B", likes: 300, reposts: 50, replies: 20, quote_count: 10 },
      { id: "C" }
    ],
    []
  );

  const ranking = ranker.rankConversationGraph(g);
  assert.equal(ranking.topTweetIds[0], "B");
  assert.ok(getScore(ranking, "B") > getScore(ranking, "A"));
});

test("high-reach citer transfers more recursive influence to cited tweet", () => {
  const g = graph(
    [
      { id: "A" },
      { id: "D" },
      { id: "B", likes: 500, reposts: 70, replies: 40, quote_count: 15 },
      { id: "C", likes: 2, reposts: 0, replies: 1, quote_count: 0 }
    ],
    [
      { source: "B", target: "A", type: "reply" },
      { source: "C", target: "D", type: "reply" }
    ]
  );

  const ranking = ranker.rankConversationGraph(g);
  assert.ok(getScore(ranking, "A") > getScore(ranking, "D"));
});

test("ranking exposes reachSignal per scored entry", () => {
  const g = graph(
    [
      { id: "A", likes: 10, reposts: 1, replies: 1, quote_count: 0 },
      { id: "B", likes: 100, reposts: 10, replies: 4, quote_count: 2 }
    ],
    []
  );

  const ranking = ranker.rankConversationGraph(g);
  const a = ranking.scores.find((entry) => entry.id === "A");
  const b = ranking.scores.find((entry) => entry.id === "B");

  assert.ok(a);
  assert.ok(b);
  assert.equal(typeof a.reachSignal, "number");
  assert.equal(typeof b.reachSignal, "number");
  assert.ok(b.reachSignal > a.reachSignal);
});

test("disabling reach knobs falls back to author-prior-only behavior", () => {
  const g = graph(
    [
      { id: "A", author_id: "u1", likes: 10000, reposts: 4000, replies: 1000, quote_count: 800 },
      { id: "B", author_id: "u2", likes: 0, reposts: 0, replies: 0, quote_count: 0 }
    ],
    []
  );

  const ranking = ranker.rankConversationGraph(g, {
    followingSet: new Set(["u2"]),
    reachWeight: 0,
    edgeReachBoost: 0
  });

  assert.equal(ranking.topTweetIds[0], "B");
});

test("follower count affects ranking when graph structure is identical", () => {
  const g = graph(
    [
      { id: "A", author_profile: { public_metrics: { followers_count: 20 } } },
      { id: "B", author_profile: { public_metrics: { followers_count: 250000 } } },
      { id: "C", author_profile: { public_metrics: { followers_count: 50 } } }
    ],
    []
  );

  const ranking = ranker.rankConversationGraph(g, {
    reachWeight: 0,
    edgeReachBoost: 0
  });

  assert.equal(ranking.topTweetIds[0], "B");
  assert.ok(getScore(ranking, "B") > getScore(ranking, "A"));
});

test("disabling follower weight removes follower-count bias", () => {
  const g = graph(
    [
      { id: "A", author_profile: { public_metrics: { followers_count: 10 } } },
      { id: "B", author_profile: { public_metrics: { followers_count: 1_000_000 } } }
    ],
    []
  );

  const ranking = ranker.rankConversationGraph(g, {
    followerWeight: 0,
    reachWeight: 0,
    edgeReachBoost: 0
  });

  const a = getScore(ranking, "A");
  const b = getScore(ranking, "B");
  assert.ok(Math.abs(a - b) < 1e-8);
});

test("root-mentioned authors get a bounded base-score boost when they appear in the graph", () => {
  const g = graph(
    [
      { id: "root", author: "@host", text: "Curious what @alice thinks about this thread." },
      { id: "alice", author: "@alice" },
      { id: "bob", author: "@bob" }
    ],
    []
  );

  const ranking = ranker.rankConversationGraph(g, {
    reachWeight: 0,
    edgeReachBoost: 0,
    followerWeight: 0,
    followedAuthorWeight: 1,
    defaultAuthorWeight: 1
  });

  assert.ok(getScore(ranking, "alice") > getScore(ranking, "bob"));
  const aliceEntry = ranking.scores.find((entry) => entry.id === "alice");
  const bobEntry = ranking.scores.find((entry) => entry.id === "bob");
  assert.equal(aliceEntry?.rootMentionSignal, 1);
  assert.equal(bobEntry?.rootMentionSignal, 0);
  assert.deepEqual(ranking.rootMentionHandles, ["@alice"]);
});

test("direct replies from root-mentioned authors get an additional bounded boost", () => {
  const g = graph(
    [
      { id: "root", author: "@host", text: "Would love replies from @alice and @bob here." },
      { id: "alice-direct", author: "@alice", reply_to: "root" },
      { id: "bob-later", author: "@bob" }
    ],
    [
      { source: "alice-direct", target: "root", type: "reply" }
    ]
  );

  const ranking = ranker.rankConversationGraph(g, {
    reachWeight: 0,
    edgeReachBoost: 0,
    followerWeight: 0,
    followedAuthorWeight: 1,
    defaultAuthorWeight: 1
  });

  assert.ok(getScore(ranking, "alice-direct") > getScore(ranking, "bob-later"));
  const aliceEntry = ranking.scores.find((entry) => entry.id === "alice-direct");
  const bobEntry = ranking.scores.find((entry) => entry.id === "bob-later");
  assert.equal(aliceEntry?.rootMentionSignal, 1);
  assert.equal(aliceEntry?.rootMentionDirectSignal, 1);
  assert.equal(bobEntry?.rootMentionSignal, 1);
  assert.equal(bobEntry?.rootMentionDirectSignal, 0);
});
