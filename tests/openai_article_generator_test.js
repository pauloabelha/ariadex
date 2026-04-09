const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildArticleInput,
  buildFallbackArticle,
  createOpenAiArticleGenerator,
  createReferenceEntries,
  isExternalReferenceUrl
} = require("../server/openai_article_generator.js");

test("isExternalReferenceUrl excludes x status urls and keeps external documents", () => {
  assert.equal(isExternalReferenceUrl("https://x.com/a/status/123"), false);
  assert.equal(isExternalReferenceUrl("https://twitter.com/a/status/123"), false);
  assert.equal(isExternalReferenceUrl("https://x.com/i/article/123"), true);
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

test("createReferenceEntries includes X articles from external_urls", () => {
  const references = createReferenceEntries([
    {
      id: "root",
      text: "root tweet",
      author: "@root",
      external_urls: ["https://x.com/i/article/2041371538482761728"]
    }
  ], new Map([["root", 1.25]]));

  assert.deepEqual(references.map((entry) => entry.canonicalUrl), [
    "https://x.com/i/article/2041371538482761728"
  ]);
  assert.equal(references[0].domain, "x.com");
  assert.equal(references[0].citationCount, 1);
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
      pathAnchored: {
        selectedTweetIds: ["human-1", "root"],
        references: [
          {
            canonicalUrl: "https://example.com/report",
            displayUrl: "https://example.com/report",
            domain: "example.com",
            citationCount: 1,
            citedByTweetIds: ["human-1"]
          }
        ],
        artifact: {
          version: "path-anchored/v1"
        }
      },
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
  assert.equal(Array.isArray(input.sourceTweets), true);
  assert.equal(input.sourceTweets.some((tweet) => tweet.id === "human-1"), true);
  assert.equal(input.artifact.version, "path-anchored/v1");
});

test("buildArticleInput prefers the canonical root tweet over the synthetic author thread node", () => {
  const input = buildArticleInput({
    clickedTweetId: "seed",
    dataset: {
      canonicalRootId: "root",
      rootTweet: { id: "author_thread:@root", author: "@root", text: "" },
      tweets: [
        { id: "root", author: "@root", text: "actual root text" },
        { id: "seed", author: "@seed", text: "seed text", quote_of: "root" }
      ]
    },
    snapshot: {
      canonicalRootId: "root",
      root: { id: "author_thread:@root", author: "@root", text: "" },
      ranking: [
        { id: "seed", score: 0.8 },
        { id: "root", score: 0.7 }
      ]
    }
  });

  assert.equal(input.rootTweet.id, "root");
  assert.equal(input.rootTweet.text, "actual root text");
});

test("buildFallbackArticle returns deterministic digest sections", () => {
  const article = buildFallbackArticle({
    seedTweet: { id: "seed", author: "@seed", text: "seed text" },
    rootTweet: { author: "@root", text: "root text" },
    topTweets: [
      { author: "@u1", text: "point one" },
      { author: "@u2", text: "point two", reply_to: "seed" },
      { author: "@u3", text: "point three", quote_of: "root" }
    ],
    references: [
      { displayUrl: "https://example.com/report", domain: "example.com", citationCount: 2 }
    ]
  });

  assert.match(article.title, /@root conversation/);
  assert.equal(article.dek, "seed text");
  assert.match(article.tldr, /@u1 wrote/);
  assert.match(article.tldr, /"point one"/);
  assert.match(article.tldr, /"point two"/);
  assert.match(article.context, /@seed wrote/);
  assert.match(article.context, /Canonical root/);
  assert.match(article.context, /"root text"/);
  assert.equal(Array.isArray(article.branches), true);
  assert.equal(article.branches.length >= 2, true);
  assert.match(article.branches[0].quotes[0].text, /point/);
  assert.equal(Array.isArray(article.openQuestions), true);
  assert.equal(article.sections.length >= 4, true);
  assert.match(article.sections.map((section) => section.heading).join(" | "), /TL;DR/);
  assert.match(article.sections.map((section) => section.heading).join(" | "), /References/);
  assert.equal(article.sections.some((section) => /wrote:\n\n"/.test(section.body)), true);
});

test("buildFallbackArticle filters low-signal tweets from digest branches and summary", () => {
  const article = buildFallbackArticle({
    seedTweet: { id: "seed", author: "@seed", text: "seed text" },
    rootTweet: { id: "root", author: "@root", text: "root text" },
    topTweets: [
      { id: "seed", author: "@seed", text: "seed text" },
      { id: "low-1", author: "@elon", text: "@x @y Wow", reply_to: "root" },
      { id: "low-2", author: "@threadreaderapp", text: "@a @b please #unroll", reply_to: "root" },
      { id: "high-1", author: "@critic", text: "@root There’s no paper here yet, so the claims are still hard to evaluate.", reply_to: "root" },
      { id: "high-2", author: "@analyst", text: "A more detailed post says vision is decorative and does not drive the behavior outputs yet.", quote_of: "root" }
    ],
    references: []
  });

  assert.doesNotMatch(article.tldr, /Wow/);
  assert.doesNotMatch(article.tldr, /#unroll/);
  const branchText = article.sections.map((section) => section.body).join("\n");
  assert.doesNotMatch(branchText, /Wow/);
  assert.doesNotMatch(branchText, /#unroll/);
  assert.match(branchText, /There’s no paper here yet/);
  assert.match(branchText, /vision is decorative/);
});

test("buildFallbackArticle emits standard digest section order when artifact is available", () => {
  const article = buildFallbackArticle({
    artifact: {
      exploredTweetId: "seed",
      rootTweet: { id: "root", author: "@root", text: "root text" },
      mandatoryPath: [
        { id: "root", author: "@root", text: "root text" },
        { id: "seed", author: "@seed", text: "seed text", quoteOf: "root" }
      ],
      expansions: [
        {
          depth: 1,
          tweets: [
            { id: "r1", author: "@reply", text: "reply text", relationType: "reply" }
          ]
        }
      ],
      selectedTweets: []
    },
    clickedTweetId: "seed",
    seedTweet: { id: "seed", author: "@seed", text: "seed text" },
    rootTweet: { id: "root", author: "@root", text: "root text" },
    topTweets: [{ id: "seed", author: "@seed", text: "seed text" }],
    references: [{ canonicalUrl: "https://example.com/doc", displayUrl: "https://example.com/doc", domain: "example.com", citationCount: 1 }]
  });

  assert.deepEqual(
    article.sections.map((section) => section.heading),
    [
      "Original tweet",
      "Why this appeared",
      "Ancestor path",
      "Important replies and branches",
      "Evidence",
      "Digest summary"
    ]
  );
});

test("createOpenAiArticleGenerator accepts minimal model schema and builds standard sections locally", async () => {
  let seenHeaders = null;
  const generator = createOpenAiArticleGenerator({
    enabled: true,
    endpointBase: "http://127.0.0.1:8080/v1",
    fetchImpl: async (_url, options) => {
      seenHeaders = options.headers;
      return {
        ok: true,
        async text() {
          return JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    title: "Digest title",
                    dek: "Digest dek",
                    summary: "A concise model-written summary."
                  })
                }
              }
            ]
          });
        }
      };
    }
  });

  const article = await generator.generateArticle({
    clickedTweetId: "seed",
    dataset: {
      canonicalRootId: "root",
      rootTweet: { id: "root", author: "@root", text: "root text" },
      tweets: [
        { id: "root", author: "@root", text: "root text" },
        { id: "seed", author: "@seed", text: "seed text", quote_of: "root" }
      ]
    },
    snapshot: {
      canonicalRootId: "root",
      root: { id: "root", author: "@root", text: "root text" },
      pathAnchored: {
        selectedTweetIds: ["root", "seed"],
        references: [],
        artifact: {
          exploredTweetId: "seed",
          rootTweet: { id: "root", author: "@root", text: "root text" },
          mandatoryPath: [
            { id: "root", author: "@root", text: "root text" },
            { id: "seed", author: "@seed", text: "seed text", quoteOf: "root" }
          ],
          expansions: [],
          selectedTweets: []
        }
      },
      ranking: [
        { id: "seed", score: 1 },
        { id: "root", score: 0.9 }
      ]
    }
  });

  assert.equal(seenHeaders.Authorization, undefined);
  assert.equal(generator.llmProvider, "local");
  assert.equal(article.llmProvider, "local");
  assert.equal(article.usedLlm, true);
  assert.equal(article.usedOpenAi, false);
  assert.equal(article.title, "Digest title");
  assert.equal(article.dek, "Digest dek");
  assert.equal(article.summary, "A concise model-written summary.");
  assert.deepEqual(
    article.sections.map((section) => section.heading),
    ["Original tweet", "Why this appeared", "Ancestor path", "Digest summary"]
  );
});

