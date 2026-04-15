const test = require("node:test");
const assert = require("node:assert/strict");

const content = require("../extension/content.js");

test("baseLabelForIndex names root explored and ancestors", () => {
  assert.equal(content.baseLabelForIndex({ id: "1" }, 0, "3"), "Root");
  assert.equal(content.baseLabelForIndex({ id: "3" }, 3, "3"), "Explored");
  assert.equal(content.baseLabelForIndex({ id: "2" }, 2, "3"), "Ancestor 2");
});

test("relationLabel formats quote and reply against parent labels", () => {
  const clickedId = "30";
  assert.equal(
    content.relationLabel({ id: "30", outboundRelation: "quote" }, { id: "20" }, 2, clickedId),
    "quoted Ancestor 2"
  );
  assert.equal(
    content.relationLabel({ id: "20", outboundRelation: "reply" }, { id: "10" }, 1, clickedId),
    "replied to Ancestor 1"
  );
  assert.equal(
    content.relationLabel({ id: "10", outboundRelation: "reply" }, { id: "1" }, 0, clickedId),
    "replied to Root"
  );
});

test("buildPathEntries creates stable readable titles", () => {
  const entries = content.buildPathEntries([
    { id: "10", outboundRelation: "", referenceNumbers: [] },
    { id: "20", outboundRelation: "reply", referenceNumbers: [1] },
    { id: "30", outboundRelation: "quote", referenceNumbers: [1, 2] }
  ], "30");

  assert.deepEqual(entries.map((entry) => entry.title), [
    "Root",
    "Ancestor 1 (replied to Root)",
    "Explored (quoted Ancestor 1)"
  ]);
});

test("buildReferenceBadgeText formats reference markers", () => {
  assert.equal(content.buildReferenceBadgeText([]), "");
  assert.equal(content.buildReferenceBadgeText([1]), "[1]");
  assert.equal(content.buildReferenceBadgeText([1, 3]), "[1] [3]");
});

test("formatProgressMessage writes compact path and reference progress", () => {
  assert.equal(
    content.formatProgressMessage({ phase: "start", clickedTweetId: "30" }),
    "Tracing the root path from the explored tweet..."
  );
  assert.equal(
    content.formatProgressMessage({ phase: "path_walk", ancestorCount: 0, nextRelationType: "quote" }),
    "Found the explored tweet. Following its quote parent..."
  );
  assert.equal(
    content.formatProgressMessage({ phase: "path_walk", ancestorCount: 4, nextRelationType: "reply" }),
    "Tracing the root path... 4 ancestors found so far. Next hop is a reply."
  );
  assert.equal(
    content.formatProgressMessage({ phase: "canonicalizing_refs", tweetCount: 7 }),
    "Root path complete. Canonicalizing references across 7 tweets..."
  );
  assert.equal(
    content.formatProgressMessage({ phase: "done", tweetCount: 7, referenceCount: 2 }),
    "Done. Resolved 7 path tweets and 2 references."
  );
});

test("normalizeText trims and collapses whitespace", () => {
  assert.equal(content.normalizeText(" a \n  b   c "), "a b c");
});

test("resolveRootArtifact sends the expected extension message", async () => {
  const chromeStub = {
    runtime: {
      lastError: null,
      sendMessage(message, callback) {
        callback({
          ok: true,
          artifact: { path: [{ id: "1" }, { id: "2" }], references: [{ number: 1 }] }
        });
        chromeStub.sent = message;
      }
    }
  };

  const artifact = await content.resolveRootArtifact("2", chromeStub);
  assert.deepEqual(artifact, {
    path: [{ id: "1" }, { id: "2" }],
    references: [{ number: 1 }]
  });
  assert.deepEqual(chromeStub.sent, {
    type: content.MESSAGE_TYPE,
    tweetId: "2"
  });
});

test("resolveRootArtifact rejects extension errors", async () => {
  const chromeStub = {
    runtime: {
      lastError: null,
      sendMessage(_message, callback) {
        callback({ ok: false, error: "boom" });
      }
    }
  };

  await assert.rejects(() => content.resolveRootArtifact("2", chromeStub), /boom/);
});

test("clearTweetCache sends the expected extension message", async () => {
  const chromeStub = {
    runtime: {
      lastError: null,
      sendMessage(message, callback) {
        callback({ ok: true, cleared: true });
        chromeStub.sent = message;
      }
    }
  };

  await content.clearTweetCache(chromeStub);
  assert.deepEqual(chromeStub.sent, {
    type: content.CLEAR_CACHE_MESSAGE_TYPE
  });
});
