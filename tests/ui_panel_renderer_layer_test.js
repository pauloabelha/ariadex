const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
const panelRenderer = require("../ui/panel_renderer.js");

test("panel renderer removes network/global duplicates and applies limits", () => {
  const nodes = [
    { id: "A", author_id: "u1", author: "@u1", text: "A", reply_to: "R", author_profile: { username: "u1", name: "U1", description: "" } },
    { id: "B", author_id: "u2", author: "@u2", text: "B", reply_to: "R", author_profile: { username: "u2", name: "U2", description: "" } },
    { id: "C", author_id: "u3", author: "@u3", text: "C", quote_of: "R", author_profile: { username: "u3", name: "U3", description: "" } },
    { id: "D", author_id: "u4", author: "@u4", text: "D", reply_to: "R", author_profile: { username: "u4", name: "U4", description: "" } }
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
    nodes: [{ id: "A", author_id: "u1", author: "@u1", text: "hello", quote_of: "R", author_profile: { username: "u1", name: "U1", description: "" } }],
    scoreById: new Map([["A", 1]]),
    relationshipById: new Map([["A", "quote"]]),
    followingSet: new Set(["u1"]),
    root: dom.window.document
  });

  const panel = dom.window.document.querySelector(".ariadex-panel");
  assert.ok(panel);
  assert.match(panel.textContent, /From your network/);
  assert.match(panel.textContent, /Reading path/);
  assert.match(panel.textContent, /Quote/);
  assert.equal(panel.querySelector(".ariadex-mode-toggle"), null);
});

test("panel renderer shows profile image when available", () => {
  const dom = new JSDOM("<body></body>", { url: "https://x.com/home" });
  global.window = dom.window;
  global.document = dom.window.document;
  global.Element = dom.window.Element;

  panelRenderer.renderConversationPanel({
    nodes: [{
      id: "A",
      author_id: "u1",
      author: "@u1",
      text: "hello",
      quote_of: "R",
      author_profile: {
        username: "u1",
        name: "U1",
        description: "",
        profile_image_url: "https://pbs.twimg.com/profile_images/test_normal.jpg"
      }
    }],
    scoreById: new Map([["A", 1]]),
    relationshipById: new Map([["A", "quote"]]),
    followingSet: new Set(["u1"]),
    root: dom.window.document
  });

  const avatar = dom.window.document.querySelector(".ariadex-thread img");
  assert.ok(avatar);
  assert.match(avatar.src, /profile_images\/test_normal\.jpg/);
});

test("panel renderer shows people avatars and selected tweet counts", () => {
  const dom = new JSDOM("<body></body>", { url: "https://x.com/home" });
  global.window = dom.window;
  global.document = dom.window.document;
  global.Element = dom.window.Element;

  panelRenderer.renderConversationPanel({
    nodes: [
      {
        id: "A",
        author_id: "u1",
        author: "@u1",
        text: "first substantive reply",
        reply_to: "R",
        author_profile: {
          username: "u1",
          name: "U1",
          description: "",
          profile_image_url: "https://pbs.twimg.com/profile_images/u1_normal.jpg"
        }
      },
      {
        id: "B",
        author_id: "u1",
        author: "@u1",
        text: "second substantive reply",
        quote_of: "R",
        author_profile: {
          username: "u1",
          name: "U1",
          description: "",
          profile_image_url: "https://pbs.twimg.com/profile_images/u1_normal.jpg"
        }
      }
    ],
    scoreById: new Map([["A", 0.9], ["B", 0.8]]),
    relationshipById: new Map([["A", "reply"], ["B", "quote"]]),
    followingSet: new Set(),
    root: dom.window.document
  });

  const peopleTab = [...dom.window.document.querySelectorAll("button")].find((button) => button.textContent.trim() === "People");
  assert.ok(peopleTab);
  peopleTab.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));

  const peopleCard = [...dom.window.document.querySelectorAll(".ariadex-people-card")].find((node) => /selected tweets considered/.test(node.textContent));
  assert.ok(peopleCard);
  assert.match(peopleCard.textContent, /@u1/);
  assert.match(peopleCard.textContent, /2 selected tweets considered/);

  const avatar = peopleCard.querySelector("img.ariadex-avatar");
  assert.ok(avatar);
  assert.match(avatar.src, /profile_images\/u1_normal\.jpg/);
});

