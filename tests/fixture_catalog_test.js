const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const {
  loadCatalog,
  summarizeFixtureDocument,
  syncCatalogFromFixtures,
  upsertFixtureRecord
} = require("../research/fixture_catalog.js");

test("summarizeFixtureDocument extracts explored tweet metadata", () => {
  const summary = summarizeFixtureDocument({
    fixtureType: "full_conversation_graph",
    capturedAt: "2026-03-24T00:00:00.000Z",
    conversation: {
      clickedTweetId: "seed",
      canonicalRootId: "root",
      rootTweet: { id: "root", text: "Root text" },
      tweets: [
        { id: "root", text: "Root text" },
        { id: "seed", text: "Explored text" }
      ],
      users: [{ id: "u1" }],
      warnings: []
    }
  }, "/tmp/demo.json");

  assert.equal(summary.exploredTweetId, "seed");
  assert.equal(summary.canonicalRootId, "root");
  assert.equal(summary.fixturePath, "/tmp/demo.json");
  assert.equal(summary.exploredTextPreview, "Explored text");
});

test("upsertFixtureRecord and loadCatalog persist fixture summaries", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ariadex-catalog-"));
  const catalogPath = path.join(tempDir, "catalog.json");
  const fixturePath = path.join(tempDir, "fixture.json");
  const fixtureDocument = {
    fixtureType: "full_conversation_graph",
    capturedAt: "2026-03-24T01:00:00.000Z",
    conversation: {
      clickedTweetId: "seed",
      canonicalRootId: "root",
      rootTweet: { id: "root", text: "Root text" },
      tweets: [{ id: "root", text: "Root text" }, { id: "seed", text: "Explored text" }],
      users: [],
      warnings: []
    }
  };

  await upsertFixtureRecord({
    catalogPath,
    fixtureDocument,
    fixturePath
  });

  const catalog = await loadCatalog(catalogPath);
  assert.equal(catalog.fixtures.length, 1);
  assert.equal(catalog.fixtures[0].exploredTweetId, "seed");
});

test("syncCatalogFromFixtures scans fixture directory", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ariadex-catalog-sync-"));
  const fixtureDir = path.join(tempDir, "fixtures");
  const catalogPath = path.join(tempDir, "catalog.json");
  await fs.mkdir(fixtureDir, { recursive: true });
  await fs.writeFile(path.join(fixtureDir, "fixture.json"), `${JSON.stringify({
    fixtureType: "full_conversation_graph",
    capturedAt: "2026-03-24T02:00:00.000Z",
    conversation: {
      clickedTweetId: "seed",
      canonicalRootId: "root",
      rootTweet: { id: "root", text: "Root text" },
      tweets: [{ id: "root", text: "Root text" }, { id: "seed", text: "Explored text" }],
      users: [],
      warnings: []
    }
  }, null, 2)}\n`, "utf8");

  const catalog = await syncCatalogFromFixtures({
    fixtureDir,
    catalogPath
  });

  assert.equal(catalog.fixtures.length, 1);
  assert.equal(catalog.fixtures[0].exploredTweetId, "seed");
});
