const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
const replyInference = require("../extension/reply_inference.js");

function setupDom() {
  const dom = new JSDOM("<main id='root'></main>", { url: "https://x.com/home" });
  global.window = dom.window;
  global.document = dom.window.document;
  global.Element = dom.window.Element;
  return dom;
}

function createTweetElement({ marginLeft = 0, text = "" }) {
  const article = document.createElement("article");
  article.setAttribute("role", "article");
  article.style.marginLeft = `${marginLeft}px`;

  const content = document.createElement("div");
  content.textContent = text;
  article.appendChild(content);

  document.getElementById("root").appendChild(article);
  return article;
}

function baseTweet(id) {
  return {
    id,
    author: `@${id.toLowerCase()}`,
    text: `tweet ${id}`,
    url: `https://x.com/user/status/${id}`,
    replies: 0,
    reposts: 0,
    likes: 0,
    reply_to: null
  };
}

test("simple thread A -> B infers B.reply_to = A", () => {
  setupDom();
  const elements = [
    createTweetElement({ marginLeft: 0 }),
    createTweetElement({ marginLeft: 20 })
  ];
  const tweets = [baseTweet("A"), baseTweet("B")];

  const inferred = replyInference.inferReplyStructure(elements, tweets);

  assert.equal(inferred[1].reply_to, "A");
});

test("nested replies A -> B -> C infer parent chain", () => {
  setupDom();
  const elements = [
    createTweetElement({ marginLeft: 0 }),
    createTweetElement({ marginLeft: 20 }),
    createTweetElement({ marginLeft: 40 })
  ];
  const tweets = [baseTweet("A"), baseTweet("B"), baseTweet("C")];

  const inferred = replyInference.inferReplyStructure(elements, tweets);

  assert.equal(inferred[1].reply_to, "A");
  assert.equal(inferred[2].reply_to, "B");
});

test("branching replies A -> {B, C} infer both to A", () => {
  setupDom();
  const elements = [
    createTweetElement({ marginLeft: 0 }),
    createTweetElement({ marginLeft: 20 }),
    createTweetElement({ marginLeft: 20 })
  ];
  const tweets = [baseTweet("A"), baseTweet("B"), baseTweet("C")];

  const inferred = replyInference.inferReplyStructure(elements, tweets);

  assert.equal(inferred[1].reply_to, "A");
  assert.equal(inferred[2].reply_to, "A");
});

test("missing parent keeps reply_to null when inference impossible", () => {
  setupDom();
  const elements = [
    createTweetElement({ marginLeft: 0 }),
    createTweetElement({ marginLeft: 0 })
  ];
  const tweets = [baseTweet("A"), baseTweet("B")];

  const inferred = replyInference.inferReplyStructure(elements, tweets);

  assert.equal(inferred[1].reply_to, null);
});

test("indentation detection orders depths by margin-left", () => {
  setupDom();
  const elements = [
    createTweetElement({ marginLeft: 4 }),
    createTweetElement({ marginLeft: 28 }),
    createTweetElement({ marginLeft: 52 })
  ];

  const result = replyInference.inferIndentationDepths(elements);

  assert.deepEqual(result.depths, [0, 1, 2]);
});

test("replying-to context can infer parent by author handle", () => {
  setupDom();
  const elements = [
    createTweetElement({ marginLeft: 0, text: "Some root tweet" }),
    createTweetElement({ marginLeft: 0, text: "Replying to @a this is a reply" })
  ];
  const tweets = [
    { ...baseTweet("A"), author: "@a" },
    { ...baseTweet("B"), author: "@b" }
  ];

  const inferred = replyInference.inferReplyStructure(elements, tweets);

  assert.equal(inferred[1].reply_to, "A");
});