test("panel renderer excludes canonical root and clicked tweet ids when requested", () => {
  const nodes = [
    { id: "ROOT", author_id: "u_root", author: "@root", text: "root tweet", author_profile: { username: "root", name: "Root", description: "" } },
    { id: "CLICKED", author_id: "u_clicked", author: "@clicked", text: "clicked quote", quote_of: "ROOT", author_profile: { username: "clicked", name: "Clicked", description: "" } },
    { id: "A", author_id: "u1", author: "@u1", text: "A", reply_to: "ROOT", author_profile: { username: "u1", name: "U1", description: "" } },
    { id: "B", author_id: "u2", author: "@u2", text: "B", quote_of: "ROOT", author_profile: { username: "u2", name: "U2", description: "" } }
  ];

  const scoreById = new Map([
    ["ROOT", 0.99],
    ["CLICKED", 0.95],
    ["A", 0.9],
    ["B", 0.8]
  ]);

  const sections = panelRenderer.buildPanelSections({
    nodes,
    scoreById,
    followingSet: new Set(),
    excludedTweetIds: new Set(["ROOT", "CLICKED"]),
    networkLimit: 5,
    topLimit: 10
  });

  assert.deepEqual(sections.topThinkers.map((entry) => entry.id), ["A", "B"]);
});

test("panel renderer opens tweet in new tab when tweet is not present in DOM", () => {
  const dom = new JSDOM("<body></body>", { url: "https://x.com/home" });
  global.window = dom.window;
  global.document = dom.window.document;
  global.Element = dom.window.Element;

  let openedUrl = null;
  dom.window.open = (url) => {
    openedUrl = url;
    return null;
  };

  panelRenderer.renderConversationPanel({
    nodes: [{ id: "A", author_id: "u1", author: "@u1", text: "hello", url: "https://x.com/u1/status/1", reply_to: "R", author_profile: { username: "u1", name: "U1", description: "" } }],
    scoreById: new Map([["A", 1]]),
    relationshipById: new Map([["A", "reply"]]),
    followingSet: new Set(["u1"]),
    root: dom.window.document
  });

  const card = dom.window.document.querySelector(".ariadex-thread:not(.ariadex-empty)");
  card.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));

  assert.equal(openedUrl, "https://x.com/u1/status/1");
});

test("panel renderer excludes likely bot accounts when humanOnly is enabled", () => {
  const nodes = [
    {
      id: "human-1",
      author_id: "u1",
      author: "@alice",
      text: "human tweet",
      reply_to: "root",
      author_profile: { username: "alice", name: "Alice", description: "researcher" }
    },
    {
      id: "bot-1",
      author_id: "u2",
      author: "@newsbot",
      text: "automated update",
      author_profile: { username: "newsbot", name: "News Bot", description: "automated bot feed" }
    }
  ];

  const sections = panelRenderer.buildPanelSections({
    nodes,
    scoreById: new Map([["human-1", 0.9], ["bot-1", 0.95]]),
    followingSet: new Set(),
    humanOnly: true,
    topLimit: 10
  });

  assert.deepEqual(sections.topThinkers.map((entry) => entry.id), ["human-1"]);
});

test("panel renderer keeps tweets without author_profile when humanOnly is enabled", () => {
  const sections = panelRenderer.buildPanelSections({
    nodes: [
      {
        id: "reply-1",
        author_id: "u1",
        author: "@alice",
        text: "reply",
        reply_to: "root"
      }
    ],
    scoreById: new Map([["reply-1", 0.9]]),
    followingSet: new Set(),
    humanOnly: true,
    topLimit: 10
  });

  assert.deepEqual(sections.topThinkers.map((entry) => entry.id), ["reply-1"]);
});

test("panel renderer includes only replies/quotes in ranked output", () => {
  const nodes = [
    {
      id: "reply-1",
      author_id: "u1",
      author: "@alice",
      text: "reply",
      reply_to: "root",
      author_profile: { username: "alice", name: "Alice", description: "human" }
    },
    {
      id: "quote-1",
      author_id: "u2",
      author: "@bob",
      text: "quote",
      quote_of: "root",
      author_profile: { username: "bob", name: "Bob", description: "human" }
    },
    {
      id: "repost-1",
      author_id: "u3",
      author: "@carol",
      text: "repost",
      repost_of: "root",
      referenced_tweets: [{ type: "retweeted", id: "root" }],
      author_profile: { username: "carol", name: "Carol", description: "human" }
    },
    {
      id: "plain-1",
      author_id: "u4",
      author: "@dave",
      text: "plain",
      author_profile: { username: "dave", name: "Dave", description: "human" }
    }
  ];

  const sections = panelRenderer.buildPanelSections({
    nodes,
    scoreById: new Map([
      ["reply-1", 0.7],
      ["quote-1", 0.9],
      ["repost-1", 0.99],
      ["plain-1", 0.95]
    ]),
    followingSet: new Set(),
    humanOnly: true,
    topLimit: 10
  });

  assert.deepEqual(sections.topThinkers.map((entry) => entry.id), ["quote-1", "reply-1"]);
});

