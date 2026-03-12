const test = require("node:test");
const assert = require("node:assert/strict");
const collapse = require("../extension/thread_collapse.js");

function tweet(id, author) {
  return {
    id,
    author,
    text: `tweet ${id}`,
    url: `https://x.com/${author.replace("@", "")}/status/${id}`
  };
}

test("collapseAuthorThread collapses multiple root-author tweets", () => {
  const graph = {
    rootId: "1",
    root: tweet("1", "@A"),
    nodes: [
      tweet("1", "@A"),
      tweet("2", "@A"),
      tweet("3", "@A"),
      tweet("4", "@B"),
      tweet("5", "@C")
    ],
    edges: [
      { source: "4", target: "1", type: "reply" },
      { source: "5", target: "2", type: "reply" }
    ]
  };

  const collapsed = collapse.collapseAuthorThread(graph);

  const ids = collapsed.nodes.map((n) => n.id);
  assert.equal(ids.includes("author_thread:@a"), true);
  assert.equal(ids.includes("1"), false);
  assert.equal(ids.includes("2"), false);
  assert.equal(ids.includes("3"), false);
  assert.equal(ids.includes("4"), true);
  assert.equal(ids.includes("5"), true);
});

test("collapseAuthorThread keeps graph unchanged when only one root-author tweet", () => {
  const graph = {
    rootId: "1",
    root: tweet("1", "@A"),
    nodes: [tweet("1", "@A"), tweet("4", "@B")],
    edges: [{ source: "4", target: "1", type: "reply" }]
  };

  const collapsed = collapse.collapseAuthorThread(graph);

  assert.deepEqual(collapsed, graph);
});

test("collapseAuthorThread remaps edges to author_thread target", () => {
  const graph = {
    rootId: "1",
    root: tweet("1", "@A"),
    nodes: [tweet("1", "@A"), tweet("2", "@A"), tweet("4", "@B")],
    edges: [
      { source: "4", target: "1", type: "reply" },
      { source: "4", target: "2", type: "quote" }
    ]
  };

  const collapsed = collapse.collapseAuthorThread(graph);
  const mappedTargets = collapsed.edges.map((e) => e.target);

  assert.deepEqual(mappedTargets, ["author_thread:@a", "author_thread:@a"]);
  assert.equal(collapsed.rootId, "author_thread:@a");
});
