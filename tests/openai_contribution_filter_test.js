const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createOpenAiContributionClassifier,
  parseOpenAiContent
} = require("../server/openai_contribution_filter.js");

test("parseOpenAiContent parses strict JSON content", () => {
  const parsed = parseOpenAiContent("{\"labels\":[{\"id\":\"1\",\"contributing\":true},{\"id\":\"2\",\"contributing\":false}]}");
  assert.ok(parsed);
  assert.equal(parsed.byTweetId["1"], true);
  assert.equal(parsed.byTweetId["2"], false);
  assert.equal(parsed.contributingCount, 1);
  assert.equal(parsed.nonContributingCount, 1);
});

test("createOpenAiContributionClassifier classifies tweets in batches", async () => {
  const seenBodies = [];
  const classifier = createOpenAiContributionClassifier({
    apiKey: "test-key",
    model: "gpt-4o-mini",
    batchSize: 2,
    maxTweetsPerSnapshot: 10,
    fetchImpl: async (_url, options) => {
      const payload = JSON.parse(String(options.body));
      seenBodies.push(payload);
      const batch = JSON.parse(payload.messages[1].content).tweets;
      const labels = batch.map((tweet, index) => ({
        id: tweet.id,
        contributing: index % 2 === 0
      }));
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        async text() {
          return JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({ labels })
                }
              }
            ],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 5,
              total_tokens: 15
            }
          });
        }
      };
    }
  });

  const result = await classifier.classifyTweets([
    { id: "t1", text: "Substantive point" },
    { id: "t2", text: "lol" },
    { id: "t3", text: "Counterargument" }
  ], {
    requestId: "req-1",
    canonicalRootId: "root-1",
    alwaysIncludeIds: new Set(["root-1"])
  });

  assert.equal(classifier.enabled, true);
  assert.equal(seenBodies.length, 1);
  assert.equal(result.candidateCount, 3);
  assert.equal(result.classifiedCount, 3);
  assert.equal(Object.keys(result.byTweetId).length, 3);
});
