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
  assert.ok(ranking.scoreById.A > ranking.scoreById.B);
  assert.ok(ranking.scoreById.A > ranking.scoreById.C);
});

test("rankConversationGraph returns near-uniform scores with no edges", () => {
  const g = graph([{ id: "A" }, { id: "B" }, { id: "C" }], []);
  const ranking = ranker.rankConversationGraph(g);

  const a = ranking.scoreById.A;
  const b = ranking.scoreById.B;
  const c = ranking.scoreById.C;

  assert.ok(Math.abs(a - b) < 1e-4);
  assert.ok(Math.abs(b - c) < 1e-4);
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
  assert.ok(ranking.scoreById.A > ranking.scoreById.B);
});

test("ignores edges with unknown endpoints", () => {
  const g = graph(
    [{ id: "A" }, { id: "B" }],
    [{ source: "Z", target: "A", type: "reply" }]
  );

  const ranking = ranker.rankConversationGraph(g);
  assert.equal(ranking.scores.length, 2);
  assert.ok(Number.isFinite(ranking.scoreById.A));
  assert.ok(Number.isFinite(ranking.scoreById.B));
});

test("engagement priors separate scores when edges are sparse", () => {
  const g = graph(
    [
      { id: "A", likes: 120, replies: 25, reposts: 10 },
      { id: "B", likes: 2, replies: 0, reposts: 0 },
      { id: "C", likes: 1, replies: 0, reposts: 0 }
    ],
    []
  );

  const ranking = ranker.rankConversationGraph(g);

  assert.equal(ranking.topTweetIds[0], "A");
  assert.ok(ranking.scoreSpread > 0);
});
