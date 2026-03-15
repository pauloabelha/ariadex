const test = require("node:test");
const assert = require("node:assert/strict");

const { buildPathAnchoredSelection, classifyReference } = require("../server/path_anchored_snapshot.js");

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

test("buildPathAnchoredSelection keeps mandatory ancestor path and recursively expands important replies", () => {
  const dataset = {
    canonicalRootId: "1",
    tweets: [
      makeTweet({
        id: "1",
        author: "@root",
        text: "Root thread about a paper and a benchmark."
      }),
      makeTweet({
        id: "2",
        author: "@seed",
        quote_of: "1",
        likes: 80,
        quote_count: 8,
        followers: 9000,
        text: "This quote tweet is the explored node and links to https://example.com/report.pdf with enough substance to matter in the traversal."
      }),
      makeTweet({
        id: "3",
        author: "@low",
        reply_to: "2",
        likes: 500,
        quote_count: 20,
        followers: 50000,
        text: "@seed wow"
      }),
      makeTweet({
        id: "4",
        author: "@critic",
        reply_to: "2",
        likes: 30,
        quote_count: 6,
        followers: 7000,
        text: "@seed The missing methods section matters here because the claim about behavior fidelity is hard to evaluate without the implementation details or a paper describing the benchmark."
      }),
      makeTweet({
        id: "5",
        author: "@deeper",
        reply_to: "4",
        likes: 18,
        quote_count: 4,
        followers: 5000,
        text: "@critic The strongest external reference I found is https://example.com/report.pdf and the companion video https://youtu.be/demo123 which partly address the benchmark question in more detail."
      }),
      makeTweet({
        id: "6",
        author: "@other",
        quote_of: "1",
        likes: 35,
        quote_count: 5,
        followers: 6000,
        text: "A separate quote branch summarizes the result and cites https://docs.example.org/methods."
      }),
      makeTweet({
        id: "7",
        author: "@noise",
        reply_to: "1",
        likes: 1,
        quote_count: 0,
        followers: 100,
        text: "@root please #unroll"
      })
    ]
  };

  const selection = buildPathAnchoredSelection(dataset, {
    clickedTweetId: "2",
    maxDepth: 3,
    maxChildrenPerNode: 3,
    maxTotalTweets: 10,
    minSubstantiveChars: 100,
    minImportanceScore: 2.8
  });

  assert.deepEqual(selection.mandatoryPathIds, ["1", "2"]);
  assert.equal(selection.selectedTweetIds.includes("4"), true);
  assert.equal(selection.selectedTweetIds.includes("5"), true);
  assert.equal(selection.selectedTweetIds.includes("6"), true);
  assert.equal(selection.selectedTweetIds.includes("3"), false);
  assert.equal(selection.selectedTweetIds.includes("7"), false);
  assert.equal(selection.references.length, 3);
  assert.equal(selection.references[0].canonicalUrl, "https://example.com/report.pdf");
  assert.deepEqual(selection.references[0].citedByTweetIds.sort(), ["2", "5"]);
});

test("classifyReference ignores X links and classifies documents and videos", () => {
  assert.equal(classifyReference("https://x.com/a/status/1"), null);
  assert.equal(classifyReference("https://example.com/doc.pdf").kind, "document");
  assert.equal(classifyReference("https://youtu.be/abc").kind, "video");
});

test("buildPathAnchoredSelection uses the quoted direct parent as the first ancestor hop", () => {
  const dataset = {
    canonicalRootId: "1",
    tweets: [
      {
        ...makeTweet({
          id: "1",
          author: "@pearl",
          text: "Root claim with a t.co link placeholder."
        }),
        external_urls: ["https://example.com/original-news"]
      },
      makeTweet({
        id: "2",
        author: "@lecun",
        reply_to: "1",
        text: "Direct parent tweet with enough substance to clearly belong in the ancestor path."
      }),
      {
        ...makeTweet({
          id: "3",
          author: "@bareinboim",
          reply_to: "1",
          text: "Clicked tweet quoting the direct parent even though the reply chain alone points back to the root."
        }),
        referenced_tweets: [
          { type: "quoted", id: "2" },
          { type: "replied_to", id: "1" }
        ]
      }
    ]
  };

  const selection = buildPathAnchoredSelection(dataset, {
    clickedTweetId: "3",
    rootHintTweetId: "2",
    maxDepth: 2,
    maxChildrenPerNode: 2,
    maxTotalTweets: 10
  });

  assert.deepEqual(selection.mandatoryPathIds, ["1", "2", "3"]);
  assert.equal(selection.references.some((ref) => ref.canonicalUrl === "https://example.com/original-news"), true);
});
