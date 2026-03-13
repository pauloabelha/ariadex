const test = require("node:test");
const assert = require("node:assert/strict");
const adjacency = require("../extension/conversation_adjacency.js");

test("createConversationAdjacency builds map-based node and edge indexes", () => {
  const index = adjacency.createConversationAdjacency({
    nodes: [
      { id: "A", author_id: "u1", author: "@a", text: "root", replies: 1, reposts: 0, likes: 5 },
      { id: "B", author_id: "u2", author: "@b", text: "reply", replies: 0, reposts: 0, likes: 1 }
    ],
    edges: [
      { source: "B", target: "A", type: "reply" }
    ]
  });

  assert.ok(index.nodes instanceof Map);
  assert.ok(index.incomingEdges instanceof Map);
  assert.ok(index.outgoingEdges instanceof Map);
  assert.equal(index.nodeCount, 2);
  assert.equal(index.edgeCount, 1);

  const nodeA = index.nodes.get("A");
  const nodeB = index.nodes.get("B");
  assert.ok(Array.isArray(nodeA.incoming_edges));
  assert.ok(Array.isArray(nodeA.outgoing_edges));
  assert.equal(nodeA.metrics.likes, 5);
  assert.equal(nodeB.metrics.replies, 0);

  assert.equal(index.incomingEdges.get("A"), nodeA.incoming_edges);
  assert.equal(index.outgoingEdges.get("B"), nodeB.outgoing_edges);
  assert.equal(index.incomingEdges.get("A").length, 1);
  assert.equal(index.incomingEdges.get("A")[0].type, "reply");
});

test("edge weights apply by type and unsupported edges are excluded", () => {
  const index = adjacency.createConversationAdjacency({
    nodes: [{ id: "A" }, { id: "B" }, { id: "C" }],
    edges: [
      { source: "B", target: "A", type: "reply" },
      { source: "C", target: "A", type: "quote" },
      { source: "C", target: "B", type: "repost" }
    ]
  });

  const replyEdge = index.edges.find((edge) => edge.type === "reply");
  const quoteEdge = index.edges.find((edge) => edge.type === "quote");
  const repostEdge = index.edges.find((edge) => edge.type === "repost");

  assert.equal(replyEdge.weight, 1.0);
  assert.equal(quoteEdge.weight, 1.3);
  assert.equal(repostEdge, undefined);
});

test("invalid edges are ignored and duplicates are deduped", () => {
  const index = adjacency.createConversationAdjacency({
    nodes: [{ id: "A" }, { id: "B" }],
    edges: [
      { source: "B", target: "A", type: "reply" },
      { source: "B", target: "A", type: "reply" },
      { source: "B", target: "missing", type: "reply" },
      { source: "A", target: "A", type: "reply" }
    ]
  });

  assert.equal(index.edgeCount, 1);
  assert.equal(index.outgoingEdges.get("B").length, 1);
});

test("validateConversationAdjacency reports no errors on valid graph", () => {
  const index = adjacency.createConversationAdjacency({
    nodes: [{ id: "A" }, { id: "B" }],
    edges: [{ source: "B", target: "A", type: "quote" }]
  });

  const errors = adjacency.validateConversationAdjacency(index);
  assert.deepEqual(errors, []);
});

test("createConversationAdjacency handles 1000+ nodes", () => {
  const nodes = [];
  const edges = [];

  for (let i = 0; i < 1200; i += 1) {
    nodes.push({ id: `T${i}`, author_id: `U${i % 20}` });
    if (i > 0) {
      edges.push({ source: `T${i}`, target: `T${i - 1}`, type: i % 2 === 0 ? "reply" : "quote" });
    }
  }

  const index = adjacency.createConversationAdjacency({ nodes, edges });
  const errors = adjacency.validateConversationAdjacency(index);

  assert.equal(index.nodeCount, 1200);
  assert.equal(index.edgeCount, 1199);
  assert.deepEqual(errors, []);
});
