const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const {
  createFixtureDocument,
  parseArgs,
  runCapture
} = require("../scripts/capture_full_graph.js");

test("parseArgs accepts expensive capture knobs", () => {
  const args = parseArgs([
    "--tweet", "123",
    "--root-hint", "100",
    "--following", "@alice,@bob",
    "--max-pages", "12",
    "--max-roots", "55",
    "--max-tweets", "6000",
    "--no-retweets",
    "--quiet"
  ]);

  assert.equal(args.clickedTweetId, "123");
  assert.equal(args.rootHintTweetId, "100");
  assert.deepEqual(args.following, ["@alice", "@bob"]);
  assert.equal(args.maxPagesPerCollection, 12);
  assert.equal(args.maxConversationRoots, 55);
  assert.equal(args.maxConnectedTweets, 6000);
  assert.equal(args.includeRetweets, false);
  assert.equal(args.quiet, true);
});

test("createFixtureDocument builds an algorithm-agnostic capture artifact", () => {
  const doc = createFixtureDocument({
    dataset: {
      canonicalRootId: "100",
      rootTweet: { id: "100", text: "root" },
      warnings: ["quotes rate-limited"],
      tweets: [{ id: "100" }, { id: "101" }],
      users: [{ id: "u1" }]
    },
    options: {
      clickedTweetId: "101",
      rootHintTweetId: "100",
      maxPagesPerCollection: 10,
      maxConversationRoots: 40,
      maxConnectedTweets: 5000,
      maxNetworkDiscoveryAuthors: 100,
      maxNetworkDiscoveryRoots: 12,
      maxNetworkDiscoveryQueries: 30,
      networkDiscoveryBatchSize: 8,
      includeQuoteTweets: true,
      includeRetweets: true,
      includeQuoteReplies: true,
      requestTimeoutMs: 30000
    },
    warnings: ["quotes rate-limited"],
    outputPath: "/tmp/demo.json"
  });

  assert.equal(doc.fixtureType, "full_conversation_graph");
  assert.equal(doc.source.kind, "x_api");
  assert.equal(doc.source.clickedTweetId, "101");
  assert.equal(doc.source.canonicalRootId, "100");
  assert.equal(doc.conversation.tweetCount, 2);
  assert.equal(doc.conversation.userCount, 1);
  assert.deepEqual(doc.conversation.warnings, ["quotes rate-limited"]);
});

test("runCapture writes a full-graph fixture to disk", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ariadex-capture-"));
  const logs = [];

  const result = await runCapture([
    "--tweet", "200",
    "--output-dir", tempDir,
    "--force"
  ], {
    env: { X_BEARER_TOKEN: "token" },
    log(message) {
      logs.push(message);
    },
    async buildConversationDataset(options) {
      assert.equal(options.clickedTweetId, "200");
      assert.equal(options.includeQuoteTweets, true);
      assert.equal(options.includeQuoteReplies, true);
      assert.equal(options.includeRetweets, true);
      return {
        canonicalRootId: "100",
        rootTweet: { id: "100", text: "Root tweet" },
        tweets: [
          { id: "100", text: "Root tweet" },
          { id: "200", text: "Clicked tweet", reply_to: "100" }
        ],
        users: [
          { id: "u100", username: "root_author" },
          { id: "u200", username: "clicked_author" }
        ],
        warnings: []
      };
    }
  });

  assert.equal(result.exitCode, 0);
  const written = JSON.parse(await fs.readFile(result.outputPath, "utf8"));
  assert.equal(written.conversation.clickedTweetId, "200");
  assert.equal(written.conversation.canonicalRootId, "100");
  assert.equal(written.conversation.tweetCount, 2);
  assert.match(result.outputPath, /200__root-100\.json$/);
  assert.ok(result.checkpointPath);
  assert.ok(result.entityCacheFile);
  const checkpoint = JSON.parse(await fs.readFile(result.checkpointPath, "utf8"));
  assert.equal(checkpoint.status, "completed");
  assert.equal(checkpoint.result.canonicalRootId, "100");
  assert.ok(logs.some((line) => line.includes("wrote")));
});

test("runCapture falls back to repo env loader when env is not injected", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ariadex-capture-env-"));

  const result = await runCapture([
    "--tweet", "300",
    "--output-dir", tempDir,
    "--quiet"
  ], {
    buildEnvObject() {
      return { X_BEARER_TOKEN: "token-from-dotenv" };
    },
    async buildConversationDataset() {
      return {
        canonicalRootId: "250",
        rootTweet: { id: "250", text: "Root" },
        tweets: [{ id: "250" }, { id: "300" }],
        users: [],
        warnings: []
      };
    }
  });

  assert.equal(result.exitCode, 0);
  const written = JSON.parse(await fs.readFile(result.outputPath, "utf8"));
  assert.equal(written.source.clickedTweetId, "300");
});

test("runCapture reuses existing final fixture when resume is enabled", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ariadex-capture-reuse-"));
  const existingPath = path.join(tempDir, "fixture.json");
  await fs.writeFile(existingPath, `${JSON.stringify({
    fixtureType: "full_conversation_graph",
    conversation: {
      clickedTweetId: "999",
      canonicalRootId: "888",
      tweetCount: 1,
      userCount: 0
    }
  }, null, 2)}\n`, "utf8");

  let called = false;
  const result = await runCapture([
    "--tweet", "999",
    "--output", existingPath,
    "--quiet"
  ], {
    env: { X_BEARER_TOKEN: "token" },
    async buildConversationDataset() {
      called = true;
      throw new Error("should not collect");
    }
  });

  assert.equal(result.reused, true);
  assert.equal(called, false);
  assert.equal(result.document.conversation.canonicalRootId, "888");
});
