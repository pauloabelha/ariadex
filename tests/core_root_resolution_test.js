const test = require("node:test");
const assert = require("node:assert/strict");
const rootResolution = require("../core/root_resolution.js");

function tweet(id, refs = []) {
  return {
    id,
    referenced_tweets: refs
  };
}

test("resolveCanonicalRootId prioritizes quoted tweet", () => {
  const tweetById = new Map([
    ["300", tweet("300", [{ type: "quoted", id: "100" }, { type: "replied_to", id: "200" }])],
    ["200", tweet("200", [{ type: "replied_to", id: "100" }])],
    ["100", tweet("100")]
  ]);

  const resolved = rootResolution.resolveCanonicalRootId({
    clickedTweetId: "300",
    tweetById
  });

  assert.equal(resolved, "100");
});

test("resolveCanonicalRootId climbs reply chain to origin", () => {
  const tweetById = new Map([
    ["30", tweet("30", [{ type: "replied_to", id: "20" }])],
    ["20", tweet("20", [{ type: "replied_to", id: "10" }])],
    ["10", tweet("10")]
  ]);

  const resolved = rootResolution.resolveCanonicalRootId({
    clickedTweetId: "30",
    tweetById
  });

  assert.equal(resolved, "10");
});
