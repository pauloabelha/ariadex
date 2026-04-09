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
  const seenHeaders = [];
  const classifier = createOpenAiContributionClassifier({
    endpointBase: "http://127.0.0.1:8080/v1",
    model: "google_gemma-4-E2B-it-Q4_K_M",
    batchSize: 2,
    maxTweetsPerSnapshot: 10,
    fetchImpl: async (_url, options) => {
      const payload = JSON.parse(String(options.body));
      seenBodies.push(payload);
      seenHeaders.push(options.headers);
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
  assert.equal(classifier.llmProvider, "local");
  assert.equal(seenBodies.length, 1);
  assert.equal(seenHeaders[0].Authorization, undefined);
  assert.equal(result.candidateCount, 2);
  assert.equal(result.heuristicRejectedCount, 1);
  assert.equal(result.classifiedCount, 2);
  assert.equal(result.llmProvider, "local");
  assert.equal(Object.keys(result.byTweetId).length, 3);
  assert.equal(result.byTweetId.t2, false);
  assert.equal(result.scoreByTweetId.t2, 0);
});

test("createOpenAiContributionClassifier dedupes identical text before OpenAI", async () => {
  let calls = 0;
  const classifier = createOpenAiContributionClassifier({
    apiKey: "test-key",
    model: "gpt-4o-mini",
    batchSize: 10,
    maxTweetsPerSnapshot: 10,
    fetchImpl: async (_url, options) => {
      calls += 1;
      const payload = JSON.parse(String(options.body));
      const batch = JSON.parse(payload.messages[1].content).tweets;
      const labels = batch.map((tweet) => ({
        id: tweet.id,
        contribution_score: 0.8,
        contributing: true
      }));
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        async text() {
          return JSON.stringify({
            choices: [{ message: { content: JSON.stringify({ labels }) } }],
            usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 }
          });
        }
      };
    }
  });

  const result = await classifier.classifyTweets([
    { id: "a", text: "Detailed critique with evidence and specifics." },
    { id: "b", text: "Detailed critique with evidence and specifics." }
  ]);

  assert.equal(calls, 1);
  assert.equal(result.dedupedCount, 1);
  assert.equal(result.byTweetId.a, true);
  assert.equal(result.byTweetId.b, true);
});