test("panel renderer canonicalizes and deduplicates evidence URLs in dex view model", () => {
  const nodes = [
    {
      id: "t1",
      author_id: "u1",
      author: "@alice",
      text: "paper https://example.com/a?utm_source=x and dup https://example.com/a#section",
      quote_of: "root",
      author_profile: { username: "alice", name: "Alice", description: "human" }
    },
    {
      id: "t2",
      author_id: "u2",
      author: "@bob",
      text: "same link https://example.com/a?s=20",
      reply_to: "root",
      author_profile: { username: "bob", name: "Bob", description: "human" }
    }
  ];

  const scoreById = new Map([
    ["t1", 0.9],
    ["t2", 0.8]
  ]);

  const viewModel = panelRenderer.buildDexViewModel({
    nodes,
    scoreById,
    followingSet: new Set(),
    networkLimit: 5,
    topLimit: 10
  });

  assert.equal(Array.isArray(viewModel.evidence), true);
  assert.equal(viewModel.evidence.length, 1);
  assert.equal(viewModel.evidence[0].canonicalUrl, "https://example.com/a");
  assert.deepEqual(viewModel.evidence[0].citedByTweetIds, ["t1", "t2"]);
});

test("panel renderer excludes t.co and x status urls from references", () => {
  const viewModel = panelRenderer.buildDexViewModel({
    nodes: [
      {
        id: "t1",
        author_id: "u1",
        author: "@alice",
        text: "tweet link https://x.com/a/status/1 short https://t.co/abc doc https://example.com/report",
        quote_of: "root",
        author_profile: { username: "alice", name: "Alice", description: "human" }
      }
    ],
    scoreById: new Map([["t1", 1]]),
    followingSet: new Set(),
    networkLimit: 5,
    topLimit: 10
  });

  assert.deepEqual(viewModel.evidence.map((entry) => entry.canonicalUrl), ["https://example.com/report"]);
});

test("panel renderer canonicalizes youtube shortlinks and arxiv pdf links", () => {
  assert.equal(
    panelRenderer.canonicalizeUrl("https://youtu.be/abc123?si=tracking"),
    "https://www.youtube.com/watch?v=abc123"
  );
  assert.equal(
    panelRenderer.canonicalizeUrl("https://arxiv.org/pdf/1234.5678.pdf?utm_source=x"),
    "https://arxiv.org/abs/1234.5678"
  );
});

test("panel renderer renders tabs and allows evidence tab switch", () => {
  const dom = new JSDOM("<body></body>", { url: "https://x.com/home" });
  global.window = dom.window;
  global.document = dom.window.document;
  global.Element = dom.window.Element;

  panelRenderer.renderConversationPanel({
    nodes: [
      {
        id: "A",
        author_id: "u1",
        author: "@u1",
        text: "look https://example.com/doc",
        quote_of: "R",
        author_profile: { username: "u1", name: "U1", description: "" }
      }
    ],
    scoreById: new Map([["A", 1]]),
    relationshipById: new Map([["A", "quote"]]),
    followingSet: new Set(["u1"]),
    root: dom.window.document
  });

  const tabs = dom.window.document.querySelectorAll(".ariadex-tab-button");
  assert.equal(tabs.length, 6);
  assert.match(dom.window.document.body.textContent, /From your network/);

  const evidenceTab = [...tabs].find((tab) => tab.textContent === "References");
  assert.ok(evidenceTab);
  evidenceTab.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));

  assert.match(dom.window.document.body.textContent, /example\.com\/doc/);
});

test("panel renderer renders log tab with structured snapshot summary", () => {
  const dom = new JSDOM("<body></body>", { url: "https://x.com/home" });
  global.window = dom.window;
  global.document = dom.window.document;
  global.Element = dom.window.Element;

  panelRenderer.renderConversationPanel({
    nodes: [
      {
        id: "ROOT",
        author_id: "u1",
        author: "@root",
        text: "root",
        author_profile: { username: "root", name: "Root", description: "" }
      },
      {
        id: "A",
        author_id: "u2",
        author: "@u2",
        text: "reply with https://example.com/doc",
        reply_to: "ROOT",
        author_profile: { username: "u2", name: "U2", description: "" }
      }
    ],
    scoreById: new Map([["A", 1]]),
    relationshipById: new Map([["A", "reply"]]),
    followingSet: new Set(),
    snapshotMeta: {
      clickedTweetId: "A",
      canonicalRootId: "ROOT",
      diagnostics: {
        filter: { inputTweetCount: 12 },
        ranking: { rankingCount: 4 }
      },
      pathAnchored: {
        mandatoryPathIds: ["ROOT", "A"],
        expansions: [{ depth: 1, tweets: [{ id: "A" }] }],
        references: [{ canonicalUrl: "https://example.com/doc" }],
        diagnostics: {
          selectedTweetCount: 2,
          mandatoryPathLength: 2,
          referenceCount: 1
        },
        artifact: {
          exploredTweetId: "A",
          expansions: [{ depth: 1, tweets: [{ id: "A" }] }]
        }
      },
      cache: { hit: true },
      warnings: ["warn1", "warn2"]
    },
    root: dom.window.document
  });

  const tabs = [...dom.window.document.querySelectorAll(".ariadex-tab-button")];
  const logTab = tabs.find((tab) => tab.textContent === "Log");
  assert.ok(logTab);
  logTab.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));

  const text = dom.window.document.body.textContent;
  assert.match(text, /Cache/);
  assert.match(text, /hit/);
  assert.match(text, /Collected tweets/);
  assert.match(text, /12/);
  assert.match(text, /Ancestor path/);
  assert.match(text, /References/);
  assert.match(text, /Warnings/);
});

