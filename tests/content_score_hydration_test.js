const test = require("node:test");
const assert = require("node:assert/strict");

const content = require("../extension/content.js");

test("resolveScoreByIdFromSnapshot prefers non-empty scoreByIdObject over empty scoreById", () => {
  const resolved = content.resolveScoreByIdFromSnapshot({
    rankingMeta: {
      scoreById: {},
      scoreByIdObject: {
        a: 0.55,
        b: 0.33
      }
    },
    ranking: []
  });

  assert.equal(typeof resolved, "object");
  assert.equal(resolved.a, 0.55);
  assert.equal(resolved.b, 0.33);
});

