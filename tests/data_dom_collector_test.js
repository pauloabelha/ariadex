const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
const domCollector = require("../data/dom_collector.js");

test("toUnifiedTweetSchema emits the shared data-layer tweet schema", () => {
  const unified = domCollector.toUnifiedTweetSchema({
    id: "123",
    author: "@alice",
    text: "hello",
    reply_to: "100",
    quote_of: null,
    repost_of: null,
    replies: 2,
    reposts: 4,
    likes: 9,
    quote_count: 1
  });

  assert.deepEqual(unified, {
    id: "123",
    author_id: "alice",
    text: "hello",
    referenced_tweets: [{ type: "replied_to", id: "100" }],
    metrics: {
      reply_count: 2,
      retweet_count: 4,
      like_count: 9,
      quote_count: 1
    }
  });
});

test("resolveDomConversationRoot uses nested quote tweet as root hint", () => {
  const dom = new JSDOM("<main id='scope'></main>", { url: "https://x.com/home" });
  global.window = dom.window;
  global.document = dom.window.document;
  global.Element = dom.window.Element;

  const scope = document.getElementById("scope");
  const outer = document.createElement("article");
  outer.setAttribute("data-testid", "tweet");
  const nested = document.createElement("article");
  nested.setAttribute("data-testid", "tweet");
  outer.appendChild(nested);
  scope.appendChild(outer);

  const resolved = domCollector.resolveDomConversationRoot(outer);
  assert.equal(resolved, nested);
});
