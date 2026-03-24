const test = require("node:test");
const assert = require("node:assert/strict");

const { listSelectorDefinitions, runRegisteredSelector } = require("../research/selectors/registry.js");

function makeTweet({
  id,
  text,
  author = "@a",
  reply_to = null,
  quote_of = null,
  likes = 0,
  quote_count = 0,
  replies = 0,
  followers = 1000
}) {
  return {
    id,
    text,
    author,
    reply_to,
    quote_of,
    likes,
    quote_count,
    replies,
    author_profile: {
      public_metrics: {
        followers_count: followers
      }
    }
  };
}

test("selector registry lists expected algorithms", () => {
  const ids = listSelectorDefinitions().map((entry) => entry.algorithmId).sort();
  assert.deepEqual(ids, ["expand_all_v0", "path_anchored_v1", "quota_per_parent_v0", "thread_context_v0"]);
});

test("registered selectors run on the same dataset contract", () => {
  const dataset = {
    canonicalRootId: "root",
    clickedTweetId: "seed",
    tweets: [
      makeTweet({ id: "root", text: "Root tweet with enough substance to support branch comparisons." }),
      makeTweet({ id: "seed", quote_of: "root", likes: 40, quote_count: 5, followers: 5000, text: "Explored quote tweet with enough substance to be meaningful." }),
      makeTweet({ id: "reply-a", reply_to: "seed", likes: 12, text: "A substantive reply with enough content to matter in a branch selection algorithm." }),
      makeTweet({ id: "reply-b", reply_to: "seed", likes: 4, text: "Another substantive reply that might be kept by breadthier algorithms." }),
      makeTweet({ id: "quote-a", quote_of: "seed", likes: 8, quote_count: 2, text: "A quote branch that should be eligible as well." })
    ]
  };

  const pathAnchored = runRegisteredSelector({
    algorithmId: "path_anchored_v1",
    dataset,
    clickedTweetId: "seed"
  });
  const expandAll = runRegisteredSelector({
    algorithmId: "expand_all_v0",
    dataset,
    clickedTweetId: "seed",
    params: {
      maxDepth: 2,
      maxTotalTweets: 10
    }
  });

  assert.equal(pathAnchored.algorithmId, "path_anchored_v1");
  assert.equal(expandAll.algorithmId, "expand_all_v0");
  assert.deepEqual(pathAnchored.mandatoryPathIds, ["root", "seed"]);
  assert.deepEqual(expandAll.mandatoryPathIds, ["root", "seed"]);
  assert.equal(expandAll.selectedTweetIds.includes("reply-a"), true);
});

test("thread context selector completes bounded same-author thread context around anchors", () => {
  const dataset = {
    canonicalRootId: "root",
    clickedTweetId: "seed",
    tweets: [
      makeTweet({ id: "root", author: "@root", followers: 10000, text: "Root tweet with enough substance to anchor the discussion." }),
      makeTweet({ id: "seed", author: "@alice", quote_of: "root", likes: 20, followers: 5000, text: "Explored quote tweet with enough substance to be selected." }),
      makeTweet({ id: "seed-2", author: "@alice", reply_to: "seed", likes: 0, followers: 5000, text: "Short continuation with just enough structure to be a thread segment." }),
      makeTweet({ id: "seed-3", author: "@alice", reply_to: "seed-2", likes: 0, followers: 5000, text: "Another continuation that should be completed by thread context." }),
      makeTweet({ id: "other", author: "@bob", reply_to: "seed", likes: 30, followers: 4000, text: "A more popular reply that the base selector may already keep." })
    ]
  };

  const pathAnchored = runRegisteredSelector({
    algorithmId: "path_anchored_v1",
    dataset,
    clickedTweetId: "seed"
  });
  const threadContext = runRegisteredSelector({
    algorithmId: "thread_context_v0",
    dataset,
    clickedTweetId: "seed",
    params: {
      maxThreadTweetsPerAnchor: 2,
      maxAddedThreadTweets: 4
    }
  });

  assert.equal(pathAnchored.selectedTweetIds.includes("seed-2"), false);
  assert.equal(threadContext.selectedTweetIds.includes("seed-2"), true);
  assert.equal(threadContext.selectedTweetIds.includes("seed-3"), true);
  assert.ok(threadContext.diagnostics.notes.some((note) => note.includes("thread context")));
});
