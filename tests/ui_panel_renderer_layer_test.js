const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
const panelRenderer = require("../ui/panel_renderer.js");

test("panel renderer removes network/global duplicates and applies limits", () => {
  const nodes = [
    { id: "A", author_id: "u1", author: "@u1", text: "A" },
    { id: "B", author_id: "u2", author: "@u2", text: "B" },
    { id: "C", author_id: "u3", author: "@u3", text: "C" },
    { id: "D", author_id: "u4", author: "@u4", text: "D" }
  ];

  const scoreById = new Map([
    ["A", 0.9],
    ["B", 0.8],
    ["C", 0.7],
    ["D", 0.6]
  ]);

  const sections = panelRenderer.buildPanelSections({
    nodes,
    scoreById,
    followingSet: new Set(["u1", "u3"]),
    networkLimit: 5,
    topLimit: 10
  });

  assert.deepEqual(sections.fromNetwork.map((entry) => entry.id), ["A", "C"]);
  assert.deepEqual(sections.topThinkers.map((entry) => entry.id), ["B", "D"]);
});

test("panel renderer renders into document body", () => {
  const dom = new JSDOM("<body></body>", { url: "https://x.com/home" });
  global.window = dom.window;
  global.document = dom.window.document;
  global.Element = dom.window.Element;

  panelRenderer.renderConversationPanel({
    nodes: [{ id: "A", author_id: "u1", author: "@u1", text: "hello" }],
    scoreById: new Map([["A", 1]]),
    followingSet: new Set(["u1"]),
    root: dom.window.document
  });

  const panel = dom.window.document.querySelector(".ariadex-panel");
  assert.ok(panel);
  assert.match(panel.textContent, /From Your Network/);
  assert.match(panel.textContent, /Top Thinkers/);
});
