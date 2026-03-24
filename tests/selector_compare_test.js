const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { compareSelectors } = require("../scripts/compare_selectors.js");
const { runSelector } = require("../scripts/run_selector.js");

test("runSelector writes selector output for a fixture", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ariadex-selector-run-"));
  const fixturePath = path.join(tempDir, "fixture.json");
  await fs.writeFile(fixturePath, `${JSON.stringify({
    fixtureType: "full_conversation_graph",
    conversation: {
      clickedTweetId: "seed",
      canonicalRootId: "root",
      rootTweet: { id: "root", text: "Root tweet" },
      tweets: [
        { id: "root", text: "Root tweet", author: "@root", author_profile: { public_metrics: { followers_count: 10 } } },
        { id: "seed", text: "Seed tweet", author: "@seed", reply_to: "root", likes: 10, author_profile: { public_metrics: { followers_count: 10 } } }
      ],
      users: [],
      warnings: []
    }
  }, null, 2)}\n`, "utf8");

  const result = await runSelector([
    "--fixture", fixturePath,
    "--tweet", "seed",
    "--output-dir", tempDir
  ]);

  assert.equal(result.exitCode, 0);
  const written = JSON.parse(await fs.readFile(result.outputPath, "utf8"));
  assert.equal(written.selection.algorithmId, "path_anchored_v1");
  assert.equal(written.artifact.exploredTweetId, "seed");
});

test("compareSelectors writes json and html reports", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ariadex-selector-compare-"));
  const fixturePath = path.join(tempDir, "fixture.json");
  await fs.writeFile(fixturePath, `${JSON.stringify({
    fixtureType: "full_conversation_graph",
    conversation: {
      clickedTweetId: "seed",
      canonicalRootId: "root",
      rootTweet: { id: "root", text: "Root tweet" },
      tweets: [
        { id: "root", text: "Root tweet with enough substance.", author: "@root", author_profile: { public_metrics: { followers_count: 10 } } },
        { id: "seed", text: "Seed tweet with enough substance.", author: "@seed", quote_of: "root", likes: 20, quote_count: 3, author_profile: { public_metrics: { followers_count: 30 } } },
        { id: "child", text: "Child reply with enough substance to be included.", author: "@child", reply_to: "seed", likes: 5, author_profile: { public_metrics: { followers_count: 5 } } }
      ],
      users: [],
      warnings: []
    }
  }, null, 2)}\n`, "utf8");

  const result = await compareSelectors([
    "--fixture", fixturePath,
    "--tweet", "seed",
    "--algo-a", "path_anchored_v1",
    "--algo-b", "expand_all_v0",
    "--output-dir", tempDir
  ]);

  assert.equal(result.exitCode, 0);
  const html = await fs.readFile(result.htmlPath, "utf8");
  const json = JSON.parse(await fs.readFile(result.jsonPath, "utf8"));
  assert.match(html, /Selector Comparison/);
  assert.equal(json.left.algorithmId, "path_anchored_v1");
  assert.equal(json.right.algorithmId, "expand_all_v0");
});
