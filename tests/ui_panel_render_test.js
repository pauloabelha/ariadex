const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
const uiPanel = require("../extension/ui_panel.js");

function setupDom(html = "<body><main></main></body>") {
  const dom = new JSDOM(html, { url: "https://x.com/home" });
  global.window = dom.window;
  global.document = dom.window.document;
  global.Element = dom.window.Element;
  return dom;
}

function buildNodes(ids) {
  return ids.map((id, index) => ({
    id,
    author_id: `u${index + 1}`,
    author: `@user${index + 1}`,
    text: `tweet ${id}`
  }));
}

test("createPanelContainer returns expected panel structure", () => {
  setupDom();
  const panel = uiPanel.createPanelContainer();

  assert.equal(panel.className, "ariadex-panel");
  assert.ok(panel.querySelector(".ariadex-header"));
  assert.ok(panel.querySelector(".ariadex-panel-body"));
  assert.equal(panel.parentElement, document.body);
  assert.equal(panel.style.position, "fixed");
  assert.equal(panel.style.right, "24px");
});

test("buildPanelSections ranks network first and removes duplicates from global list", () => {
  setupDom();
  const nodes = [
    { id: "A", author_id: "u1", author: "@u1", text: "A" },
    { id: "B", author_id: "u2", author: "@u2", text: "B" },
    { id: "C", author_id: "u3", author: "@u3", text: "C" },
    { id: "D", author_id: "u4", author: "@u4", text: "D" }
  ];

  const scoreById = new Map([
    ["A", 0.90],
    ["B", 0.80],
    ["C", 0.70],
    ["D", 0.60]
  ]);

  const sections = uiPanel.buildPanelSections({
    nodes,
    scoreById,
    followingSet: new Set(["u1", "u3"]),
    networkLimit: 5,
    topLimit: 10
  });

  assert.deepEqual(sections.fromNetwork.map((entry) => entry.id), ["A", "C"]);
  assert.deepEqual(sections.topThinkers.map((entry) => entry.id), ["B", "D"]);
});

test("buildPanelSections handles empty following set", () => {
  setupDom();
  const nodes = buildNodes(["A", "B", "C"]);
  const scoreById = new Map([
    ["A", 0.4],
    ["B", 0.9],
    ["C", 0.1]
  ]);

  const sections = uiPanel.buildPanelSections({
    nodes,
    scoreById,
    followingSet: new Set(),
    networkLimit: 5,
    topLimit: 10
  });

  assert.deepEqual(sections.fromNetwork.map((entry) => entry.id), []);
  assert.deepEqual(sections.topThinkers.map((entry) => entry.id), ["B", "A", "C"]);
});

test("buildPanelSections excludes synthetic repost events", () => {
  setupDom();
  const nodes = [
    { id: "A", author_id: "u1", author: "@u1", text: "A" },
    { id: "repost:1:u2", author_id: "u2", author: "@u2", text: "@u2 reposted this post", type: "repost_event" },
    { id: "B", author_id: "u3", author: "@u3", text: "B" }
  ];
  const scoreById = new Map([
    ["A", 0.5],
    ["repost:1:u2", 0.9],
    ["B", 0.4]
  ]);

  const sections = uiPanel.buildPanelSections({
    nodes,
    scoreById,
    followingSet: new Set(),
    networkLimit: 5,
    topLimit: 10
  });

  assert.deepEqual(sections.topThinkers.map((entry) => entry.id), ["A", "B"]);
});

test("buildPanelSections is deterministic for equal scores", () => {
  setupDom();
  const nodes = buildNodes(["A", "B", "C", "D"]);
  const scoreById = new Map([
    ["A", 1],
    ["B", 1],
    ["C", 1],
    ["D", 1]
  ]);

  const first = uiPanel.buildPanelSections({
    nodes,
    scoreById,
    followingSet: new Set(["u1", "u3"]),
    networkLimit: 2,
    topLimit: 2
  });

  const second = uiPanel.buildPanelSections({
    nodes,
    scoreById,
    followingSet: new Set(["u1", "u3"]),
    networkLimit: 2,
    topLimit: 2
  });

  assert.deepEqual(first.fromNetwork.map((entry) => entry.id), second.fromNetwork.map((entry) => entry.id));
  assert.deepEqual(first.topThinkers.map((entry) => entry.id), second.topThinkers.map((entry) => entry.id));
});

test("buildPanelSections handles large graphs efficiently", () => {
  setupDom();

  const nodes = [];
  const scoreById = new Map();
  const followingSet = new Set();

  for (let i = 0; i < 1500; i += 1) {
    const id = `T${i}`;
    const authorId = `U${i % 200}`;

    nodes.push({
      id,
      author_id: authorId,
      author: `@${authorId}`,
      text: `Tweet ${i}`
    });

    scoreById.set(id, 1500 - i);

    if (i < 20) {
      followingSet.add(authorId);
    }
  }

  const sections = uiPanel.buildPanelSections({
    nodes,
    scoreById,
    followingSet,
    networkLimit: 5,
    topLimit: 10
  });

  const ids = new Set([
    ...sections.fromNetwork.map((entry) => entry.id),
    ...sections.topThinkers.map((entry) => entry.id)
  ]);

  assert.equal(sections.fromNetwork.length, 5);
  assert.equal(sections.topThinkers.length, 10);
  assert.equal(ids.size, 15);
});

test("renderConversationPanel renders two-tier sections with cards", () => {
  setupDom();

  const nodes = [
    { id: "A", author_id: "u1", author: "@u1", text: "Tweet A" },
    { id: "B", author_id: "u2", author: "@u2", text: "Tweet B" },
    { id: "C", author_id: "u3", author: "@u3", text: "Tweet C" }
  ];
  const scoreById = new Map([
    ["A", 0.9],
    ["B", 0.8],
    ["C", 0.7]
  ]);

  uiPanel.renderConversationPanel({
    nodes,
    scoreById,
    followingSet: new Set(["u2"]),
    networkLimit: 5,
    topLimit: 10
  });

  const panel = document.querySelector(".ariadex-panel");
  assert.ok(panel);
  assert.match(panel.textContent, /From Your Network/);
  assert.match(panel.textContent, /Top Thinkers/);

  const cards = panel.querySelectorAll(".ariadex-thread");
  assert.ok(cards.length >= 2);
  assert.match(cards[0].textContent, /ThinkerRank:/);
});

test("clicking a rendered thread scrolls to the tweet element", () => {
  setupDom(`
    <body>
      <article data-testid="tweet" role="article" id="tweet-123">
        <a href="/user/status/123">status</a>
      </article>
    </body>
  `);

  const tweet = document.getElementById("tweet-123");
  let scrolled = false;
  tweet.scrollIntoView = () => {
    scrolled = true;
  };

  uiPanel.renderConversationPanel({
    nodes: [{ id: "123", author_id: "u1", author: "@u1", text: "Thread body" }],
    scoreById: new Map([["123", 0.77]]),
    followingSet: new Set(),
    networkLimit: 0,
    topLimit: 1
  });

  const item = document.querySelector(".ariadex-thread:not(.ariadex-empty)");
  item.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

  assert.equal(scrolled, true);
  assert.equal(tweet.classList.contains("ariadex-highlight"), true);
});
