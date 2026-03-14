const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createOpenAiContributionClassifier,
  parseOpenAiContent
} = require("../server/openai_contribution_filter.js");

test("parseOpenAiContent parses strict JSON content", () => {
  const parsed = parseOpenAiContent("{\"labels\":[{\"id\":\"1\",\"contribution_score\":0.91,\"contributing\":true,\"reason\":\"adds evidence\"},{\"id\":\"2\",\"contribution_score\":0.12,\"contributing\":false,\"reason\":\"vague reaction\"}]}", { threshold: 0.65 });
  assert.ok(parsed);
  assert.equal(parsed.byTweetId["1"], true);
  assert.equal(parsed.byTweetId["2"], false);
  assert.equal(parsed.scoreByTweetId["1"], 0.91);
  assert.equal(parsed.scoreByTweetId["2"], 0.12);
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
        contribution_score: index % 2 === 0 ? 0.8 : 0.3,
        contributing: index % 2 === 0,
        reason: index % 2 === 0 ? "has argument" : "low effort"
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
    { id: "t1", text: "Substantive point with concrete evidence and an explicit claim." },
    { id: "t2", text: "lol" },
    { id: "t3", text: "Counterargument that explains why the premise is incomplete." }
  ], {
    requestId: "req-1",
    canonicalRootId: "root-1",
    alwaysIncludeIds: new Set(["root-1"])
  });

  assert.equal(classifier.enabled, true);
  assert.equal(seenBodies.length, 1);
  assert.equal(result.candidateCount, 2);
  assert.equal(result.heuristicRejectedCount, 1);
  assert.equal(result.classifiedCount, 2);
  assert.equal(Object.keys(result.byTweetId).length, 3);
  assert.equal(result.byTweetId.t2, false);
  assert.equal(result.scoreByTweetId.t2, 0);
});