test("panel renderer renders digest tab and triggers PDF action", () => {
  const dom = new JSDOM("<body></body>", { url: "https://x.com/home" });
  global.window = dom.window;
  global.document = dom.window.document;
  global.Element = dom.window.Element;
  let downloadCalls = 0;

  panelRenderer.renderConversationPanel({
    nodes: [
      {
        id: "A",
        author_id: "u1",
        author: "@u1",
        text: "look https://example.com/doc",
        author_profile: { username: "u1", name: "U1", description: "" }
      }
    ],
    scoreById: new Map([["A", 1]]),
    relationshipById: new Map(),
    followingSet: new Set(),
    article: {
      title: "Digest",
      dek: "Dek",
      summary: "Summary",
      sections: [{ heading: "Section", body: "Body" }]
    },
    onDownloadPdf: () => {
      downloadCalls += 1;
    },
    root: dom.window.document
  });

  const digestTab = [...dom.window.document.querySelectorAll(".ariadex-tab-button")]
    .find((tab) => tab.textContent === "Digest");
  assert.ok(digestTab);
  digestTab.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));

  const downloadButton = [...dom.window.document.querySelectorAll("button")]
    .find((button) => button.textContent === "Download PDF");
  assert.ok(downloadButton);
  downloadButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  assert.equal(downloadCalls, 1);
});

test("panel renderer renders standard digest structure from artifact with distinct quote blocks", () => {
  const dom = new JSDOM("<body></body>", { url: "https://x.com/home" });
  global.window = dom.window;
  global.document = dom.window.document;
  global.Element = dom.window.Element;

  panelRenderer.renderConversationPanel({
    nodes: [
      {
        id: "ROOT",
        author_id: "u1",
        author: "@root",
        text: "Root text",
        author_profile: { username: "root", name: "Root", description: "" }
      },
      {
        id: "SEED",
        author_id: "u2",
        author: "@seed",
        text: "Explored text",
        quote_of: "ROOT",
        author_profile: { username: "seed", name: "Seed", description: "" }
      }
    ],
    scoreById: new Map([["SEED", 1]]),
    relationshipById: new Map([["SEED", "quote"]]),
    followingSet: new Set(),
    article: {
      title: "Digest",
      dek: "Dek",
      summary: "Summary",
      references: [
        {
          canonicalUrl: "https://example.com/doc",
          displayUrl: "https://example.com/doc",
          domain: "example.com",
          citationCount: 1
        }
      ],
      input: {
        artifact: {
          exploredTweetId: "SEED",
          rootTweet: {
            id: "ROOT",
            author: "@root",
            text: "Root text"
          },
          mandatoryPath: [
            { id: "ROOT", author: "@root", text: "Root text" },
            { id: "SEED", author: "@seed", text: "Explored text", quoteOf: "ROOT" }
          ],
          expansions: [
            {
              depth: 1,
              tweets: [
                {
                  id: "R1",
                  author: "@reply",
                  text: "Important reply",
                  relationType: "reply"
                }
              ]
            }
          ],
          selectedTweets: []
        }
      },
      sections: []
    },
    root: dom.window.document
  });

  const digestTab = [...dom.window.document.querySelectorAll(".ariadex-tab-button")]
    .find((tab) => tab.textContent === "Digest");
  assert.ok(digestTab);
  digestTab.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));

  const text = dom.window.document.body.textContent;
  assert.match(text, /Original tweet/);
  assert.match(text, /Why this appeared/);
  assert.match(text, /Ancestor path/);
  assert.match(text, /Important replies and branches/);
  assert.match(text, /Evidence/);
  assert.equal(dom.window.document.querySelectorAll(".ariadex-digest-quote").length >= 3, true);
});
