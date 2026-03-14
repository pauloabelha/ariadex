const test = require("node:test");
const assert = require("node:assert/strict");

const benchmark = require("../scripts/benchmark_snapshot_pipeline.js");

test("runBenchmark returns cold+warm summary with cache hit on warm run", async () => {
  const summary = await benchmark.runBenchmark({
    replyCount: 20,
    quoteCount: 4,
    quoteReplyCount: 1,
    latencyMs: 0
  });

  assert.equal(typeof summary, "object");
  assert.equal(summary.cold.cacheHit, false);
  assert.equal(summary.warm.cacheHit, true);
  assert.equal(summary.cold.nodeCount > 0, true);
  assert.equal(summary.warm.nodeCount > 0, true);
  assert.equal(summary.cold.requestCountTotal >= summary.warm.requestCountTotal, true);
  assert.equal(summary.cold.requestCounts.search_recent_conversation > 0, true);
});

test("synthetic fetch tracks per-endpoint counters", async () => {
  const dataset = benchmark.buildSyntheticConversation({
    rootId: "1000",
    replyCount: 2,
    quoteCount: 1,
    quoteReplyCount: 0
  });
  const synthetic = benchmark.createSyntheticFetch({
    dataset,
    latencyMs: 0
  });

  await synthetic.fetchImpl("https://api.x.com/2/tweets/1000");
  await synthetic.fetchImpl("https://api.x.com/2/tweets/search/recent?query=conversation_id:1000");
  await synthetic.fetchImpl("https://api.x.com/2/tweets/1000/quote_tweets");

  const counters = synthetic.snapshotCounters();
  assert.equal(counters.tweet_lookup, 1);
  assert.equal(counters.search_recent_conversation, 1);
  assert.equal(counters.quote_tweets, 1);
});