test("createOpenAiArticleGenerator falls back cleanly when local model returns invalid json", async () => {
  const generator = createOpenAiArticleGenerator({
    enabled: true,
    endpointBase: "http://127.0.0.1:8091/v1",
    fetchImpl: async () => ({
      ok: true,
      async text() {
        return JSON.stringify({
          choices: [
            {
              message: {
                content: "not-json"
              }
            }
          ]
        });
      }
    })
  });

  const article = await generator.generateArticle({
    clickedTweetId: "seed",
    dataset: {
      canonicalRootId: "root",
      rootTweet: { id: "root", author: "@root", text: "root text" },
      tweets: [
        { id: "root", author: "@root", text: "root text" },
        { id: "seed", author: "@seed", text: "seed text", quote_of: "root" }
      ]
    },
    snapshot: {
      canonicalRootId: "root",
      root: { id: "root", author: "@root", text: "root text" },
      pathAnchored: {
        selectedTweetIds: ["root", "seed"],
        references: [],
        artifact: {
          exploredTweetId: "seed",
          rootTweet: { id: "root", author: "@root", text: "root text" },
          mandatoryPath: [
            { id: "root", author: "@root", text: "root text" },
            { id: "seed", author: "@seed", text: "seed text", quoteOf: "root" }
          ],
          expansions: [],
          selectedTweets: []
        }
      },
      ranking: [
        { id: "seed", score: 1 },
        { id: "root", score: 0.9 }
      ]
    }
  });

  assert.equal(article.llmProvider, "local");
  assert.equal(article.usedLlm, false);
  assert.equal(article.usedOpenAi, false);
  assert.match(article.title, /conversation/);
  assert.deepEqual(
    article.sections.map((section) => section.heading),
    ["Original tweet", "Why this appeared", "Ancestor path", "Digest summary"]
  );
});
