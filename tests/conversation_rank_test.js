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
