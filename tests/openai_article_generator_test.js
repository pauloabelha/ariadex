const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildArticleInput,
  buildFallbackArticle,
  createReferenceEntries,
  isExternalReferenceUrl
} = require("../server/openai_article_generator.js");

test("isExternalReferenceUrl excludes x status urls and keeps external documents", () => {
  assert.equal(isExternalReferenceUrl("https://x.com/a/status/123"), false);
  assert.equal(isExternalReferenceUrl("https://twitter.com/a/status/123"), false);
  assert.equal(isExternalReferenceUrl("https://t.co/abc123"), false);
  assert.equal(isExternalReferenceUrl("https://example.com/doc?utm_source=x"), true);
});

test("createReferenceEntries canonicalizes non-x urls and ranks by weighted citations", () => {
  const references = createReferenceEntries([
    { id: "a", text: "see https://example.com/doc?utm_source=x", author: "@a" },
    { id: "b", text: "same https://example.com/doc#frag and https://x.com/p/status/1", author: "@b" },
    { id: "c", text: "other https://example.org/post", author: "@c" }
  ], new Map([
    ["a", 2],
    ["b", 1],
    ["c", 0.5]
  ]));

  assert.equal(references.length, 2);
  assert.equal(references[0].canonicalUrl, "https://example.com/doc");
  assert.equal(references[0].citationCount, 2);
  assert.deepEqual(references[0].citedByTweetIds, ["a", "b"]);
});

test("buildArticleInput excludes synthetic tweets and preserves top human tweets", () => {
  const input = buildArticleInput({
    clickedTweetId: "human-1",
    dataset: {
      canonicalRootId: "root",
      rootTweet: { id: "root", author: "@root", text: "root text" },
      tweets: [
        { id: "root", author: "@root", text: "root text" },
        { id: "human-1", author: "@u1", text: "read https://example.com/report" },
        { id: "repost:root:u2", author: "@u2", text: "synthetic repost" },
        { id: "author_thread:@root", author: "@root", text: "synthetic thread node" }
      ]
    },
    snapshot: {
      canonicalRootId: "root",
      root: { id: "root", author: "@root", text: "root text" },
      ranking: [
        { id: "human-1", score: 0.9 },
        { id: "repost:root:u2", score: 0.8 },
        { id: "root", score: 0.7 }
      ]
    }
  });

  assert.equal(input.metrics.collectedTweetCount, 2);
  assert.equal(input.clickedTweetId, "human-1");
  assert.equal(input.seedTweet.id, "human-1");
  assert.deepEqual(input.topTweets.map((tweet) => tweet.id), ["human-1", "root"]);
  assert.equal(input.references.length, 1);
  assert.equal(input.references[0].canonicalUrl, "https://example.com/report");
});

test("buildFallbackArticle returns deterministic digest sections", () => {
  const article = buildFallbackArticle({
    seedTweet: { id: "seed", author: "@seed", text: "seed text" },
    rootTweet: { author: "@root", text: "root text" },
    topTweets: [
      { author: "@u1", text: "point one" },
      { author: "@u2", text: "point two" }
    ],
    references: [
      { displayUrl: "https://example.com/report", domain: "example.com", citationCount: 2 }
    ]
  });

  assert.match(article.title, /@root conversation/);
  assert.equal(article.dek, "seed text");
  assert.match(article.tldr, /top-ranked visible contribution/);
  assert.match(article.context, /@seed wrote/);
  assert.match(article.context, /canonical root/);
  assert.match(article.context, /"root text"/);
  assert.equal(Array.isArray(article.branches), true);
  assert.equal(article.branches.length >= 1, true);
  assert.match(article.branches[0].quotes[0].text, /point/);
  assert.equal(Array.isArray(article.openQuestions), true);
  assert.equal(article.sections.length >= 4, true);
  assert.match(article.sections.map((section) => section.heading).join(" | "), /TL;DR/);
  assert.match(article.sections.map((section) => section.heading).join(" | "), /References/);
});
