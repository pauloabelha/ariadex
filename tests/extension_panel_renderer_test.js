const test = require("node:test");
const assert = require("node:assert/strict");

const panelRenderer = require("../extension/panel_renderer.js");

test("extension panel renderer always includes explored and ancestor-path authors in people", () => {
  const viewModel = panelRenderer.buildDexViewModel({
    nodes: [
      {
        id: "ROOT",
        author_id: "u_root",
        author: "@LeRobotHF",
        text: "root post",
        author_profile: { username: "LeRobotHF", name: "LeRobot", description: "robotics" }
      },
      {
        id: "CLICKED",
        author_id: "u_clicked",
        author: "@pepijn2233",
        text: "explored quote",
        quote_of: "ROOT",
        author_profile: { username: "pepijn2233", name: "Pepijn", description: "robotics" }
      },
      {
        id: "A",
        author_id: "u_a",
        author: "@Thom_Wolf",
        text: "branch reply",
        reply_to: "ROOT",
        author_profile: { username: "Thom_Wolf", name: "Thom Wolf", description: "robotics" }
      }
    ],
    scoreById: new Map([
      ["ROOT", 0.99],
      ["CLICKED", 0.95],
      ["A", 0.9]
    ]),
    followingSet: new Set(),
    excludedTweetIds: new Set(["ROOT", "CLICKED"]),
    networkLimit: 5,
    topLimit: 10,
    snapshotMeta: {
      pathAnchored: {
        mandatoryPathIds: ["ROOT", "CLICKED"]
      }
    }
  });

  const authors = [...viewModel.people.followed, ...viewModel.people.others].map((entry) => entry.author);
  assert.deepEqual(authors, ["@LeRobotHF", "@pepijn2233", "@Thom_Wolf"]);
});

test("extension panel renderer includes X articles from external_urls in references", () => {
  const viewModel = panelRenderer.buildDexViewModel({
    nodes: [
      {
        id: "root",
        author_id: "u1",
        author: "@LeRobotHF",
        text: "root post",
        external_urls: ["https://x.com/i/article/2041371538482761728"],
        author_profile: { username: "LeRobotHF", name: "LeRobot", description: "robotics" }
      }
    ],
    scoreById: new Map([["root", 1]]),
    followingSet: new Set(),
    networkLimit: 5,
    topLimit: 10
  });

  assert.deepEqual(viewModel.evidence.map((entry) => entry.canonicalUrl), [
    "https://x.com/i/article/2041371538482761728"
  ]);
});

test("extension panel renderer falls back to artifact mandatoryPath and clicked/root ids for people", () => {
  const viewModel = panelRenderer.buildDexViewModel({
    nodes: [
      {
        id: "ROOT",
        author_id: "u_root",
        author: "@LeRobotHF",
        text: "root post",
        author_profile: { username: "LeRobotHF", name: "LeRobot", description: "robotics" }
      },
      {
        id: "CLICKED",
        author_id: "u_clicked",
        author: "@pepijn2233",
        text: "explored quote",
        quote_of: "ROOT",
        author_profile: { username: "pepijn2233", name: "Pepijn", description: "robotics" }
      },
      {
        id: "A",
        author_id: "u_a",
        author: "@Thom_Wolf",
        text: "branch reply",
        reply_to: "ROOT",
        author_profile: { username: "Thom_Wolf", name: "Thom Wolf", description: "robotics" }
      }
    ],
    scoreById: new Map([
      ["ROOT", 0.99],
      ["CLICKED", 0.95],
      ["A", 0.9]
    ]),
    followingSet: new Set(),
    excludedTweetIds: new Set(["ROOT", "CLICKED"]),
    networkLimit: 5,
    topLimit: 10,
    snapshotMeta: {
      clickedTweetId: "CLICKED",
      canonicalRootId: "ROOT",
      pathAnchored: {
        artifact: {
          exploredTweetId: "CLICKED",
          mandatoryPath: [
            { id: "ROOT" },
            { id: "CLICKED" }
          ]
        }
      }
    }
  });

  const authors = [...viewModel.people.followed, ...viewModel.people.others].map((entry) => entry.author);
  assert.deepEqual(authors, ["@LeRobotHF", "@pepijn2233", "@Thom_Wolf"]);
});

test("extension panel renderer can build people cards from artifact mandatoryPath even when nodes omit root and clicked tweets", () => {
  const viewModel = panelRenderer.buildDexViewModel({
    nodes: [
      {
        id: "A",
        author_id: "u_a",
        author: "@Thom_Wolf",
        text: "branch reply",
        reply_to: "ROOT",
        author_profile: { username: "Thom_Wolf", name: "Thom Wolf", description: "robotics" }
      }
    ],
    scoreById: new Map([
      ["A", 0.9]
    ]),
    followingSet: new Set(),
    excludedTweetIds: new Set(["ROOT", "CLICKED"]),
    networkLimit: 5,
    topLimit: 10,
    snapshotMeta: {
      clickedTweetId: "CLICKED",
      canonicalRootId: "ROOT",
      pathAnchored: {
        artifact: {
          exploredTweetId: "CLICKED",
          rootTweet: { id: "ROOT", author: "@LeRobotHF", text: "root post" },
          mandatoryPath: [
            { id: "ROOT", author: "@LeRobotHF", text: "root post" },
            { id: "CLICKED", author: "@pepijn2233", text: "explored quote", quoteOf: "ROOT" }
          ]
        }
      }
    }
  });

  const authors = [...viewModel.people.followed, ...viewModel.people.others].map((entry) => entry.author);
  assert.deepEqual(authors, ["@Thom_Wolf", "@LeRobotHF", "@pepijn2233"]);
});
