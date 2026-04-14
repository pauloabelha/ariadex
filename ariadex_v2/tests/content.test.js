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
    { id: "10", outboundRelation: "" },
    { id: "20", outboundRelation: "reply" },
    { id: "30", outboundRelation: "quote" }
  ], "30");

  assert.deepEqual(entries.map((entry) => entry.title), [
    "Root",
    "Ancestor 1 (replied to Root)",
    "Explored (quoted Ancestor 1)"
  ]);
});

test("normalizeText trims and collapses whitespace", () => {
  assert.equal(content.normalizeText(" a \n  b   c "), "a b c");
});

test("resolveRootPath sends the expected extension message", async () => {
  const chromeStub = {
    runtime: {
      lastError: null,
      sendMessage(message, callback) {
        callback({
          ok: true,
          path: [{ id: "1" }, { id: "2" }]
        });
        chromeStub.sent = message;
      }
    }
  };

  const path = await content.resolveRootPath("2", chromeStub);
  assert.deepEqual(path, [{ id: "1" }, { id: "2" }]);
  assert.deepEqual(chromeStub.sent, {
    type: content.MESSAGE_TYPE,
    tweetId: "2"
  });
});

test("resolveRootPath rejects extension errors", async () => {
  const chromeStub = {
    runtime: {
      lastError: null,
      sendMessage(_message, callback) {
        callback({ ok: false, error: "boom" });
      }
    }
  };

  await assert.rejects(() => content.resolveRootPath("2", chromeStub), /boom/);
});
