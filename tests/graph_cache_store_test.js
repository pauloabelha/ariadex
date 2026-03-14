const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { PersistentFileCacheStore } = require("../server/graph_cache_server.js");

function createTempCachePath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ariadex-cache-"));
  return path.join(dir, "graph_cache_store.json");
}

test("PersistentFileCacheStore persists entries across instances", () => {
  const filePath = createTempCachePath();

  const first = new PersistentFileCacheStore({ filePath, maxEntries: 100 });
  first.set("k1", { dataset: { canonicalRootId: "1", tweets: [] } }, 60_000);
  first.flushToDisk();

  const second = new PersistentFileCacheStore({ filePath, maxEntries: 100 });
  const loaded = second.get("k1");

  assert.ok(loaded);
  assert.equal(loaded.value.dataset.canonicalRootId, "1");
});

test("PersistentFileCacheStore drops expired entries on reload", async () => {
  const filePath = createTempCachePath();

  const first = new PersistentFileCacheStore({ filePath, maxEntries: 100 });
  first.set("expired", { dataset: { canonicalRootId: "x", tweets: [] } }, 1);
  first.flushToDisk();

  await new Promise((resolve) => setTimeout(resolve, 1100));

  const second = new PersistentFileCacheStore({ filePath, maxEntries: 100 });
  const loaded = second.get("expired");

  assert.equal(loaded, null);
});
